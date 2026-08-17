import type { RefineCandidate } from '@/core/refine';
import { type Item, itemRect } from '@/core/items';
import { rectAreaMm2 } from '@/core/metrics';

/**
 * Choosing which results to actually show.
 *
 * Three arrangements that differ only in where a lamp ended up are not three
 * options; they are one option shown three times, and offering them wastes the
 * user's attention and makes the tool look like it is padding. What people want
 * from a second option is a genuinely different idea about the room.
 *
 * So candidates are picked by score **and** by how unlike the ones already
 * chosen they are, and if there is only one real idea in the results, only one
 * is returned. Returning fewer honestly beats returning three that are the
 * same.
 */

export interface Pick {
  candidate: RefineCandidate;
  /** How unlike the already-chosen ones this is, 0–1. */
  distinctness: number;
  /** A short human label derived from what actually differs. */
  label: string;
}

/**
 * How different two arrangements are, weighted by how much each item matters.
 *
 * Weighted by footprint area, so moving the bed counts for far more than
 * moving a nightstand. Unweighted, a shuffled lamp would read as the same
 * amount of change as a rearranged bed, and the "most different" option would
 * reliably be the one that jiggled the smallest thing.
 */
export function distance(
  a: RefineCandidate,
  b: RefineCandidate,
  items: readonly Item[],
  roomDiagonal: number,
): number {
  let weighted = 0;
  let totalWeight = 0;

  for (const item of items) {
    /* Something excluded from the metric contributes nothing to the score, so
       its position is noise — counting it would let noise dominate. */
    if (item.overlappable) continue;

    const pa = a.layout.placements.find((p) => p.itemId === item.id);
    const pb = b.layout.placements.find((p) => p.itemId === item.id);
    if (pa === undefined || pb === undefined) continue;

    const weight = rectAreaMm2(itemRect(item, pa));
    const dx = pa.pose.x - pb.pose.x;
    const dy = pa.pose.y - pb.pose.y;
    const moved = Math.hypot(dx, dy) / Math.max(roomDiagonal, 1);
    const turned = pa.pose.rot === pb.pose.rot ? 0 : 0.5;

    weighted += weight * Math.min(1, moved + turned);
    totalWeight += weight;
  }

  return totalWeight === 0 ? 0 : weighted / totalWeight;
}

export interface SelectOptions {
  items: readonly Item[];
  roomDiagonal: number;
  /** At most this many. Fewer is returned when there are not that many ideas. */
  want?: number;
  /** How different a result has to be to count as a separate idea. */
  minDistance?: number;
  /** Ignore anything scoring this far below the best. */
  scoreTolerance?: number;
}

/**
 * Pick a handful of genuinely different arrangements.
 *
 * The best one is always included. After that each pick maximises a blend of
 * score and distance from what is already chosen, so the second option is the
 * best *different* idea rather than the second-best variation on the first.
 */
export function selectDiverse(
  candidates: readonly RefineCandidate[],
  options: SelectOptions,
): Pick[] {
  const want = options.want ?? 3;
  const minDistance = options.minDistance ?? 0.12;
  const tolerance = options.scoreTolerance ?? 0.25;

  const ranked = candidates.toSorted((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best === undefined) return [];

  const eligible = ranked.filter((c) => c.score >= best.score - tolerance);
  const chosen: RefineCandidate[] = [best];

  while (chosen.length < want) {
    let pick: RefineCandidate | null = null;
    let pickValue = Number.NEGATIVE_INFINITY;

    for (const candidate of eligible) {
      if (chosen.includes(candidate)) continue;

      const nearest = Math.min(
        ...chosen.map((c) => distance(candidate, c, options.items, options.roomDiagonal)),
      );
      /* Below the threshold this is the same idea wearing a different hat. */
      if (nearest < minDistance) continue;

      /* Score still leads; distance breaks ties toward variety rather than
         toward more of the same. */
      const value = candidate.score + nearest * 0.5;
      if (value > pickValue) {
        pickValue = value;
        pick = candidate;
      }
    }

    if (pick === null) break;
    chosen.push(pick);
  }

  return chosen.map((candidate, index) => ({
    candidate,
    distinctness:
      index === 0
        ? 0
        : Math.min(
            ...chosen
              .slice(0, index)
              .map((c) => distance(candidate, c, options.items, options.roomDiagonal)),
          ),
    label: '',
  }));
}

/**
 * Name each option by what actually distinguishes it.
 *
 * Deliberately takes the **measured** figures rather than the search's internal
 * scores. Those are computed on a coarser grid, and they can rank two options
 * differently from the numbers shown beside them — which produced an option
 * labelled "Most open floor" sitting above one with more floor. A label that
 * contradicts the number next to it is worse than no label at all.
 */
export function labelOptions(
  options: readonly { walkableMm2: number; moved: readonly string[] }[],
): string[] {
  if (options.length === 0) return [];

  let bestFloor = 0;
  let fewestMoves = 0;
  for (const [i, option] of options.entries()) {
    if (option.walkableMm2 > (options[bestFloor]?.walkableMm2 ?? 0)) bestFloor = i;
    if (option.moved.length < (options[fewestMoves]?.moved.length ?? Infinity)) fewestMoves = i;
  }

  return options.map((option, i) => {
    if (i === bestFloor) return 'Most open floor';
    if (i === fewestMoves && option.moved.length < (options[bestFloor]?.moved.length ?? 0)) {
      return `Smallest change · ${describeMoves(option.moved.length)}`;
    }
    return 'A different arrangement';
  });
}

/**
 * "1 thing moves" / "2 things move".
 *
 * Shared because the verb agreement flips with the noun, which is exactly the
 * kind of thing that gets written correctly once and wrongly everywhere else.
 */
export function describeMoves(count: number): string {
  return count === 1 ? '1 thing moves' : `${count} things move`;
}
