import { useEffect, useRef } from 'react';
import { CELL_CLASS_VALUES, type WalkableResult, classifyCells } from '@/core/walkable';
import { type Projector, toPaper } from '@/render/projector';

/**
 * Which floor counts, and why the rest doesn't.
 *
 * A single number is an assertion; this is the evidence for it. The four-way
 * split is what makes the figure arguable rather than oracular — not just
 * "this much floor works" but "that strip is too narrow to walk down" and "you
 * can't get behind there at all".
 *
 * Drawn on a real `<canvas>` rather than as SVG rects (one per cell would be
 * thousands of nodes) and rather than a data-URI `<image>` (a synchronous
 * base64 encode of the whole raster on every recompute, which is exactly the
 * work that must not happen while dragging).
 */

const COLOURS: Record<number, [number, number, number, number]> = {
  [CELL_CLASS_VALUES.outside]: [0, 0, 0, 0],
  [CELL_CLASS_VALUES.blocked]: [0, 0, 0, 0],
  /* The headline set, in the app's one saturated colour. */
  [CELL_CLASS_VALUES.walkable]: [47, 143, 122, 92],
  /* Free floor a body cannot fit into. */
  [CELL_CLASS_VALUES['too-narrow']]: [180, 103, 31, 96],
  /* Wide enough, but sealed off from the door. */
  [CELL_CLASS_VALUES.unreachable]: [176, 58, 58, 96],
};

export function HeatOverlay({
  result,
  projector,
  width,
  height,
}: {
  result: WalkableResult;
  projector: Projector;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;

    const { grid } = result;
    const classes = classifyCells(result);

    /* Paint at grid resolution into a small offscreen buffer, then let the
       browser scale it up. Painting at device resolution would mean one fill
       per cell per frame; this is one putImageData plus one drawImage. */
    const buffer = document.createElement('canvas');
    buffer.width = grid.w;
    buffer.height = grid.h;
    const bufferCtx = buffer.getContext('2d');
    if (bufferCtx === null) return;

    const image = bufferCtx.createImageData(grid.w, grid.h);
    for (let i = 0; i < classes.length; i++) {
      const colour = COLOURS[classes[i] ?? 0] ?? [0, 0, 0, 0];
      const o = i * 4;
      image.data[o] = colour[0];
      image.data[o + 1] = colour[1];
      image.data[o + 2] = colour[2];
      image.data[o + 3] = colour[3];
    }
    bufferCtx.putImageData(image, 0, 0);

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const topLeft = toPaper(projector, { x: grid.ox, y: grid.oy });
    const w = grid.w * grid.cell * projector.k;
    const h = grid.h * grid.cell * projector.k;

    /* Nearest-neighbour: the cells are the unit of measurement, and smoothing
       them would draw a boundary the metric never claimed. */
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, topLeft.x, topLeft.y, w, h);
  }, [result, projector, width, height]);

  return <canvas className="heat" ref={ref} style={{ width, height }} aria-hidden="true" />;
}
