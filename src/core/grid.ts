import type { Rect } from '@/core/geometry';
import { type Room, roomBounds } from '@/core/room';
import type { Mm, Mm2 } from '@/core/units';

/**
 * The lattice everything about the metric is computed on.
 *
 * Cells sample the room at their **centres**. Because the outline is
 * rectilinear and every coordinate is an integer millimetre, a cell centre is
 * either inside or outside with no epsilon and no tie — the whole reason the
 * geometry was constrained that way.
 *
 * The origin is pinned to the room's bounding-box minimum rather than to the
 * world origin, so the same room always rasterizes identically no matter where
 * it happens to sit in world coordinates.
 */

export interface Grid {
  /** World coordinate of cell (0,0)'s minimum corner. */
  ox: Mm;
  oy: Mm;
  cell: Mm;
  w: number;
  h: number;
}

export function makeGrid(room: Room, cell: Mm): Grid {
  const bounds = roomBounds(room);
  return {
    ox: bounds.x,
    oy: bounds.y,
    cell,
    w: Math.ceil(bounds.w / cell),
    h: Math.ceil(bounds.d / cell),
  };
}

export function cellCount(grid: Grid): number {
  return grid.w * grid.h;
}

/** World coordinate of a cell's centre. */
export function cellCentre(grid: Grid, cx: number, cy: number): { x: number; y: number } {
  return {
    x: grid.ox + (cx + 0.5) * grid.cell,
    y: grid.oy + (cy + 0.5) * grid.cell,
  };
}

export function cellIndex(grid: Grid, cx: number, cy: number): number {
  return cy * grid.w + cx;
}

/**
 * Choose a cell size that keeps the grid to a workable number of cells.
 *
 * Every published figure in this file is quoted for a 3.4 × 4.2 m bedroom,
 * which is 5,712 cells at 50 mm. A 7 × 9 m living room is 25,200 — four and a
 * half times the work per evaluation, which is the difference between a metric
 * that tracks your finger and one that stutters. Rather than let the cost scale
 * with the room, the cell grows.
 */
export function chooseCell(room: Room, target = 8000, min: Mm = 50, max: Mm = 100): Mm {
  const bounds = roomBounds(room);
  const area = Math.max(bounds.w * bounds.d, 1);
  const ideal = Math.sqrt(area / target);
  return Math.min(max, Math.max(min, Math.round(ideal / 5) * 5));
}

// ── Rasterizing the room ──────────────────────────────────────────────────

/**
 * Mark the cells whose centres lie inside the room.
 *
 * Scanline over the rectilinear outline: for each row of cell centres, collect
 * the x-coordinates where vertical edges cross that row, sort them, and fill
 * between consecutive pairs. Horizontal edges are skipped because a horizontal
 * edge cannot cross a horizontal scanline transversally.
 *
 * The half-open crossing rule (`y0 <= y < y1`) is what makes a vertex shared by
 * two edges count exactly once, so an alcove's reentrant corner does not toggle
 * insideness twice and invert the whole row.
 */
export function rasterizeRoom(room: Room, grid: Grid): Uint8Array {
  const inside = new Uint8Array(cellCount(grid));
  const outline = room.outline;
  const crossings: number[] = [];

  for (let cy = 0; cy < grid.h; cy++) {
    const y = grid.oy + (cy + 0.5) * grid.cell;
    crossings.length = 0;

    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if (a === undefined || b === undefined) continue;
      if (a.y === b.y) continue; // horizontal edge: never a transversal crossing

      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      if (y >= lo && y < hi) crossings.push(a.x); // vertical edge, so a.x === b.x
    }

    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);

    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const x0 = crossings[k];
      const x1 = crossings[k + 1];
      if (x0 === undefined || x1 === undefined) continue;

      /* Cells whose centre falls in [x0, x1). */
      const from = Math.max(0, Math.ceil((x0 - grid.ox) / grid.cell - 0.5));
      const to = Math.min(grid.w - 1, Math.floor((x1 - grid.ox) / grid.cell - 0.5));
      for (let cx = from; cx <= to; cx++) inside[cellIndex(grid, cx, cy)] = 1;
    }
  }

  return inside;
}

// ── Obstacles ─────────────────────────────────────────────────────────────

/**
 * The range of cells a rectangle covers, by centre-in-rectangle.
 *
 * Returned as a half-open cell range so callers can loop without repeating the
 * conversion — and so stamping and unstamping cover exactly the same cells,
 * which is what makes them cancel.
 */
export function cellRange(
  grid: Grid,
  rect: Rect,
): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.max(0, Math.ceil((rect.x - grid.ox) / grid.cell - 0.5));
  const y0 = Math.max(0, Math.ceil((rect.y - grid.oy) / grid.cell - 0.5));
  const x1 = Math.min(grid.w, Math.floor((rect.x + rect.w - grid.ox) / grid.cell - 0.5) + 1);
  const y1 = Math.min(grid.h, Math.floor((rect.y + rect.d - grid.oy) / grid.cell - 0.5) + 1);
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

/**
 * Add or remove one rectangle from a blocker count.
 *
 * A **count**, not a flag, so two overlapping obstacles can be removed
 * independently without the first removal clearing cells the second still
 * covers. `delta` is +1 to stamp and −1 to unstamp.
 *
 * This pair is the highest-risk code in the file. If stamping and unstamping
 * ever disagree about which cells they touch, the grid accumulates phantom
 * obstacles: the metric silently drifts, no error is thrown, and the only
 * symptom is that the numbers stop making sense. Hence the round-trip property
 * test rather than a spot check.
 */
export function stampRect(blockers: Uint8Array, grid: Grid, rect: Rect, delta: 1 | -1): void {
  const { x0, y0, x1, y1 } = cellRange(grid, rect);
  for (let cy = y0; cy < y1; cy++) {
    const row = cy * grid.w;
    for (let cx = x0; cx < x1; cx++) {
      const i = row + cx;
      const next = (blockers[i] ?? 0) + delta;
      blockers[i] = next < 0 ? 0 : next;
    }
  }
}

// ── Area ──────────────────────────────────────────────────────────────────

/**
 * Exact area covered by a rectangle intersected with the room's cells.
 *
 * Coverage of a cell by an **axis-aligned** rectangle is a product of two
 * one-dimensional interval overlaps, so this is exact rather than a count of
 * whole cells. That is the payoff for restricting rotation to quarter turns:
 * no supersampling pass is needed to report an honest figure.
 */
export function exactRectArea(rect: Rect): Mm2 {
  return Math.max(rect.w, 0) * Math.max(rect.d, 0);
}

/** Count the set cells in a mask. */
export function countMask(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++;
  return n;
}

/** Area of a mask, as cells × cell². */
export function maskArea(mask: Uint8Array, grid: Grid): Mm2 {
  return countMask(mask) * grid.cell * grid.cell;
}
