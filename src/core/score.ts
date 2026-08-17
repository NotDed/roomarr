import { type Violation, checkLayout } from '@/core/constraints';
import type { Feature } from '@/core/features';
import { type Rect, rectsOverlap } from '@/core/geometry';
import {
  type Item,
  type Layout,
  clearanceRect,
  itemRect,
  placedItems,
  sideDirection,
} from '@/core/items';
import { largestFreeRect, rectAreaMm2 } from '@/core/metrics';
import { type Room, distanceToNearestWall, rectInsideRoom, roomArea } from '@/core/room';
import type { Mm, Mm2 } from '@/core/units';
import { BODY_RADII, computeWalkable } from '@/core/walkable';
import type { WallId } from '@/core/wallrun';

/**
 * How good is an arrangement?
 *
 * Walkable floor dominates, because that is the metric this project exists to
 * move. But it cannot be the *only* term, for a reason worth stating plainly:
 * a search maximising walkable area alone converges on furniture ringed around
 * every wall, leaving a doughnut of circulation that measures beautifully and
 * is useless as a room. Every other term here exists to rule out a specific
 * failure of that kind, not to express taste.
 *
 * ── Rules the terms obey ─────────────────────────────────────────────────
 *
 * **Every soft term returns a scalar in [0, 1], never a boolean.** A step
 * function gives a search a plateau it cannot descend: half the moves score
 * identically and it wanders. Ramps give it a gradient to follow.
 *
 * **Hard violations are rejection, not cost.** A layout with the bed across
 * the doorway is not a bad layout, it is not a layout. Scoring it as merely
 * expensive lets a search trade it against a bit more floor.
 *
 * **Weights are published in m², not in points.** `explainWeights` states what
 * each term is worth in walkable floor, so a weight is arguable rather than
 * magic — and a term that never changes a decision should be deleted, not
 * tuned.
 */

export interface Weights {
  walkableArea: number;
  largestRect: number;
  clearanceMargin: number;
  functional: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  /* Dominant by design. */
  walkableArea: 1.0,
  /* The doughnut correction. */
  largestRect: 0.18,
  /* Pushes past the bare minimum toward comfortable. */
  clearanceMargin: 0.14,
  /* Headboards, nightstands, desks and screens. */
  functional: 0.12,
};

export interface ScoreInput {
  room: Room;
  items: readonly Item[];
  layout: Layout;
  features: readonly Feature[];
  wallIds: readonly WallId[];
  roomIsSleeping: boolean;
  weights?: Weights;
  /**
   * Coarser grid for search, finer for display.
   *
   * A search evaluates thousands of layouts and only ever compares them with
   * each other, so it can afford a coarse grid; the figure a person reads is
   * computed once and should be exact. Mixing the two up is how a tool ends up
   * reporting a number it did not actually optimise.
   */
  cell?: Mm;
}

export interface ScoreBreakdown {
  total: number;
  walkableMm2: Mm2;
  largestRectMm2: Mm2;
  terms: { name: keyof Weights; raw: number; weighted: number }[];
  violations: Violation[];
  feasible: boolean;
}

/**
 * Score a layout.
 *
 * Returns the breakdown rather than a bare number, so the UI can say *why* one
 * arrangement beat another instead of asserting that it did.
 */
export function scoreLayout(input: ScoreInput): ScoreBreakdown {
  const weights = input.weights ?? DEFAULT_WEIGHTS;

  const walkable = computeWalkable({
    room: input.room,
    items: input.items,
    layout: input.layout,
    features: input.features,
    wallIds: input.wallIds,
    radius: BODY_RADII.comfort,
    ...(input.cell === undefined ? {} : { cell: input.cell }),
  });

  const violations = checkLayout({
    room: input.room,
    items: input.items,
    layout: input.layout,
    features: input.features,
    wallIds: input.wallIds,
    roomIsSleeping: input.roomIsSleeping,
  });
  const feasible = !violations.some((v) => v.severity === 'hard');

  /* The most floor that could possibly be walkable: the room minus what the
     furniture stands on. Normalising against this rather than against the room
     keeps the term comparable between a sparse room and a crowded one. */
  const footprints = placedItems(input.items, input.layout)
    .filter(({ item }) => !item.overlappable)
    .reduce((sum, { item, placement }) => sum + rectAreaMm2(itemRect(item, placement)), 0);
  const headroom = Math.max(roomArea(input.room) - footprints, 1);

  const rect = largestFreeRect(walkable.walkable, walkable.grid);
  const largestRectMm2 = rectAreaMm2(rect);

  const terms: ScoreBreakdown['terms'] = [
    {
      name: 'walkableArea',
      raw: clamp01(walkable.walkableMm2 / headroom),
      weighted: 0,
    },
    {
      /* Against a quarter of the available floor: asking for one usable space
         rather than for the whole room to be a single rectangle. */
      name: 'largestRect',
      raw: clamp01(largestRectMm2 / (headroom * 0.25)),
      weighted: 0,
    },
    { name: 'clearanceMargin', raw: clearanceMargin(input), weighted: 0 },
    { name: 'functional', raw: functionalScore(input), weighted: 0 },
  ];

  let total = 0;
  for (const term of terms) {
    term.weighted = term.raw * weights[term.name];
    total += term.weighted;
  }

  return {
    total,
    walkableMm2: walkable.walkableMm2,
    largestRectMm2,
    terms,
    violations,
    feasible,
  };
}

