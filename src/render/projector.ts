import type { Rect, Vec } from '@/core/geometry';
import type { Mm } from '@/core/units';

/**
 * The mapping between model millimetres and the units the SVG is drawn in.
 *
 * Two coordinate spaces exist on every drawing, and confusing them is the
 * classic SVG-plan bug:
 *
 *   - **model space** — millimetres of real room. Walls, furniture, zones.
 *   - **paper space** — the SVG's own units. Text, dimension lines, labels.
 *
 * Geometry is drawn inside a `<g transform="translate(…) scale(k)">` so it can
 * be written in raw millimetres. Annotation is *not*: 8 pt text has to be 8 pt
 * whether the plan is at 1:25 or 1:100, so annotation is positioned by
 * projecting model points into paper space in JS and drawing there.
 *
 * Stroke widths inside the scaled group are the other half of the trap. A
 * `stroke-width` of 1 inside a group scaled by 0.04 renders as 0.04 units. The
 * `sw` helper pre-divides so a wall drawn at "0.6 paper units" actually looks
 * 0.6 units thick at any scale.
 *
 * `vector-effect="non-scaling-stroke"` deliberately isn't used: it is defined
 * in device pixels, not paper units, so it gives a line whose physical
 * thickness differs between screen and printer — the one property the printed
 * sheet cannot afford to get wrong.
 */
export interface Projector {
  /** Paper units per model millimetre. */
  k: number;
  /** Paper-space offset applied after scaling. */
  ox: number;
  oy: number;
}

export function makeProjector(k: number, ox: number, oy: number): Projector {
  return { k, ox, oy };
}

/**
 * Fit a model-space rectangle into a paper-space box, centred, with a margin.
 *
 * The margin is in paper units and is applied on all four sides, so a caller
 * asking for a 24-unit margin gets room for dimension lines and labels without
 * doing the arithmetic itself.
 */
export function fitProjector(
  content: Rect,
  viewport: { width: number; height: number },
  margin = 0,
): Projector {
  const availableW = Math.max(viewport.width - margin * 2, 1);
  const availableH = Math.max(viewport.height - margin * 2, 1);
  const k = Math.min(availableW / Math.max(content.w, 1), availableH / Math.max(content.d, 1));

  return {
    k,
    ox: margin + (availableW - content.w * k) / 2 - content.x * k,
    oy: margin + (availableH - content.d * k) / 2 - content.y * k,
  };
}

/** The transform to put on the geometry group. */
export function geometryTransform(p: Projector): string {
  return `translate(${p.ox} ${p.oy}) scale(${p.k})`;
}

/** Model point → paper point. Use for anything drawn outside the scaled group. */
export function toPaper(p: Projector, point: Vec): { x: number; y: number } {
  return { x: p.ox + point.x * p.k, y: p.oy + point.y * p.k };
}

/** Paper point → model point. Use for hit-testing a pointer event. */
export function toModel(p: Projector, point: { x: number; y: number }): { x: number; y: number } {
  return { x: (point.x - p.ox) / p.k, y: (point.y - p.oy) / p.k };
}

/** A model length in paper units. */
export function toPaperLength(p: Projector, length: Mm): number {
  return length * p.k;
}

/**
 * The `stroke-width` to use *inside* the scaled geometry group so the line
 * renders `paperUnits` thick.
 */
export function sw(p: Projector, paperUnits: number): number {
  return p.k === 0 ? paperUnits : paperUnits / p.k;
}
