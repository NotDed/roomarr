import { useMemo, useRef } from 'react';
import { type Feature, wallsById } from '@/core/features';
import type { Item, Placement } from '@/core/items';
import type { Pose } from '@/core/geometry';
import type { WalkableResult } from '@/core/walkable';
import { type Rect, inflateRect } from '@/core/geometry';
import { type Room, roomBounds, roomWalls } from '@/core/room';
import { type DisplayUnit, formatLength } from '@/core/units';
import { type WallNaming, nameWalls } from '@/core/wallnames';
import type { SnapToggles } from '@/core/snapping';
import type { WallId } from '@/core/wallrun';
import { Features } from '@/render/Features';
import { Items } from '@/render/Items';
import { Ghosts } from '@/render/Ghosts';
import { HeatOverlay } from '@/render/HeatOverlay';
import { type GuideHandle, SnapGuides } from '@/render/SnapGuides';
import { useItemDrag } from '@/render/useItemDrag';
import {
  type Projector,
  fitProjector,
  geometryTransform,
  sw,
  toPaper,
  toPaperLength,
} from '@/render/projector';

/**
 * The floor plan.
 *
 * This component is the one that later renders the printed sheets too, with
 * `mode="print"` swapping the palette and the stroke weights. Sharing it is the
 * point: a blueprint whose geometry can disagree with the plan the user
 * approved on screen is worse than no blueprint at all.
 */

export type PlanMode = 'screen' | 'print';

export interface RoomPlanProps {
  room: Room;
  width: number;
  height: number;
  unit: DisplayUnit;
  /** Which wall carries the primary door, once one exists. */
  doorWallIndex?: number | undefined;
  wallLabels?: Readonly<Record<number, string>> | undefined;
  features?: readonly Feature[] | undefined;
  /** Wall ids in outline order, so features can find their wall. */
  wallIds?: readonly WallId[] | undefined;
  selectedFeatureId?: string | null | undefined;
  onSelectFeature?: ((id: string) => void) | undefined;

  items?: readonly Item[] | undefined;
  placements?: readonly Placement[] | undefined;
  selectedItemId?: string | null | undefined;
  onSelectItem?: ((id: string) => void) | undefined;
  /** Commits a drag. Omit it (as print mode does) and items are not draggable. */
  onItemMove?: ((id: string, pose: Pose) => void) | undefined;
  /** Fires on every drag frame with the candidate pose, for a live metric. */
  onItemPreview?: ((id: string, pose: Pose) => void) | undefined;
  snap?: number;
  /** Which magnetic snaps are live while dragging. Omit for none. */
  snapTo?: SnapToggles | undefined;
  /** Walkable-area result to paint underneath the plan. */
  heat?: WalkableResult | null | undefined;
  /** A proposed arrangement, drawn as ghosts over the current one. */
  ghostOf?: readonly Placement[] | null | undefined;
  onBackgroundClick?: (() => void) | undefined;

  mode?: PlanMode;
}

/** Paper units of clear space around the room for dimensions and labels. */
const MARGIN = 56;

