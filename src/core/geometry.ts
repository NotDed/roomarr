import { type Mm, type Mm2, roundMm } from '@/core/units';

/**
 * ── Coordinate conventions ────────────────────────────────────────────────
 *
 * One convention, used everywhere, with no flips anywhere in the codebase:
 *
 *   +x is right, +y is DOWN, and positive rotation is CLOCKWISE.
 *
 * This matches SVG, which is what the editor and the printed sheets both
 * render into. The alternative (y-up, counter-clockwise-positive, as in maths)
 * would mean flipping at the render boundary, and a y-flip that is applied in
 * one place and forgotten in another is the single most common source of
 * rotation bugs in plan-view software. Picking the renderer's convention makes
 * the flip unnecessary rather than merely consistent.
 *
 * ── Why poses store a corner, not a centre ────────────────────────────────
 *
 * A `Pose` records the AABB's minimum corner. Storing the footprint *centre*
 * is tempting because it is rotation-invariant, but it breaks the integer
 * guarantee immediately: a 1401 mm wardrobe pushed flush against a wall has its
 * centre at x = 700.5, which is not an integer millimetre. Once that happens
 * the rasterizer's cell-centre test is no longer exact and cell-boundary ties
 * become float-dependent.
 *
 * With a min corner, every representable pose is exactly integral for every
 * footprint size. Rotation is handled by `rotateAbout`, which recomputes the
 * corner so the shape pivots about its own centre and then rounds — a shift of
 * at most half a millimetre, applied once, rather than a fractional coordinate
 * that persists through every downstream computation.
 */

// ── Points and sizes ──────────────────────────────────────────────────────

export interface Vec {
  x: Mm;
  y: Mm;
}

/** Footprint dimensions at rotation 0. Local +x is `w`, local +y is `d`. */
export interface Size {
  w: Mm;
  d: Mm;
}

/** An axis-aligned rectangle. `x`/`y` are its minimum corner. */
export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  d: Mm;
}

// ── Rotation ──────────────────────────────────────────────────────────────

/**
 * Rotation as a quarter-turn index, 0–3, clockwise. Never as degrees.
 *
 * Degrees invite `180` and `270` being stored in an `Int8Array` in the
 * optimizer's hot loop, where they silently overflow to −76 and −114. An index
 * fits in any integer array, indexes lookup tables directly, and makes
 * "rotation is restricted to quarter turns" unrepresentable-otherwise rather
 * than merely documented.
 */
export type Rot = 0 | 1 | 2 | 3;

export const ROTATIONS: readonly Rot[] = [0, 1, 2, 3];

