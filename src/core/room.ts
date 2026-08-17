import { type Rect, type Vec, boundingRectOfPoints } from '@/core/geometry';
import type { Mm, Mm2 } from '@/core/units';

/**
 * The room outline is a closed, simple, **rectilinear** polygon wound
 * clockwise, with the first vertex not repeated at the end.
 *
 * Rectilinear — every edge axis-aligned, every corner 90° — is the single
 * assumption the rest of the codebase leans on hardest. It makes a cell either
 * fully inside or fully outside (no partial-coverage epsilon), makes collision
 * two interval tests, and makes every printed measurement a distance to a wall
 * rather than a triangulation. It costs nothing in coverage: alcoves, L-shapes,
 * chimney breasts and stepped bays are all rectilinear.
 *
 * A plain rectangle is just four vertices, so supporting polygons from the
 * start costs no extra code path downstream. Retrofitting it later would be a
 * migration through every stored document.
 */

// ── Winding ───────────────────────────────────────────────────────────────

/**
 * Twice the signed area, by the shoelace formula.
 *
 * In this codebase's y-down coordinates, a polygon that reads clockwise
 * on screen has a **positive** signed area. (In the more familiar y-up
 * convention the sign is flipped; the discrepancy is the whole reason this is
 * spelled out rather than inferred at each call site.)
 */
export function signedArea2(outline: readonly Vec[]): number {
  let total = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a === undefined || b === undefined) continue;
    total += a.x * b.y - b.x * a.y;
  }
  return total;
}

/** Enclosed area. Always positive, whichever way the outline is wound. */
export function polygonArea(outline: readonly Vec[]): Mm2 {
  return Math.abs(signedArea2(outline)) / 2;
}

export function isClockwise(outline: readonly Vec[]): boolean {
  return signedArea2(outline) > 0;
}

/** Return the outline wound clockwise, reversing it only if needed. */
export function toClockwise(outline: readonly Vec[]): Vec[] {
  return isClockwise(outline) ? [...outline] : outline.toReversed();
}

// ── Validation ────────────────────────────────────────────────────────────

export type OutlineProblem =
  | { code: 'too-few-vertices'; count: number }
  | { code: 'zero-length-edge'; index: number }
  | { code: 'not-rectilinear'; index: number }
  | { code: 'collinear-corner'; index: number }
  | { code: 'self-intersecting'; index: number; otherIndex: number }
  | { code: 'zero-area' };

/**
 * Check an outline for every condition the metric and the renderer assume.
 *
 * Returns all problems rather than the first, so a room form can highlight
 * every bad corner at once instead of making someone fix them one reload at a
 * time. An empty array means the outline is safe to build a room from.
 */
export function validateOutline(outline: readonly Vec[]): OutlineProblem[] {
  const problems: OutlineProblem[] = [];
  const n = outline.length;

  if (n < 4) {
    problems.push({ code: 'too-few-vertices', count: n });
    return problems;
  }

  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (a === undefined || b === undefined) continue;

    const horizontal = a.y === b.y;
    const vertical = a.x === b.x;

    if (horizontal && vertical) {
      problems.push({ code: 'zero-length-edge', index: i });
    } else if (!horizontal && !vertical) {
      problems.push({ code: 'not-rectilinear', index: i });
    }
  }

  /* Two consecutive edges on the same axis mean a vertex that is not really a
     corner. Harmless to draw, but it desynchronises wall indices from what the
     user sees as walls, and every later feature attaches to a wall index. */
  for (let i = 0; i < n; i++) {
    const prev = outline[(i - 1 + n) % n];
    const cur = outline[i];
    const next = outline[(i + 1) % n];
    if (prev === undefined || cur === undefined || next === undefined) continue;

    const inHorizontal = prev.y === cur.y;
    const outHorizontal = cur.y === next.y;
    if (inHorizontal === outHorizontal) {
      problems.push({ code: 'collinear-corner', index: i });
    }
  }

  for (const hit of findSelfIntersections(outline)) problems.push(hit);

  if (problems.length === 0 && polygonArea(outline) === 0) {
    problems.push({ code: 'zero-area' });
  }

  return problems;
}

