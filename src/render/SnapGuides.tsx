import { type RefObject, useImperativeHandle, useRef, useState } from 'react';
import type { Rect } from '@/core/geometry';
import type { SnapHit } from '@/core/snapping';
import { type Projector, toPaper } from '@/render/projector';

/**
 * The lines that explain what just happened.
 *
 * A snap with no guide is indistinguishable from a bug. The item jumps, and the
 * only available reading is that the app moved it somewhere you did not ask
 * for. The guide converts the same jump into "it went flush to the wardrobe",
 * which is the entire difference between a feature and a glitch.
 *
 * ## Why this owns its own state
 *
 * `useItemDrag` goes to some trouble not to re-render anything while a drag is
 * in flight — a furnished room is several hundred SVG nodes and pushing every
 * frame through React reconciles all of them. Holding the guides in `RoomPlan`
 * would throw that away, because a `setState` there re-renders the plan and
 * everything under it.
 *
 * So the guides are a leaf with their own state, driven imperatively through a
 * ref. A `setState` here re-renders two lines and a label. And it only fires
 * when the snap actually *changes*: sliding along a wall keeps hitting the same
 * target, so after the first frame there are no renders at all until you cross
 * onto something else.
 */

export interface GuideHandle {
  show(hits: readonly SnapHit[], moving: Rect): void;
  hide(): void;
}

interface Shown {
  hits: readonly SnapHit[];
  moving: Rect;
}

/** Identity of a snap for change detection: axis, line, and what it came from. */
function signature(hits: readonly SnapHit[]): string {
  return hits.map((h) => `${h.axis}:${h.target.at}:${h.target.kind}:${h.target.label}`).join('|');
}

export function SnapGuides({
  projector,
  handle,
}: {
  projector: Projector;
  handle: RefObject<GuideHandle | null>;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const signatureRef = useRef('');

  useImperativeHandle(
    handle,
    () => ({
      show(hits, moving) {
        const next = signature(hits);
        /* The whole reason this is cheap. A drag along a wall produces the same
           signature every frame; re-rendering on each one would defeat the
           imperative drag it exists to support. */
        if (next === signatureRef.current) return;
        signatureRef.current = next;
        setShown(hits.length === 0 ? null : { hits, moving });
      },
      hide() {
        if (signatureRef.current === '') return;
        signatureRef.current = '';
        setShown(null);
      },
    }),
    [],
  );

  if (shown === null) return null;

  return (
    <g className="guides" aria-hidden="true">
      {shown.hits.map((hit) => (
        <Guide key={hit.axis} hit={hit} moving={shown.moving} projector={projector} />
      ))}
    </g>
  );
}

function Guide({ hit, moving, projector }: { hit: SnapHit; moving: Rect; projector: Projector }) {
  const { target } = hit;

  /* The guide spans the thing you aligned to *and* the item you aligned, so it
     reads as a relationship between two objects. Drawn only across the target's
     own extent it looks like a line that happens to be there; drawn across the
     whole room it stops pointing at anything. */
  const movingLo = target.axis === 'x' ? moving.y : moving.x;
  const movingHi = target.axis === 'x' ? moving.y + moving.d : moving.x + moving.w;
  const from = Math.min(target.span.from, movingLo);
  const to = Math.max(target.span.to, movingHi);

  const a =
    target.axis === 'x'
      ? toPaper(projector, { x: target.at, y: from })
      : toPaper(projector, { x: from, y: target.at });
  const b =
    target.axis === 'x'
      ? toPaper(projector, { x: target.at, y: to })
      : toPaper(projector, { x: to, y: target.at });

  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  return (
    <g className={`guide guide--${target.kind}`}>
      {/* Paper units directly. `sw()` is for lines drawn *inside* the scaled
          geometry group; these are projected to paper space already, and
          dividing by the scale again makes the guide a slab. */}
      <line className="guide__line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1.5} />
      {/* Offset off the line rather than centred on it, so the caption does not
          sit on top of the very thing it is describing. */}
      <text
        className="guide__label"
        x={target.axis === 'x' ? mid.x + 6 : mid.x}
        y={target.axis === 'x' ? mid.y : mid.y - 6}
        textAnchor={target.axis === 'x' ? 'start' : 'middle'}
      >
        {target.label}
      </text>
    </g>
  );
}