export function isRot(value: unknown): value is Rot {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** Normalise any integer quarter-turn count into 0–3, including negatives. */
export function normalizeRot(quarterTurns: number): Rot {
  return (((quarterTurns % 4) + 4) % 4) as Rot;
}

export function rotDegrees(rot: Rot): number {
  return rot * 90;
}

/** True for the quarter turns that exchange width and depth. */
export function swapsAxes(rot: Rot): boolean {
  return rot === 1 || rot === 3;
}

/** The footprint's extent after rotation. */
export function rotatedSize(size: Size, rot: Rot): Size {
  return swapsAxes(rot) ? { w: size.d, d: size.w } : { w: size.w, d: size.d };
}

// ── Poses ─────────────────────────────────────────────────────────────────

/**
 * Where an item sits: the minimum corner of its axis-aligned bounding box,
 * plus its quarter-turn rotation.
 *
 * Note that `x`/`y` are the corner of the *rotated* box. A 1400×600 item at
 * rot 1 occupies 600×1400 starting at (x, y).
 */
export interface Pose {
  x: Mm;
  y: Mm;
  rot: Rot;
}

/** The world-space rectangle an item occupies at a pose. */
export function poseRect(pose: Pose, size: Size): Rect {
  const { w, d } = rotatedSize(size, pose.rot);
  return { x: pose.x, y: pose.y, w, d };
}

export function poseCenter(pose: Pose, size: Size): { x: number; y: number } {
  const { w, d } = rotatedSize(size, pose.rot);
  return { x: pose.x + w / 2, y: pose.y + d / 2 };
}

/**
 * Rotate an item by `quarterTurns` while keeping its centre as close to fixed
 * as the integer grid allows.
 *
 * This is the one place a fractional coordinate can appear, and it is resolved
 * immediately: the corner shift is rounded to the nearest millimetre, so an
 * item with an odd dimension may move by up to 0.5 mm per turn. That is
 * invisible at any scale this app prints at.
 *
 * The rounding is applied to the *shift*, not to the resulting coordinate, and
 * that distinction is load-bearing. Rounding the coordinate makes the tie-break
 * direction depend on the item's position — ties away from zero resolve one way
 * left of the origin and the other way right of it — so four quarter turns do
 * not return an odd-sized item to where it started. It drifts a couple of
 * millimetres per full turn, which in the editor reads as an item slowly
 * walking across the room every time you press R. Rounding the shift instead
 * makes the four shifts cancel exactly, because `roundMm` is odd.
 */
export function rotateAbout(pose: Pose, size: Size, quarterTurns: number): Pose {
  const rot = normalizeRot(pose.rot + quarterTurns);
  const before = rotatedSize(size, pose.rot);
  const after = rotatedSize(size, rot);
  return {
    x: pose.x + roundMm((before.w - after.w) / 2),
    y: pose.y + roundMm((before.d - after.d) / 2),
    rot,
  };
}

export function translatePose(pose: Pose, dx: Mm, dy: Mm): Pose {
  return { x: pose.x + dx, y: pose.y + dy, rot: pose.rot };
}

export function posesEqual(a: Pose, b: Pose): boolean {
  return a.x === b.x && a.y === b.y && a.rot === b.rot;
}

// ── Rectangles ────────────────────────────────────────────────────────────

export function rectRight(r: Rect): Mm {
  return r.x + r.w;
}

export function rectBottom(r: Rect): Mm {
  return r.y + r.d;
}

export function rectArea(r: Rect): Mm2 {
  return r.w * r.d;
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.d / 2 };
}

/**
 * Do two rectangles share interior area?
 *
 * Touching edges do not overlap. Two wardrobes side by side at exactly the same
 * x are a legal, extremely common arrangement, and treating that as a collision
 * would make the optimizer refuse most tidy layouts. This is why the comparison
 * is strict on both sides.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

/** Area shared by two rectangles; 0 when they merely touch. */
export function rectOverlapArea(a: Rect, b: Rect): Mm2 {
  const w = Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x);
  const d = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y);
  return w > 0 && d > 0 ? w * d : 0;
}

/** Is `inner` completely inside `outer`? Sharing an edge counts as inside. */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}

/** Is a point inside, treating the min edges as inside and the max edges as out? */
export function rectContainsPoint(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x < rectRight(r) && p.y >= r.y && p.y < rectBottom(r);
}

/** Grow (or, with a negative amount, shrink) a rectangle on all four sides. */
export function inflateRect(r: Rect, by: Mm): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, d: r.d + by * 2 };
}

/** The smallest rectangle containing all of `rects`. Throws on an empty list. */
export function boundingRect(rects: readonly Rect[]): Rect {
  const first = rects[0];
  if (first === undefined) throw new RangeError('boundingRect needs at least one rectangle');

  let minX = first.x;
  let minY = first.y;
  let maxX = rectRight(first);
  let maxY = rectBottom(first);

  for (let i = 1; i < rects.length; i++) {
    const r = rects[i];
    if (r === undefined) continue;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (rectRight(r) > maxX) maxX = rectRight(r);
    if (rectBottom(r) > maxY) maxY = rectBottom(r);
  }

  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY };
}

export function boundingRectOfPoints(points: readonly Vec[]): Rect {
  const first = points[0];
  if (first === undefined) throw new RangeError('boundingRectOfPoints needs at least one point');

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY };
}

// ── Distance ──────────────────────────────────────────────────────────────

/**
 * Squared distance between two points.
 *
 * Squared, and never square-rooted, wherever a comparison will do. Distances in
 * this codebase are compared against a body radius far more often than they are
 * displayed, and integer squared distances compare exactly while square roots
 * introduce a float whose rounding can flip a corridor-width verdict.
 */
export function distSq(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Shortest squared distance from a point to a rectangle; 0 when inside. */
export function pointToRectDistSq(p: Vec, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - rectRight(r));
  const dy = Math.max(r.y - p.y, 0, p.y - rectBottom(r));
  return dx * dx + dy * dy;
}
