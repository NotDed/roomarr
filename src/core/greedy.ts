import {
  type CandidateContext,
  type CandidateSet,
  generateCandidates,
  nearestCandidate,
} from '@/core/candidates';
import type { Feature } from '@/core/features';
import { type Rect, rectsOverlap } from '@/core/geometry';
import { type Item, type Layout, type Placement, itemRect } from '@/core/items';
import type { Room } from '@/core/room';
import { makeRng, shuffled } from '@/core/rng';
import { type ScoreBreakdown, type Weights, scoreLayout } from '@/core/score';
import type { Mm } from '@/core/units';
import type { WallId } from '@/core/wallrun';

/**
 * Auto-arrange: place everything, largest first, taking the best pose for each.
 *
 * Greedy rather than annealed, on purpose and for now. It runs in well under a
 * second with no worker, it is easy to reason about when it produces something
 * odd, and it proves the candidate and scoring layers work before anything
 * harder is built on top of them. Its known weakness is that it cannot undo an
 * early decision — if the bed takes the wall the wardrobe wanted, greedy will
 * never swap them. That is exactly the gap a later annealing pass fills, and
 * naming it here is more useful than pretending this is the final answer.
 *
 * **The current layout is always one of the candidates.** The result can
 * therefore honestly be "what you already have is the best I found", which an
 * optimizer that only ever proposes change cannot say — and which is the
 * difference between advice and a sales pitch.
 */

export interface ArrangeInput {
  room: Room;
  items: readonly Item[];
  layout: Layout;
  features: readonly Feature[];
  wallIds: readonly WallId[];
  roomIsSleeping: boolean;
  /** Same seed, same answer. */
  seed?: number;
  /** How many differently-ordered attempts to make. */
  attempts?: number;
  weights?: Weights;
  /** Grid used while searching. Coarser than the one the user reads. */
  searchCell?: Mm;
}

export interface ArrangeResult {
  layout: Layout;
  score: ScoreBreakdown;
  /** The layout it started from, scored the same way, for an honest comparison. */
  baseline: ScoreBreakdown;
  /** True when nothing beat what was already there. */
  keptOriginal: boolean;
  /** Items whose pose changed. */
  moved: string[];
  candidateCounts: { itemId: string; count: number }[];
}

/**
 * A coarse grid for the inner loop.
 *
 * The search only ever compares layouts with each other, so it can afford to
 * measure them roughly; the figure a person reads is computed once, exactly.
 * At 100 mm a room is a quarter of the cells it is at 50 mm, which is the
 * difference between this finishing in a moment and in a few seconds.
 */
export const SEARCH_CELL: Mm = 100;

/** How many poses per item the greedy pass actually tries. */
const SAMPLE_PER_ITEM = 48;

export function autoArrange(input: ArrangeInput): ArrangeResult {
  const rng = makeRng(input.seed ?? 1);
  const attempts = input.attempts ?? 3;

  const locked = new Set(input.layout.placements.filter((p) => p.locked).map((p) => p.itemId));

  const movable = input.items.filter((i) => !locked.has(i.id));
  const fixed = input.items
    .filter((i) => locked.has(i.id))
    .flatMap((item) => {
      const placement = input.layout.placements.find((p) => p.itemId === item.id);
      return placement === undefined ? [] : [{ item, rect: itemRect(item, placement) }];
    });

  const ctx: CandidateContext = {
    room: input.room,
    features: input.features,
    wallIds: input.wallIds,
    roomIsSleeping: input.roomIsSleeping,
    fixed,
  };

  const sets = new Map<string, CandidateSet>();
  for (const item of movable) sets.set(item.id, generateCandidates(item, ctx));

  const score = (layout: Layout, cell?: Mm): ScoreBreakdown =>
    scoreLayout({
      room: input.room,
      items: input.items,
      layout,
      features: input.features,
      wallIds: input.wallIds,
      roomIsSleeping: input.roomIsSleeping,
      ...(input.weights === undefined ? {} : { weights: input.weights }),
      ...(cell === undefined ? {} : { cell }),
    });

  const searchCell = input.searchCell ?? SEARCH_CELL;
  const baselineSearch = score(input.layout, searchCell);

  let best = input.layout;
  let bestScore = baselineSearch.total;
  /* Only unseat the current layout if it is actually beaten. Ties go to what is
     already in the room, because moving furniture has a cost this score does
     not model. */
  let keptOriginal = true;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const layout = buildOne(input, movable, sets, ctx, rng, attempt, score, searchCell);
    const result = score(layout, searchCell);

    /* An infeasible result never wins, even if it scores higher. */
    if (!result.feasible) continue;
    if (result.total > bestScore + 1e-9) {
      best = layout;
      bestScore = result.total;
      keptOriginal = false;
    }
  }

  const moved = best.placements
    .filter((p) => {
      const before = input.layout.placements.find((q) => q.itemId === p.itemId);
      return (
        before !== undefined &&
        (before.pose.x !== p.pose.x || before.pose.y !== p.pose.y || before.pose.rot !== p.pose.rot)
      );
    })
    .map((p) => p.itemId);

  return {
    layout: best,
    /* Reported at the display grid, not the search one: the number a person
       reads must be the number the app measures elsewhere. */
    score: score(best),
    baseline: score(input.layout),
    keptOriginal,
    moved,
    candidateCounts: [...sets.values()].map((s) => ({
      itemId: s.itemId,
      count: s.candidates.length,
    })),
  };
}

