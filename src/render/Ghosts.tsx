import type { Item, Placement } from '@/core/items';
import { itemRect } from '@/core/items';
import { type Projector, toPaper } from '@/render/projector';

/**
 * Where a suggestion would put things, drawn over where they are now.
 *
 * Ghost outlines plus an arrow from each item's current centre to its proposed
 * one. Showing the difference in place beats swapping the plan wholesale: a
 * before/after you have to flick between is read by memory, and memory is bad
 * at "did that get better or just different".
 */
export function Ghosts({
  items,
  from,
  to,
  projector,
}: {
  items: readonly Item[];
  from: readonly Placement[];
  to: readonly Placement[];
  projector: Projector;
}) {
  return (
    <g className="ghosts" aria-hidden="true">
      {to.map((target) => {
        const item = items.find((i) => i.id === target.itemId);
        const before = from.find((p) => p.itemId === target.itemId);
        if (item === undefined) return null;

        const rect = itemRect(item, target);
        const tl = toPaper(projector, { x: rect.x, y: rect.y });
        const br = toPaper(projector, { x: rect.x + rect.w, y: rect.y + rect.d });

        const unmoved =
          before !== undefined &&
          before.pose.x === target.pose.x &&
          before.pose.y === target.pose.y &&
          before.pose.rot === target.pose.rot;
        if (unmoved) return null;

        const arrow =
          before === undefined
            ? null
            : (() => {
                const was = itemRect(item, before);
                const a = toPaper(projector, {
                  x: was.x + was.w / 2,
                  y: was.y + was.d / 2,
                });
                const b = toPaper(projector, {
                  x: rect.x + rect.w / 2,
                  y: rect.y + rect.d / 2,
                });
                return { a, b };
              })();

        return (
          <g key={target.itemId}>
            {arrow !== null && (
              <line
                className="ghost__arrow"
                x1={arrow.a.x}
                y1={arrow.a.y}
                x2={arrow.b.x}
                y2={arrow.b.y}
                markerEnd="url(#ghost-arrow)"
              />
            )}
            <rect
              className="ghost__body"
              x={Math.min(tl.x, br.x)}
              y={Math.min(tl.y, br.y)}
              width={Math.abs(br.x - tl.x)}
              height={Math.abs(br.y - tl.y)}
              rx={2}
            />
          </g>
        );
      })}

      <defs>
        <marker
          id="ghost-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path className="ghost__arrowhead" d="M0 0 L10 5 L0 10 z" />
        </marker>
      </defs>
    </g>
  );
}