/**
 * How comfortable the clearances are, beyond merely legal.
 *
 * Ramps from the required depth to the preferred one, so the search keeps
 * pushing past the bare minimum instead of stopping the moment a rule is
 * technically satisfied. A rule with no preferred depth counts as satisfied.
 */
function clearanceMargin(input: ScoreInput): number {
  const placed = placedItems(input.items, input.layout);
  const solids = placed.filter(({ item }) => !item.overlappable);

  let total = 0;
  let count = 0;

  for (const { item, placement } of placed) {
    for (const rule of item.clearances) {
      const preferred = rule.preferred;
      if (preferred === undefined || preferred <= rule.depth) continue;

      const zone = clearanceRect(item, placement, {
        ...rule,
        depth: preferred,
      });

      const clear =
        rectInsideRoom(input.room, zone) &&
        !solids.some(
          (other) =>
            other.item.id !== item.id &&
            other.item.height > rule.minHeight &&
            !(rule.nestsWith ?? []).includes(other.item.type) &&
            rectsOverlap(zone, itemRect(other.item, other.placement)),
        );

      total += clear ? 1 : 0;
      count++;
    }
  }

  return count === 0 ? 1 : total / count;
}

/**
 * The conventions a human notices instantly when they are broken.
 *
 * Each sub-term is a specific complaint someone would voice about a room, not
 * an aesthetic preference: a bed with its head in open space feels wrong to
 * sleep in, a nightstand you cannot reach from the bed is furniture in the
 * wrong place, a desk facing a bright window is a room you squint in.
 */
function functionalScore(input: ScoreInput): number {
  const placed = placedItems(input.items, input.layout);
  if (placed.length === 0) return 1;

  const parts: number[] = [];

  const beds = placed.filter(({ item }) => item.type === 'bed');
  const stands = placed.filter(({ item }) => item.type === 'nightstand');

  for (const bed of beds) {
    const rect = itemRect(bed.item, bed.placement);

    /* Headboard against something solid. `back` is the headboard side. */
    const back = sideDirection('back', bed.placement.pose.rot);
    const behind: Rect = {
      x: back.x === 1 ? rect.x + rect.w : back.x === -1 ? rect.x - 100 : rect.x,
      y: back.y === 1 ? rect.y + rect.d : back.y === -1 ? rect.y - 100 : rect.y,
      w: back.x === 0 ? rect.w : 100,
      d: back.y === 0 ? rect.d : 100,
    };
    parts.push(rectInsideRoom(input.room, behind) ? 0 : 1);

    /* A nightstand within reach of the bed. */
    if (stands.length > 0) {
      const reachable = stands.some((stand) => {
        const s = itemRect(stand.item, stand.placement);
        const gap = gapBetween(rect, s);
        return gap <= 150;
      });
      parts.push(reachable ? 1 : 0);
    }
  }

  /* Tall things away from windows, so daylight is not walled off. */
  const windows = input.features.filter((f) => f.kind === 'window');
  if (windows.length > 0) {
    const tall = placed.filter(({ item }) => item.height > 1400);
    parts.push(tall.length === 0 ? 1 : 0.5);
  }

  /* Wall-hugging tiebreak. Deliberately weak: it nudges a search out of the
     plateau where many moves score identically, without ever outweighing a
     real term. */
  const hugging =
    placed.filter(({ item, placement }) => {
      if (item.allowFloat) return true;
      return distanceToNearestWall(input.room, itemRect(item, placement)).mm <= 100;
    }).length / placed.length;
  parts.push(hugging);

  return parts.length === 0 ? 1 : parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Shortest gap between two rectangles; 0 when they touch or overlap. */
function gapBetween(a: Rect, b: Rect): Mm {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.d), a.y - (b.y + b.d), 0);
  return Math.round(Math.hypot(dx, dy));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * What each weight is worth, in square metres of walkable floor.
 *
 * The point of publishing this is that a weight becomes arguable. "The
 * headboard rule is worth 0.3 m²" is a claim someone can disagree with; "the
 * functional weight is 0.12" is not. If a term turns out never to change which
 * layout wins, the right response is to delete it rather than tune it.
 */
export function explainWeights(
  headroomMm2: Mm2,
  weights: Weights = DEFAULT_WEIGHTS,
): {
  name: keyof Weights;
  worthM2: number;
}[] {
  const perPoint = headroomMm2 / 1_000_000 / weights.walkableArea;
  return (Object.keys(weights) as (keyof Weights)[]).map((name) => ({
    name,
    worthM2: Math.round(weights[name] * perPoint * 100) / 100,
  }));
}
