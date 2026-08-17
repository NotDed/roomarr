import type { Rect } from '@/core/geometry';
import type { Grid } from '@/core/grid';
import type { Mm2 } from '@/core/units';

/**
 * The biggest single rectangle of walkable floor.
 *
 * Walkable *area* alone has a specific and very likely failure mode: the
 * highest-scoring layout is furniture ringed around every wall, leaving a
 * doughnut of circulation that is maximally walkable and useless as a room.
 * Nothing in the area figure can see the difference between one open 6 m² and
 * a 6 m² loop 800 mm wide.
 *
 * The largest inscribed rectangle can, and it is what a person means by "is
 * there anywhere to put a yoga mat / a cot / a suitcase". So this term is not
 * polish — it is the specific correction for the most likely embarrassing
 * output of a search that optimises area on its own.
 *
 * Classic maximal-rectangle-in-histogram sweep: one pass down the rows keeping
 * a running height per column, and a monotonic stack per row. O(cells).
 */
export function largestFreeRect(mask: Uint8Array, grid: Grid): Rect {
  const heights = new Int32Array(grid.w);
  let best = { area: 0, x: 0, y: 0, w: 0, d: 0 };

  /* Reused across rows: the stack of column indices whose bar is still
     unclosed, and the left edge each of those bars can extend back to. */
  const stack = new Int32Array(grid.w + 1);
  const starts = new Int32Array(grid.w + 1);

  for (let cy = 0; cy < grid.h; cy++) {
    const row = cy * grid.w;
    for (let cx = 0; cx < grid.w; cx++) {
      heights[cx] = mask[row + cx] === 0 ? 0 : (heights[cx] ?? 0) + 1;
    }

    let top = 0;
    for (let cx = 0; cx <= grid.w; cx++) {
      const h = cx === grid.w ? 0 : (heights[cx] ?? 0);
      let start = cx;

      while (top > 0 && (heights[stack[top - 1] ?? 0] ?? 0) >= h) {
        top--;
        const barHeight = heights[stack[top] ?? 0] ?? 0;
        start = starts[top] ?? cx;
        const width = cx - start;
        const area = barHeight * width;
        if (area > best.area) {
          best = { area, x: start, y: cy - barHeight + 1, w: width, d: barHeight };
        }
      }

      if (cx < grid.w) {
        stack[top] = cx;
        starts[top] = start;
        top++;
      }
    }
  }

  return {
    x: grid.ox + best.x * grid.cell,
    y: grid.oy + best.y * grid.cell,
    w: best.w * grid.cell,
    d: best.d * grid.cell,
  };
}

export function rectAreaMm2(rect: Rect): Mm2 {
  return Math.max(rect.w, 0) * Math.max(rect.d, 0);
}
