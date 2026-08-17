import { memo } from 'react';
import type { Item, Placement } from '@/core/items';
import { itemRect, itemZones, sideDirection } from '@/core/items';
import { type DisplayUnit, formatLength } from '@/core/units';
import { type Projector, toPaper } from '@/render/projector';

/**
 * Furniture on the plan.
 *
 * Each item is memoised on the few values that actually change its drawing, so
 * dragging one thing does not re-render the other fourteen. That matters more
 * than it looks: the whole point of the next milestone is a walkable figure
 * that moves under your finger, and it cannot if every pointermove reconciles
 * three hundred SVG nodes.
 */
export function Items({
  items,
  placements,
  projector,
  unit,
  selectedId,
  showZones,
  onSelect,
  onPointerDown,
}: {
  items: readonly Item[];
  placements: readonly Placement[];
  projector: Projector;
  unit: DisplayUnit;
  selectedId?: string | null;
  showZones?: boolean;
  onSelect?: ((id: string) => void) | undefined;
  onPointerDown?: ((id: string, event: React.PointerEvent) => void) | undefined;
}) {
  return (
    <g className="items">
      {placements.map((placement) => {
        const item = items.find((i) => i.id === placement.itemId);
        if (item === undefined) return null;
        return (
          <ItemShape
            key={placement.itemId}
            item={item}
            placement={placement}
            projector={projector}
            unit={unit}
            selected={selectedId === placement.itemId}
            showZones={showZones === true || selectedId === placement.itemId}
            onSelect={onSelect}
            onPointerDown={onPointerDown}
          />
        );
      })}
    </g>
  );
}

const ItemShape = memo(function ItemShape({
  item,
  placement,
  projector,
  unit,
  selected,
  showZones,
  onSelect,
  onPointerDown,
}: {
  item: Item;
  placement: Placement;
  projector: Projector;
  unit: DisplayUnit;
  selected: boolean;
  showZones: boolean;
  onSelect?: ((id: string) => void) | undefined;
  onPointerDown?: ((id: string, event: React.PointerEvent) => void) | undefined;
}) {
  const rect = itemRect(item, placement);
  const tl = toPaper(projector, { x: rect.x, y: rect.y });
  const br = toPaper(projector, { x: rect.x + rect.w, y: rect.y + rect.d });
  const w = br.x - tl.x;
  const h = br.y - tl.y;

  const cx = tl.x + w / 2;
  const cy = tl.y + h / 2;
  const roomy = w > 54 && h > 26;

  /* The usable face, so "which way does this thing point" is answerable from
     the drawing rather than from the inspector. */
  const front = sideDirection('front', placement.pose.rot);

  return (
    <g
      className={[
        'item',
        selected ? 'item--on' : '',
        placement.locked ? 'item--locked' : '',
        item.overlappable ? 'item--soft' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`${item.name}, ${formatLength(item.footprint.w, unit)} by ${formatLength(item.footprint.d, unit)}`}
      onPointerDown={(event) => {
        onSelect?.(item.id);
        onPointerDown?.(item.id, event);
      }}
      data-item-id={item.id}
    >
      {showZones &&
        itemZones(item, placement).map(({ rule, rect: zone }) => {
          const a = toPaper(projector, { x: zone.x, y: zone.y });
          const b = toPaper(projector, { x: zone.x + zone.w, y: zone.y + zone.d });
          return (
            <rect
              key={rule.id}
              className={`zone zone--${rule.kind}`}
              x={Math.min(a.x, b.x)}
              y={Math.min(a.y, b.y)}
              width={Math.abs(b.x - a.x)}
              height={Math.abs(b.y - a.y)}
            />
          );
        })}

      <rect className="item__body" x={tl.x} y={tl.y} width={w} height={h} rx={2} />

      {/* A tick on the usable face. */}
      <line
        className="item__front"
        x1={cx + (front.x * w) / 2}
        y1={cy + (front.y * h) / 2}
        x2={cx + (front.x * w) / 2 - front.x * 6}
        y2={cy + (front.y * h) / 2 - front.y * 6}
      />

      {roomy && (
        <>
          <text className="item__name" x={cx} y={cy - 5} textAnchor="middle">
            {fit(item.name, w)}
          </text>
          <text className="item__dims num" x={cx} y={cy + 8} textAnchor="middle">
            {formatLength(item.footprint.w, unit)} × {formatLength(item.footprint.d, unit)}
          </text>
        </>
      )}

      {placement.locked && (
        <text className="item__lock" x={tl.x + 5} y={tl.y + 11}>
          ⚿
        </text>
      )}
    </g>
  );
});

/**
 * Trim a label to what its box can actually hold.
 *
 * SVG text neither wraps nor clips, so a long name runs straight out over the
 * neighbouring furniture. Estimating from the average glyph width is crude, but
 * this is a drawing that gets printed and measured off — a name spilling across
 * two items is worse than a truncated one.
 */
function fit(text: string, boxWidth: number): string {
  const perChar = 5.6; // 10.5px UI font, measured empirically
  const max = Math.floor((boxWidth - 8) / perChar);
  if (max <= 1) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}
