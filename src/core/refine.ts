import {
  type CandidateContext,
  type CandidateSet,
  generateCandidates,
  nearestCandidate,
} from '@/core/candidates';
import type { Feature } from '@/core/features';
import { rectsOverlap } from '@/core/geometry';
import { type Item, type Layout, type Placement, clearanceRect, itemRect } from '@/core/items';
import type { Room } from '@/core/room';
import { type Rng, makeRng, shuffled } from '@/core/rng';
import { type Weights, scoreGeometry, scoreLayout } from '@/core/score';
import type { Mm } from '@/core/units';
import type { WallId } from '@/core/wallrun';

/**
 * The search: build a layout, then improve it until it stops improving.
 *
 * ── Why this and not simulated annealing ─────────────────────────────────
 *
 * Annealing was the plan, and it was measurably the wrong tool. In a room with
 * six pieces of furniture, almost every single-item move lands on top of
 * something or in something's doorway space, so the feasible arrangements form
 * scattered islands rather than a landscape you can walk across. A temperature
 * schedule needs a landscape. Measured on the fixture bedroom, annealing
 * reached only 81 legal layouts out of 6,000 attempted moves and finished below
 * plain greedy.
 *
 * What works on scattered islands is landing on one and then exploring it
 * exhaustively: construct a layout that breaks nothing, then repeatedly try
 * *every* pose for each item in turn and keep the best. Repeat from several
 * different constructions. It revisits decisions, which is exactly what greedy
 * cannot do, without needing the space to be connected.
 *
 * ── Two things that make it affordable ───────────────────────────────────
 *
 * A layout is one integer per item, indexing precomputed legal poses, so a
 * move is a single write. And a state that breaks a rule is rejected by a few
 * rectangle tests without ever measuring walkable floor — the expensive part
 * only runs on arrangements worth measuring.
 */

export interface RefineInput {
  room: Room;
  items: readonly Item[];
  layout: Layout;
  features: readonly Feature[];
  wallIds: readonly WallId[];
  roomIsSleeping: boolean;
  seed?: number;
  weights?: Weights;
  /** Grid used while searching. Coarser than the one a person reads. */
  searchCell?: Mm;
  /**
   * Layouts to start from, on top of the current one and the constructions.
   *
   * The caller passes greedy's answer here. Greedy is fast and lands on a good
   * arrangement; polishing from it means this can only ever improve on it,
   * which turns "usually about as good as greedy" into "never worse than
   * greedy" — a much easier promise to keep and to explain.
   */
  seeds?: readonly Layout[];
  /** How many independent constructions to try. More attempts, more variety. */
  attempts?: number;
  /** How many poses per item each polish sweep considers. */
  samplePerItem?: number;
  /** How many improvement sweeps before giving up on a construction. */
  sweeps?: number;
  /**
   * Cap on how many things may move.
   *
   * The honest way to say "I'll shift a couple of things but I'm not emptying
   * the room". A weight cannot do this job: the same weight means something
   * different in a four-item room and a twenty-item one, so it either pins
   * everything or does nothing. A count is what people think in, and it is
   * enforceable exactly.
   */
  maxMoves?: number;
  /** Called periodically. Return false to stop early. */
  onProgress?: (progress: RefineProgress) => boolean;
}

export interface RefineProgress {
  attempt: number;
  attempts: number;
  evals: number;
  bestScore: number;
}

export interface RefineCandidate {
  layout: Layout;
  score: number;
  moved: string[];
  /** Which wall each item ended against, for telling results apart cheaply. */
  signature: string;
}