/**
 * Find edge pairs that cross or overlap.
 *
 * O(n²), which is correct here: a hand-measured room has a handful of walls,
 * and a sweep-line would be more code to get wrong for no measurable gain.
 * Adjacent edges are skipped — they legitimately share a vertex.
 */
function findSelfIntersections(
  outline: readonly Vec[],
): Extract<OutlineProblem, { code: 'self-intersecting' }>[] {
  const hits: Extract<OutlineProblem, { code: 'self-intersecting' }>[] = [];
  const n = outline.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;

      const a1 = outline[i];
      const a2 = outline[(i + 1) % n];
      const b1 = outline[j];
      const b2 = outline[(j + 1) % n];
      if (a1 === undefined || a2 === undefined || b1 === undefined || b2 === undefined) continue;

      if (segmentsIntersect(a1, a2, b1, b2)) {
        hits.push({ code: 'self-intersecting', index: i, otherIndex: j });
      }
    }
  }

  return hits;
}

/**
 * Do two axis-aligned segments share any point?
 *
 * Only valid for axis-aligned input, which is guaranteed by the rectilinear
 * check running first. Restricting to that case keeps this exact integer
 * arithmetic — no cross products, no epsilon, no float.
 */
function segmentsIntersect(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  const aMinX = Math.min(a1.x, a2.x);
  const aMaxX = Math.max(a1.x, a2.x);
  const aMinY = Math.min(a1.y, a2.y);
  const aMaxY = Math.max(a1.y, a2.y);
  const bMinX = Math.min(b1.x, b2.x);
  const bMaxX = Math.max(b1.x, b2.x);
  const bMinY = Math.min(b1.y, b2.y);
  const bMaxY = Math.max(b1.y, b2.y);

  return aMinX <= bMaxX && bMinX <= aMaxX && aMinY <= bMaxY && bMinY <= aMaxY;
}

// ── Walls ─────────────────────────────────────────────────────────────────

export type Axis = 'horizontal' | 'vertical';

/**
 * One wall, derived from the outline rather than stored alongside it.
 *
 * Deriving means the two can never disagree, which matters because every
 * feature (door, window, radiator) is positioned as an offset along a wall. A
 * stored wall list that drifts out of sync with the polygon would put a door
 * in mid-air.
 */
export interface Wall {
  /** Index into the outline; the wall runs from `outline[index]` onward. */
  index: number;
  start: Vec;
  end: Vec;
  length: Mm;
  axis: Axis;
  /** Exact unit vector from `start` toward `end`. One component is always 0. */
  direction: Vec;
  /** Exact unit vector pointing into the room. One component is always 0. */
  inward: Vec;
}

