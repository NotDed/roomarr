import { type Rect, type Vec, pointToRectDistSq } from '@/core/geometry';
import { type Grid, cellIndex } from '@/core/grid';
import type { Room, Wall } from '@/core/room';
import { roomWalls } from '@/core/room';
import type { Mm } from '@/core/units';

/**
 * How much room there is around every point, measured exactly.
 *
 * `clearance[i]` is the distance from cell *i*'s centre to the nearest
 * obstacle edge or wall — stored **squared**, in mm², so it is compared without
 * ever taking a square root.
 *
 * ── Why this and not a distance transform on the obstacle mask ────────────
 *
 * The usual approach rasterizes obstacles to a bitmap and runs a Euclidean
 * distance transform over it. That measures distance to the nearest blocked
 * *cell*, which quantizes clearance to multiples of the cell size: at 50 mm
 * cells, a hard "is this corridor at least 700 mm" verdict carries ±50 mm of
 * error, and the same layout can come out feasible at one cell size and
 * infeasible at another. Patching that with a shared rounding rule makes the
 * two tiers agree with each other while both stay wrong.
 *
 * Here, every obstacle is an axis-aligned rectangle — because rotation is
 * restricted to quarter turns — so the exact distance from a point to the
 * nearest obstacle has a closed form, and it is already written and tested as
 * `pointToRectDistSq`. Erosion becomes exact *in the radius* at any cell size.
 * Only the sampling position is quantized, and that error is bounded by half a
 * cell diagonal over a field that is 1-Lipschitz.
 *
 * The cost is `O(cells × obstacles)` rather than `O(cells)`. For a furnished
 * bedroom that is roughly 5,700 × 15 ≈ 90k exact distance evaluations, which is
 * around a millisecond — comfortably inside a frame while dragging. If the
 * optimizer's inner loop later needs more throughput, the escape hatch is a
 * cheap surrogate with exact rescoring, not a less exact field here.
 */

export interface ClearanceField {
  /** Squared distance in mm² from each cell centre to the nearest obstacle. */
  distSq: Float64Array;
  grid: Grid;
}

/**
 * Distance from a point to the room's boundary, squared.
 *
 * Walls are segments, and a point inside the room is bounded by the nearest of
 * them. Because every wall is axis-aligned this is the same point-to-rectangle
 * calculation with a degenerate rectangle.
 */
function distSqToWall(p: Vec, wall: Wall): number {
  const x = Math.min(wall.start.x, wall.end.x);
  const y = Math.min(wall.start.y, wall.end.y);
  const degenerate: Rect = {
    x,
    y,
    w: Math.abs(wall.end.x - wall.start.x),
    d: Math.abs(wall.end.y - wall.start.y),
  };
  return pointToRectDistSq(p, degenerate);
}

/**
 * Build the clearance field.
 *
 * `inside` restricts the work to cells that are actually in the room; cells
 * outside get 0, which excludes them from every threshold downstream without a
 * separate mask test.
 */
export function computeClearance(
  room: Room,
  grid: Grid,
  obstacles: readonly Rect[],
  inside: Uint8Array,
): ClearanceField {
  const distSq = new Float64Array(grid.w * grid.h);
  const walls = roomWalls(room);

  for (let cy = 0; cy < grid.h; cy++) {
    const y = grid.oy + (cy + 0.5) * grid.cell;

    for (let cx = 0; cx < grid.w; cx++) {
      const i = cellIndex(grid, cx, cy);
      if (inside[i] === 0) continue;

      const p = { x: grid.ox + (cx + 0.5) * grid.cell, y };
      let best = Number.POSITIVE_INFINITY;

      for (const wall of walls) {
        const d = distSqToWall(p, wall);
        if (d < best) best = d;
      }

      for (const rect of obstacles) {
        /* A point inside an obstacle has zero clearance and cannot get lower,
           so bail out as soon as that happens. */
        const d = pointToRectDistSq(p, rect);
        if (d < best) best = d;
        if (best === 0) break;
      }

      distSq[i] = best;
    }
  }

  return { distSq, grid };
}

/**
 * Cells where a disc of radius `r` centred there fits entirely in free space.
 *
 * This is the configuration space of a disc-shaped walker — exactly the set of
 * places a person's centre could stand. Comparing squared distances against
 * `r²` keeps it exact integer-ish arithmetic with no square root and, crucially,
 * **no dependence on the cell size**: 350 mm means 350 mm whether the grid is
 * 50 mm or 25 mm.
 */
export function erode(field: ClearanceField, inside: Uint8Array, radius: Mm): Uint8Array {
  const out = new Uint8Array(field.distSq.length);
  const threshold = radius * radius;

  for (let i = 0; i < out.length; i++) {
    if (inside[i] !== 0 && (field.distSq[i] ?? 0) >= threshold) out[i] = 1;
  }
  return out;
}

/** The largest disc that fits anywhere in the field, and where its centre is. */
export function largestCircle(
  field: ClearanceField,
  reachable: Uint8Array,
): { centre: Vec; radius: Mm } {
  let best = -1;
  let bestIndex = -1;

  for (let i = 0; i < field.distSq.length; i++) {
    if (reachable[i] === 0) continue;
    const d = field.distSq[i] ?? 0;
    if (d > best) {
      best = d;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return { centre: { x: 0, y: 0 }, radius: 0 };

  const cx = bestIndex % field.grid.w;
  const cy = Math.floor(bestIndex / field.grid.w);
  return {
    centre: {
      x: Math.round(field.grid.ox + (cx + 0.5) * field.grid.cell),
      y: Math.round(field.grid.oy + (cy + 0.5) * field.grid.cell),
    },
    radius: Math.round(Math.sqrt(best)),
  };
}