export function RoomPlan({
  room,
  width,
  height,
  unit,
  doorWallIndex,
  wallLabels,
  features,
  wallIds,
  selectedFeatureId,
  onSelectFeature,
  items,
  placements,
  selectedItemId,
  onSelectItem,
  onItemMove,
  onItemPreview,
  snap = 10,
  snapTo,
  heat,
  ghostOf,
  onBackgroundClick,
  mode = 'screen',
}: RoomPlanProps) {
  const walls = useMemo(() => roomWalls(room), [room]);
  const byId = useMemo(() => wallsById(walls, wallIds ?? []), [walls, wallIds]);
  const naming = useMemo(
    () => nameWalls(walls, { doorWallIndex, labels: wallLabels }),
    [walls, doorWallIndex, wallLabels],
  );

  const bounds = useMemo(() => roomBounds(room), [room]);
  const projector = useMemo(
    () => fitProjector(bounds, { width, height }, MARGIN),
    [bounds, width, height],
  );

  const path = useMemo(
    () => `${room.outline.map((v, i) => `${i === 0 ? 'M' : 'L'}${v.x} ${v.y}`).join(' ')} Z`,
    [room.outline],
  );

  /* The drag lives here because this is where the projector is. Lifting the
     projector into the caller instead would mean two components computing the
     same fit and eventually disagreeing about it. */
  /* The guides are driven through this rather than through props, so a drag
     never re-renders the plan. See `SnapGuides`. */
  const guides = useRef<GuideHandle | null>(null);

  const drag = useItemDrag({
    projector,
    items: items ?? [],
    placements: placements ?? [],
    bounds,
    snap,
    room,
    toggles: snapTo,
    guides,
    onPreview: onItemPreview,
    onCommit: onItemMove ?? (() => {}),
  });

  return (
    <div className="planhost" style={{ width, height }}>
      {heat !== null && heat !== undefined && (
        <HeatOverlay result={heat} projector={projector} width={width} height={height} />
      )}
      <svg
        className={`plan plan--${mode}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Floor plan of the room"
        onPointerMove={onItemMove === undefined ? undefined : drag.onPointerMove}
        onPointerUp={onItemMove === undefined ? undefined : drag.onPointerUp}
        onPointerCancel={onItemMove === undefined ? undefined : drag.onPointerCancel}
        onPointerDown={(event) => {
          /* Clicking bare floor clears the selection. Items stop the event from
           reaching here, so this only fires on the background. */
          if (event.target === event.currentTarget) onBackgroundClick?.();
        }}
      >
        <g transform={geometryTransform(projector)}>
          {/* The floor. Filled so the room reads as a solid object rather than an
            outline drifting on the grid. */}
          <path className="plan__floor" d={path} />
          {/* Walls drawn inside the outline: the outline is the INSIDE face, which
            is what a tape measure reports, so the thickness has to go outward
            visually while the dimensions stay true to the inside. */}
          <path
            className="plan__wall"
            d={path}
            strokeWidth={sw(projector, mode === 'print' ? 0.8 : 2.5)}
          />
        </g>

        {items !== undefined && placements !== undefined && placements.length > 0 && (
          <Items
            items={items}
            placements={placements}
            projector={projector}
            unit={unit}
            selectedId={selectedItemId ?? null}
            onSelect={onSelectItem}
            onPointerDown={onItemMove === undefined ? undefined : drag.onPointerDown}
          />
        )}

        {ghostOf !== null &&
          ghostOf !== undefined &&
          items !== undefined &&
          placements !== undefined && (
            <Ghosts items={items} from={placements} to={ghostOf} projector={projector} />
          )}

        {features !== undefined && features.length > 0 && (
          <Features
            features={features}
            wallsById={byId}
            projector={projector}
            selectedId={selectedFeatureId ?? null}
            onSelect={onSelectFeature}
          />
        )}

        {/* Over the furniture, because a guide hidden behind the item it is
            explaining explains nothing. */}
        {onItemMove !== undefined && <SnapGuides projector={projector} handle={guides} />}

        <WallDimensions room={room} projector={projector} naming={naming} unit={unit} />
        <CornerTicks room={room} projector={projector} naming={naming} />
        <ScaleBar projector={projector} unit={unit} height={height} />
      </svg>
    </div>
  );
}

/**
 * A dimension line per wall, outside the room, with the length on it.
 *
 * Drawn in paper space so the text stays legible at any zoom. Each line is
 * pushed outward along the wall's *outward* normal, which is just the inward
 * normal negated — so this works on an alcove's reentrant corners without any
 * special case.
 */
function WallDimensions({
  room,
  projector,
  naming,
  unit,
}: {
  room: Room;
  projector: Projector;
  naming: WallNaming;
  unit: DisplayUnit;
}) {
  const walls = roomWalls(room);
  const OFFSET = 16; // paper units clear of the wall
  const TEXT_LIFT = 6;

  return (
    <g className="plan__dims">
      {walls.map((wall) => {
        const out = { x: -wall.inward.x, y: -wall.inward.y };
        const a = toPaper(projector, wall.start);
        const b = toPaper(projector, wall.end);

        const ax = a.x + out.x * OFFSET;
        const ay = a.y + out.y * OFFSET;
        const bx = b.x + out.x * OFFSET;
        const by = b.y + out.y * OFFSET;

        const mx = (ax + bx) / 2 + out.x * TEXT_LIFT;
        const my = (ay + by) / 2 + out.y * TEXT_LIFT;

        /* Keep text upright: a vertical wall's label reads bottom-to-top on the
           left and top-to-bottom on the right, never upside down. */
        const rotation = wall.axis === 'vertical' ? (out.x > 0 ? 90 : -90) : 0;
        const tooShort = toPaperLength(projector, wall.length) < 34;

        return (
          <g key={wall.index}>
            <line className="plan__dimline" x1={ax} y1={ay} x2={bx} y2={by} />
            <line
              className="plan__dimtick"
              x1={a.x + out.x * 4}
              y1={a.y + out.y * 4}
              x2={ax}
              y2={ay}
            />
            <line
              className="plan__dimtick"
              x1={b.x + out.x * 4}
              y1={b.y + out.y * 4}
              x2={bx}
              y2={by}
            />
            {!tooShort && (
              <text
                className="plan__dimtext"
                x={mx}
                y={my}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={rotation === 0 ? undefined : `rotate(${rotation} ${mx} ${my})`}
              >
                {formatLength(wall.length, unit)}
              </text>
            )}
          </g>
        );
      })}

      {walls.map((wall) => {
        const out = { x: -wall.inward.x, y: -wall.inward.y };
        const a = toPaper(projector, wall.start);
        const b = toPaper(projector, wall.end);
        const mx = (a.x + b.x) / 2 - out.x * 14;
        const my = (a.y + b.y) / 2 - out.y * 14;
        const label = naming.walls.find((w) => w.index === wall.index)?.label ?? '';
        const tooShort = toPaperLength(projector, wall.length) < 70;

        if (tooShort) return null;
        const rotation = wall.axis === 'vertical' ? (out.x > 0 ? 90 : -90) : 0;

        return (
          <text
            key={`label-${wall.index}`}
            className="plan__walllabel"
            x={mx}
            y={my}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={rotation === 0 ? undefined : `rotate(${rotation} ${mx} ${my})`}
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

/** Corner tags (C1, C2, …) — the anchors every printed measurement refers to. */
function CornerTicks({
  room,
  projector,
  naming,
}: {
  room: Room;
  projector: Projector;
  naming: WallNaming;
}) {
  const walls = roomWalls(room);

  return (
    <g className="plan__corners">
      {walls.map((wall) => {
        const previous = walls[(wall.index - 1 + walls.length) % walls.length];
        if (previous === undefined) return null;

        /* Nudge the tag into the room, away from both walls meeting here. */
        const inward = {
          x: (wall.inward.x + previous.inward.x) / 2,
          y: (wall.inward.y + previous.inward.y) / 2,
        };
        const p = toPaper(projector, wall.start);
        const tag = naming.corners.find((c) => c.index === wall.index)?.tag ?? '';

        return (
          <text
            key={wall.index}
            className="plan__cornertag"
            x={p.x + inward.x * 15}
            y={p.y + inward.y * 15}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {tag}
          </text>
        );
      })}
    </g>
  );
}

/**
 * A scale bar showing a round real-world distance.
 *
 * Chosen so the bar lands in a comfortable range of paper units at whatever
 * zoom the plan is at, rather than being a fixed 1 m that becomes invisible in
 * a large room and overflows a small one.
 */
function ScaleBar({
  projector,
  unit,
  height,
}: {
  projector: Projector;
  unit: DisplayUnit;
  height: number;
}) {
  const candidates = [100, 250, 500, 1000, 2000, 5000];
  const span =
    candidates.find((mm) => toPaperLength(projector, mm) >= 60) ?? candidates.at(-1) ?? 1000;
  const length = toPaperLength(projector, span);

  const x = 14;
  const y = height - 20;

  return (
    <g className="plan__scalebar">
      <line x1={x} y1={y} x2={x + length} y2={y} />
      <line x1={x} y1={y - 4} x2={x} y2={y + 4} />
      <line x1={x + length} y1={y - 4} x2={x + length} y2={y + 4} />
      <text className="plan__scaletext" x={x} y={y - 8}>
        {formatLength(span, unit)} {unit}
      </text>
    </g>
  );
}

/** Exported for tests and for the print sheets, which fit into a paper box. */
export function planContentBounds(room: Room): Rect {
  return inflateRect(roomBounds(room), 0);
}