export interface RefineOutput {
  /** Best first. Only feasible layouts ever appear here. */
  results: RefineCandidate[];
  baselineScore: number;
  baselineFeasible: boolean;
  evals: number;
  /** True when nothing beat the layout it started from. */
  keptOriginal: boolean;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_SAMPLE = 40;
const DEFAULT_SWEEPS = 3;

export function refineLayout(input: RefineInput): RefineOutput {
  const rng = makeRng(input.seed ?? 1);
  const attempts = input.attempts ?? DEFAULT_ATTEMPTS;
  const sample = input.samplePerItem ?? DEFAULT_SAMPLE;
  const sweeps = input.sweeps ?? DEFAULT_SWEEPS;
  const searchCell = input.searchCell ?? 100;

  const lockedIds = new Set(input.layout.placements.filter((p) => p.locked).map((p) => p.itemId));
  const movable = input.items.filter((i) => !lockedIds.has(i.id));
  const fixed = input.items
    .filter((i) => lockedIds.has(i.id))
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

  const sets = movable.map((item) => generateCandidates(item, ctx));

  /* Precomputed once, so the inner loop reads geometry rather than building it. */
  const rects = sets.map((set, i) => {
    const item = movable[i];
    if (item === undefined) return [];
    return set.candidates.map((c) =>
      itemRect(item, { itemId: item.id, pose: c.pose, locked: false }),
    );
  });

  const zonesFor = sets.map((set, i) => {
    const item = movable[i];
    if (item === undefined) return [];
    return set.candidates.map((c) =>
      item.clearances.map((rule) => ({
        rule,
        rect: clearanceRect(item, { itemId: item.id, pose: c.pose, locked: false }, rule),
      })),
    );
  });

  const fixedRects = fixed.map((f) => f.rect);

  const origin = sets.map((set, i) => {
    const item = movable[i];
    const placement =
      item === undefined ? undefined : input.layout.placements.find((p) => p.itemId === item.id);
    if (placement === undefined || set.candidates.length === 0) return 0;
    const near = nearestCandidate(set, placement.pose);
    return near < 0 ? 0 : near;
  });

  const toLayout = (state: readonly number[]): Layout => {
    const placements: Placement[] = input.layout.placements.filter((p) => p.locked);
    for (const [i, item] of movable.entries()) {
      const candidate = sets[i]?.candidates[state[i] ?? 0];
      const existing = input.layout.placements.find((p) => p.itemId === item.id);
      if (candidate === undefined) {
        if (existing !== undefined) placements.push(existing);
        continue;
      }
      placements.push({ itemId: item.id, pose: candidate.pose, locked: false });
    }
    return { ...input.layout, placements };
  };

  /**
   * How many rules a state breaks between movable things.
   *
   * Counted rather than merely detected, so a construction can pick the
   * least-bad pose when no perfect one exists instead of giving up. Honours the
   * same three rules the constraint checker does — heights below `minHeight`
   * pass, listed `nestsWith` types pass, and a grouped rule needs only one
   * member clear — because a search that disagrees with the checker produces
   * results the checker then throws away.
   */
  const breakages = (state: readonly number[], among?: readonly number[]): number => {
    const indices = among ?? state.map((_, i) => i);
    let count = 0;

    for (const i of indices) {
      const item = movable[i];
      const rect = rects[i]?.[state[i] ?? 0];
      if (item === undefined || rect === undefined || item.overlappable) continue;

      for (const other of fixedRects) {
        if (rectsOverlap(other, rect)) count++;
      }
      for (const j of indices) {
        if (j <= i) continue;
        const otherItem = movable[j];
        if (otherItem === undefined || otherItem.overlappable) continue;
        const otherRect = rects[j]?.[state[j] ?? 0];
        if (otherRect !== undefined && rectsOverlap(otherRect, rect)) count++;
      }

      const groups = new Map<string, boolean>();
      for (const { rule, rect: zone } of zonesFor[i]?.[state[i] ?? 0] ?? []) {
        let clear = true;

        for (const j of indices) {
          if (j === i || !clear) continue;
          const other = movable[j];
          if (other === undefined || other.overlappable) continue;
          if (other.height <= rule.minHeight) continue;
          if ((rule.nestsWith ?? []).includes(other.type)) continue;
          const otherRect = rects[j]?.[state[j] ?? 0];
          if (otherRect !== undefined && rectsOverlap(zone, otherRect)) clear = false;
        }
        for (const blocker of fixed) {
          if (!clear) break;
          if (blocker.item.height <= rule.minHeight) continue;
          if ((rule.nestsWith ?? []).includes(blocker.item.type)) continue;
          if (rectsOverlap(zone, blocker.rect)) clear = false;
        }

        if (rule.anyOfGroup === undefined) {
          if (!clear) count++;
        } else {
          groups.set(rule.anyOfGroup, (groups.get(rule.anyOfGroup) ?? false) || clear);
        }
      }
      for (const ok of groups.values()) {
        if (!ok) count++;
      }
    }

    return count;
  };

  let evals = 0;
  const measure = (state: readonly number[]): number => {
    evals++;
    return scoreGeometry({
      room: input.room,
      items: input.items,
      layout: toLayout(state),
      features: input.features,
      wallIds: input.wallIds,
      roomIsSleeping: input.roomIsSleeping,
      ...(input.weights === undefined ? {} : { weights: input.weights }),
      cell: searchCell,
    }).total;
  };

  const movedCount = (state: readonly number[]): number => {
    let n = 0;
    for (let i = 0; i < state.length; i++) if (state[i] !== origin[i]) n++;
    return n;
  };

  const withinBudget = (state: readonly number[]): boolean =>
    input.maxMoves === undefined || movedCount(state) <= input.maxMoves;

  /**
   * Score a state, or reject it outright.
   *
   * Illegal and over-budget states return null and cost only a handful of
   * rectangle tests. There is no point measuring the walkable floor of a room
   * where the wardrobe cannot open.
   */
  const valueOf = (state: readonly number[]): number | null => {
    if (breakages(state) > 0) return null;
    if (!withinBudget(state)) return null;
    return measure(state);
  };

  /** Biggest first: a bed that cannot find a wall dooms everything after it. */
  const bySize = movable
    .map((item, i) => ({
      i,
      weight: item.footprint.w * item.footprint.d * (item.prefersWall ? 1.5 : 1),
    }))
    .toSorted((a, b) => b.weight - a.weight)
    .map((entry) => entry.i);

  /** Build a layout that breaks nothing, one item at a time. */
  const construct = (order: readonly number[]): number[] => {
    const state = movable.map(() => 0);
    const placed: number[] = [];

    for (const i of order) {
      const set = sets[i];
      if (set === undefined || set.candidates.length === 0) {
        placed.push(i);
        continue;
      }

      let chosen = 0;
      let fewest = Number.POSITIVE_INFINITY;
      /* Start from a rotating offset so different attempts explore different
         parts of the candidate list rather than all landing on index 0. */
      const offset = rng.int(set.candidates.length);

      for (let k = 0; k < set.candidates.length; k++) {
        const c = (offset + k) % set.candidates.length;
        state[i] = c;
        const broken = breakages(state, [...placed, i]);
        if (broken === 0) {
          chosen = c;
          break;
        }
        if (broken < fewest) {
          fewest = broken;
          chosen = c;
        }
      }

      state[i] = chosen;
      placed.push(i);
    }

    return state;
  };

  /**
   * Improve a layout by re-choosing one item at a time, exhaustively.
   *
   * This is the step greedy cannot take: every item gets reconsidered after all
   * the others are placed, so an early decision that turned out badly is undone
   * rather than lived with. Sweeps repeat until nothing improves.
   */
  const polish = (state: number[], onStep: () => boolean): number => {
    let current = valueOf(state) ?? Number.NEGATIVE_INFINITY;

    for (let sweep = 0; sweep < sweeps; sweep++) {
      let improved = false;

      for (const i of bySize) {
        const set = sets[i];
        if (set === undefined || set.candidates.length === 0) continue;

        const was = state[i] ?? 0;
        let bestIndex = was;
        let bestValue = current;

        for (const c of stride(set.candidates.length, sample, was, rng)) {
          state[i] = c;
          const value = valueOf(state);
          if (value !== null && value > bestValue) {
            bestValue = value;
            bestIndex = c;
          }
        }

        state[i] = bestIndex;
        if (bestIndex !== was) {
          current = bestValue;
          improved = true;
        }
        if (!onStep()) return current;
      }

      /* Exchanging two items is the move no sequence of single improvements
         reaches: the halfway state has them on top of each other, which is
         worse than either end. It is how a bed and a wardrobe end up on each
         other's walls and stay there. */
      for (let a = 0; a < state.length; a++) {
        for (let b = a + 1; b < state.length; b++) {
          const setA = sets[a];
          const setB = sets[b];
          if (setA === undefined || setB === undefined) continue;

          const poseA = setA.candidates[state[a] ?? 0]?.pose;
          const poseB = setB.candidates[state[b] ?? 0]?.pose;
          if (poseA === undefined || poseB === undefined) continue;

          const newA = nearestCandidate(setA, poseB);
          const newB = nearestCandidate(setB, poseA);
          if (newA < 0 || newB < 0) continue;

          const wasA = state[a] ?? 0;
          const wasB = state[b] ?? 0;
          state[a] = newA;
          state[b] = newB;

          const value = valueOf(state);
          if (value !== null && value > current) {
            current = value;
            improved = true;
          } else {
            state[a] = wasA;
            state[b] = wasB;
          }
          if (!onStep()) return current;
        }
      }

      if (!improved) break;
    }

    return current;
  };

  /** Convert a whole layout into the search's index representation. */
  const toState = (layout: Layout): number[] =>
    sets.map((set, i) => {
      const item = movable[i];
      const placement =
        item === undefined ? undefined : layout.placements.find((p) => p.itemId === item.id);
      if (placement === undefined || set.candidates.length === 0) return 0;
      const near = nearestCandidate(set, placement.pose);
      return near < 0 ? 0 : near;
    });

  const seedStates = (input.seeds ?? []).map(toState);

  const baselineValue = valueOf(origin);
  const baselineScore = baselineValue ?? measure(origin);
  const found: RefineCandidate[] = [];

  let bestSoFar = baselineValue ?? Number.NEGATIVE_INFINITY;
  let stop = false;

  const onStep = (): boolean => {
    if (stop) return false;
    if (input.onProgress === undefined) return true;
    if (evals % 24 !== 0) return true;
    const keepGoing = input.onProgress({
      attempt: found.length,
      attempts,
      evals,
      bestScore: bestSoFar,
    });
    if (!keepGoing) stop = true;
    return keepGoing;
  };

  const total = attempts + seedStates.length + (baselineValue === null ? 0 : 1);

  for (let attempt = 0; attempt < total; attempt++) {
    /* `stop` is set from inside the progress callback, several frames down the
       call stack, so it is checked here rather than in the loop condition. */
    if (stop) break;

    /* Order matters only for readability of progress: what is already in the
       room first (so "leave it alone" stays reachable and the never-worse
       promise is honest), then the caller's seeds, then fresh constructions —
       which are where the variety comes from. */
    const start =
      attempt === 0 && baselineValue !== null
        ? origin
        : (seedStates[attempt - (baselineValue === null ? 0 : 1)] ??
          construct(attempt <= 1 ? bySize : shuffled(bySize, rng)));

    /* Polished in place, so the copy is what gets recorded — reading the
       unpolished start here would throw away everything the sweep just did. */
    const state = [...start];
    const score = polish(state, onStep);
    if (score > bestSoFar) bestSoFar = score;
    if (!Number.isFinite(score)) continue;

    const layout = toLayout(state);
    found.push({
      layout,
      score,
      moved: movedItems(input.layout, layout),
      signature: signatureOf(state, sets),
    });
  }

  /* Verified rather than assumed. The search cannot break a rule by
     construction, but checking costs one pass each and removes an entire class
     of "it suggested something impossible". */
  const verified = found.filter(
    (candidate) =>
      scoreLayout({
        room: input.room,
        items: input.items,
        layout: candidate.layout,
        features: input.features,
        wallIds: input.wallIds,
        roomIsSleeping: input.roomIsSleeping,
        ...(input.weights === undefined ? {} : { weights: input.weights }),
      }).feasible,
  );

  const unique = dedupe(verified);
  const ranked = unique.toSorted((a, b) => b.score - a.score);
  const best = ranked[0];

  return {
    results: ranked,
    baselineScore,
    baselineFeasible: baselineValue !== null,
    evals,
    /* An infeasible starting layout is never "already the best", however it
       scores — the whole point is to escape it. */
    keptOriginal:
      baselineValue !== null && (best === undefined || best.score <= baselineValue + 1e-9),
  };
}

/**
 * Candidate indices to try, spread across the whole list.
 *
 * An even stride rather than the first N, because the list runs wall by wall
 * and the first N would only ever look at one or two walls. The current pose is
 * always included, so "leave this one alone" is never lost.
 */
function stride(total: number, want: number, current: number, rng: Rng): number[] {
  if (total <= want) return Array.from({ length: total }, (_, i) => i);

  const out = new Set<number>([current]);
  const step = total / want;
  const jitter = rng.next();
  for (let i = 0; i < want; i++) {
    out.add(Math.min(total - 1, Math.floor((i + jitter) * step)));
  }
  return [...out];
}

/** Drop results that are the same arrangement wearing a different hat. */
function dedupe(candidates: readonly RefineCandidate[]): RefineCandidate[] {
  const seen = new Set<string>();
  const out: RefineCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.signature)) continue;
    seen.add(candidate.signature);
    out.push(candidate);
  }
  return out;
}

function signatureOf(state: readonly number[], sets: readonly CandidateSet[]): string {
  return state
    .map((index, i) => {
      const candidate = sets[i]?.candidates[index];
      return candidate === undefined ? '-' : `${candidate.wallIndex ?? 'f'}${candidate.third}`;
    })
    .join('|');
}

function movedItems(before: Layout, after: Layout): string[] {
  return after.placements
    .filter((p) => {
      const was = before.placements.find((q) => q.itemId === p.itemId);
      return (
        was !== undefined &&
        (was.pose.x !== p.pose.x || was.pose.y !== p.pose.y || was.pose.rot !== p.pose.rot)
      );
    })
    .map((p) => p.itemId);
}