/**
 * One pass: place every movable item, biggest first.
 *
 * The order is perturbed between attempts, because greedy's answer depends
 * heavily on who chooses first — trying "bed then wardrobe" and "wardrobe then
 * bed" costs almost nothing and covers greedy's main blind spot cheaply.
 */
function buildOne(
  input: ArrangeInput,
  movable: readonly Item[],
  sets: ReadonlyMap<string, CandidateSet>,
  ctx: CandidateContext,
  rng: ReturnType<typeof makeRng>,
  attempt: number,
  score: (layout: Layout, cell?: Mm) => ScoreBreakdown,
  searchCell: Mm,
): Layout {
  const order = movable.toSorted(
    (a, b) =>
      b.footprint.w * b.footprint.d * (b.prefersWall ? 1.5 : 1) -
      a.footprint.w * a.footprint.d * (a.prefersWall ? 1.5 : 1),
  );
  const sequence = attempt === 0 ? order : shuffled(order, rng);

  /* Locked items keep exactly where they are. */
  const placements: Placement[] = input.layout.placements.filter((p) => p.locked);
  const taken: Rect[] = ctx.fixed.map((f) => f.rect);

  for (const item of sequence) {
    const set = sets.get(item.id);
    const existing = input.layout.placements.find((p) => p.itemId === item.id);

    if (set === undefined || set.candidates.length === 0) {
      /* Nowhere legal to put it. Leave it where it was rather than dropping it
         from the layout — losing someone's furniture is never the right answer
         to "I could not place this". */
      if (existing !== undefined) {
        placements.push(existing);
        taken.push(itemRect(item, existing));
      }
      continue;
    }

    /* Always consider where it already is, plus a sample of the rest. */
    const indices = sampleIndices(set, existing, rng);

    let bestIndex = -1;
    let bestValue = Number.NEGATIVE_INFINITY;

    for (const index of indices) {
      const candidate = set.candidates[index];
      if (candidate === undefined) continue;

      const trial: Placement = { itemId: item.id, pose: candidate.pose, locked: false };
      const rect = itemRect(item, trial);
      if (taken.some((t) => rectsOverlap(t, rect))) continue;

      const value = score(
        { ...input.layout, placements: [...placements, trial] },
        searchCell,
      ).total;

      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }

    const chosen = set.candidates[bestIndex];
    if (chosen === undefined) {
      if (existing !== undefined) {
        placements.push(existing);
        taken.push(itemRect(item, existing));
      }
      continue;
    }

    const placement: Placement = { itemId: item.id, pose: chosen.pose, locked: false };
    placements.push(placement);
    taken.push(itemRect(item, placement));
  }

  return { ...input.layout, placements };
}

/**
 * Which poses to actually try.
 *
 * Evaluating every generated pose for every item is affordable in principle and
 * not in a second, so this takes an even stride through them — plus, always,
 * where the item currently sits, so "leave it alone" stays reachable.
 */
function sampleIndices(
  set: CandidateSet,
  existing: Placement | undefined,
  rng: ReturnType<typeof makeRng>,
): number[] {
  const total = set.candidates.length;
  const indices = new Set<number>();

  if (existing !== undefined) {
    const near = nearestCandidate(set, existing.pose);
    if (near >= 0) indices.add(near);
  }

  if (total <= SAMPLE_PER_ITEM) {
    for (let i = 0; i < total; i++) indices.add(i);
    return [...indices];
  }

  const stride = total / SAMPLE_PER_ITEM;
  const jitter = rng.next();
  for (let i = 0; i < SAMPLE_PER_ITEM; i++) {
    indices.add(Math.min(total - 1, Math.floor((i + jitter) * stride)));
  }

  return [...indices];
}