/** Exact −1 / 0 / +1, with no negative zero. `Math.sign` returns `-0` for `-0`. */
function unitStep(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * Split a clockwise outline into walls.
 *
 * The inward normal of edge `(dx, dy)` is `(-dy, dx)` normalised. That is the
 * clockwise quarter turn in y-down coordinates, and for a clockwise-wound
 * polygon it points at the interior on every edge — no per-edge sign test, no
 * point-in-polygon probe.
 *
 * Normalising by *sign* rather than by dividing by the length is not a
 * micro-optimisation. Edges here are axis-aligned, so the unit normal is always
 * exactly one of the four axis directions; computing it as `-dy / length`
 * returns 0.9999999999999999 for a 3400 mm wall, and a normal that is not
 * exactly ±1 propagates a fractional millimetre into every clearance zone
 * generated off that wall.
 */
export function deriveWalls(outline: readonly Vec[]): Wall[] {
  const walls: Wall[] = [];
  const n = outline.length;

  for (let i = 0; i < n; i++) {
    const start = outline[i];
    const end = outline[(i + 1) % n];
    if (start === undefined || end === undefined) continue;

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    walls.push({
      index: i,
      start,
      end,
      length: Math.abs(dx) + Math.abs(dy), // one term is always zero
      axis: dy === 0 ? 'horizontal' : 'vertical',
      direction: { x: unitStep(dx), y: unitStep(dy) },
      /* Negate the input, not the result: `-unitStep(0)` is `-0`, which
         compares equal under `===` but not under `Object.is` and would make two
         identical walls hash differently. */
      inward: { x: unitStep(-dy), y: unitStep(dx) },
    });
  }

  return walls;
}

/**
 * A point at distance `offset` along a wall from its start vertex.
 *
 * Steps by the wall's exact unit direction rather than interpolating by
 * `offset / length`, so an integer offset lands on an integer coordinate. This
 * is the function every door and window position goes through, and a
 * half-millimetre of interpolation error here would show up as a doorway that
 * does not line up with the wall it is cut into.
 */
export function pointAlongWall(wall: Wall, offset: Mm): Vec {
  return {
    x: wall.start.x + wall.direction.x * offset,
    y: wall.start.y + wall.direction.y * offset,
  };
}

// ── Room ──────────────────────────────────────────────────────────────────

export interface Room {
  /** Clockwise, rectilinear, first vertex not repeated. */
  outline: Vec[];
  /** Drawing only. The outline is the *inside* face of the walls. */
  wallThickness: Mm;
  ceilingHeight: Mm;
}

export const DEFAULT_WALL_THICKNESS: Mm = 100;
export const DEFAULT_CEILING_HEIGHT: Mm = 2400;

/**
 * Build a room from an outline, normalising the winding.
 *
 * Throws if the outline is unusable — callers validate first and show the
 * problems. Constructing an invalid room and letting the metric deal with it
 * would produce a plausible-looking number computed over nonsense.
 */
export function makeRoom(
  outline: readonly Vec[],
  options: { wallThickness?: Mm; ceilingHeight?: Mm } = {},
): Room {
  const problems = validateOutline(outline);
  if (problems.length > 0) {
    throw new RangeError(`outline is not a usable room: ${problems.map((p) => p.code).join(', ')}`);
  }

  return {
    outline: toClockwise(outline),
    wallThickness: options.wallThickness ?? DEFAULT_WALL_THICKNESS,
    ceilingHeight: options.ceilingHeight ?? DEFAULT_CEILING_HEIGHT,
  };
}

/** A plain rectangular room with its top-left corner at the origin. */
export function makeRectangularRoom(
  width: Mm,
  depth: Mm,
  options: { wallThickness?: Mm; ceilingHeight?: Mm } = {},
): Room {
  return makeRoom(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: depth },
      { x: 0, y: depth },
    ],
    options,
  );
}

export function roomWalls(room: Room): Wall[] {
  return deriveWalls(room.outline);
}

/**
 * The room's floor area.
 *
 * Always from the polygon, never from a count of raster cells. The two differ
 * by up to a cell row, and if the denominator of "percentage of the room that
 * is walkable" moved with the grid resolution, the same room would report
 * different percentages in the editor and on the printed sheet.
 */
export function roomArea(room: Room): Mm2 {
  return polygonArea(room.outline);
}

export function roomBounds(room: Room): Rect {
  return boundingRectOfPoints(room.outline);
}

/**
 * Is a point inside the room? Uses a crossing count, with the boundary treated
 * as inside on the min edges and outside on the max edges — the same half-open
 * rule as `rectContainsPoint`, so a point cannot belong to two cells at once.
 */
export function roomContains(room: Room, p: Vec): boolean {
  const outline = room.outline;
  let inside = false;

  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a === undefined || b === undefined) continue;

    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }

  return inside;
}
