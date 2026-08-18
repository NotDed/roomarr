import { useEffect, useMemo, useRef, useState } from 'react';
import { hardViolations } from '@/core/constraints';
import { describeDiff, diffLayouts } from '@/core/diff';
import type { Layout } from '@/core/items';
import { formatAreaM2, formatLengthWithUnit, mm2ToM2 } from '@/core/units';
import { roomBounds } from '@/core/room';
import { runWallIds } from '@/core/wallrun';
import { RoomPlan } from '@/render/RoomPlan';
import { computeMetric, computeViolations, useStore } from '@/state/store';

/**
 * Arrangements side by side.
 *
 * Flicking between two views and trying to spot what changed is a memory test,
 * and memory is bad at exactly the thing being asked of it — whether the gap
 * beside the bed got wider. Seeing both at once turns it into looking.
 *
 * Two levels, because two questions get asked in this order. The gallery
 * answers "which of these is worth a closer look", so every arrangement is
 * there at once, small, each with its own numbers. Two-up answers "what is
 * actually different between these two", so the plans are big, drawn at the
 * same scale, and accompanied by the move list that gets you from the left one
 * to the right one.
 *
 * Both plans are non-interactive on purpose. This is a reading screen; dragging
 * furniture belongs on the one you were just on, where there is an inspector to
 * tell you what it broke.
 */
export function CompareStage() {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const items = useStore((s) => s.items);
  const features = useStore((s) => s.features);
  const unit = useStore((s) => s.unit);
  const bodyRadius = useStore((s) => s.bodyRadius);
  const roomType = useStore((s) => s.roomType);
  const showHeat = useStore((s) => s.showHeat);

  const layouts = useStore((s) => s.layouts);
  const baselineId = useStore((s) => s.baselineLayoutId);
  const activeId = useStore((s) => s.activeLayoutId);
  const switchLayout = useStore((s) => s.switchLayout);

  /* Defaults that answer the question people actually arrive with: how does
     what I am working on compare with the room I have? */
  const [left, setLeft] = useState(baselineId);
  const [right, setRight] = useState(activeId === baselineId ? null : activeId);

  const [box, setBox] = useState({ width: 0, height: 0 });
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setBox({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const measured = useMemo(
    () =>
      layouts.map((layout) => ({
        layout,
        walkableMm2:
          computeMetric(room, run, items, layout, features, bodyRadius)?.walkableMm2 ?? null,
        problems: hardViolations(
          computeViolations(room, run, items, layout, features, roomType, unit),
        ).length,
      })),
    [layouts, room, run, items, features, bodyRadius, roomType, unit],
  );

  const wallIds = useMemo(() => (run === null ? [] : runWallIds(run)), [run]);
  const byId = useMemo(() => new Map(measured.map((m) => [m.layout.id, m])), [measured]);
  const zero = byId.get(baselineId)?.walkableMm2 ?? null;

  if (room === null) return null;

  const a = byId.get(left);
  const b = right === null ? undefined : byId.get(right);
  const twoUp = a !== undefined && b !== undefined ? { a, b } : null;

  /* Both plans in a two-up get the same width and therefore the same scale.
     Different scales side by side would make the smaller room look tidier,
     which is a lie the eye believes instantly and cannot un-believe. */
  const bounds = roomBounds(room);
  const cell =
    twoUp === null
      ? { width: THUMB_W, height: Math.round(THUMB_W * (bounds.d / bounds.w)) + 2 * THUMB_PAD }
      : {
          width: Math.max(240, Math.floor(box.width / 2) - 24),
          height: Math.max(240, box.height - 190),
        };

  return (
    <div className="compare" ref={hostRef}>
      {twoUp === null ? (
        <div className="gallery">
          {measured.map(({ layout, walkableMm2, problems }) => (
            <button
              key={layout.id}
              type="button"
              className={layout.id === activeId ? 'card card--active' : 'card'}
              onClick={() => {
                /* Clicking a card asks "show me this against the baseline",
                   which is the comparison worth defaulting to. Clicking the
                   baseline itself would ask it to compare with itself, so it
                   becomes the left-hand side instead. */
                if (layout.id === baselineId) setLeft(layout.id);
                else setRight(layout.id);
              }}
            >
              <Thumb
                layout={layout}
                width={cell.width}
                height={cell.height}
                wallIds={wallIds}
                showHeat={showHeat}
                mode="thumb"
              />
              <span className="card__name">
                {layout.name}
                {/* Which one a change would land in. Without it the gallery is
                    three plans and no answer to "which am I editing", and the
                    answer matters the moment you go back to the plan. */}
                {layout.id === activeId && <em className="card__tag">editing</em>}
              </span>
              <Stats
                walkableMm2={walkableMm2}
                zero={zero}
                problems={problems}
                isZero={layout.id === baselineId}
              />
            </button>
          ))}
        </div>
      ) : (
        <TwoUp
          a={twoUp.a}
          b={twoUp.b}
          zero={zero}
          cell={cell}
          wallIds={wallIds}
          showHeat={showHeat}
          onClose={() => setRight(null)}
          onOpen={() => switchLayout(twoUp.b.layout.id)}
        />
      )}
    </div>
  );
}

/**
 * Thumbnail size, fixed rather than stretched to the card.
 *
 * Every plan in the gallery has to be at the same scale or the comparison is
 * worthless — a room drawn larger looks emptier. Fixing the width guarantees
 * that; the height follows the room's own proportions so the drawing fills the
 * space instead of floating in a letterbox.
 */
const THUMB_W = 260;
const THUMB_PAD = 8;

function Thumb({
  layout,
  width,
  height,
  wallIds,
  showHeat,
  mode,
}: {
  layout: Layout;
  width: number;
  height: number;
  wallIds: readonly string[];
  showHeat: boolean;
  mode?: 'thumb';
}) {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const items = useStore((s) => s.items);
  const features = useStore((s) => s.features);
  const bodyRadius = useStore((s) => s.bodyRadius);

  const heat = useMemo(
    () => computeMetric(room, run, items, layout, features, bodyRadius),
    [room, run, items, layout, features, bodyRadius],
  );

  if (room === null || width <= 0) return null;

  return (
    <RoomPlan
      room={room}
      width={width}
      height={height}
      unit="cm"
      features={features}
      wallIds={wallIds}
      items={items}
      placements={layout.placements}
      heat={showHeat ? heat : null}
      {...(mode === undefined ? {} : { mode })}
    />
  );
}

function Stats({
  walkableMm2,
  zero,
  problems,
  isZero,
}: {
  walkableMm2: number | null;
  zero: number | null;
  problems: number;
  isZero: boolean;
}) {
  const delta =
    zero === null || walkableMm2 === null || isZero ? null : mm2ToM2(walkableMm2 - zero);

  return (
    <span className="card__stats">
      <span className="num card__area">
        {walkableMm2 === null ? '—' : formatAreaM2(walkableMm2)} m²
      </span>
      {delta !== null && (
        <span
          className={
            delta >= 0.05
              ? 'card__delta card__delta--up'
              : delta <= -0.05
                ? 'card__delta card__delta--down'
                : 'card__delta'
          }
        >
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}
        </span>
      )}
      {problems > 0 ? (
        <span className="card__problems">
          {problems} problem{problems === 1 ? '' : 's'}
        </span>
      ) : (
        <span className="card__ok">works</span>
      )}
    </span>
  );
}

interface Measured {
  layout: Layout;
  walkableMm2: number | null;
  problems: number;
}

function TwoUp({
  a,
  b,
  zero,
  cell,
  wallIds,
  showHeat,
  onClose,
  onOpen,
}: {
  a: Measured;
  b: Measured;
  zero: number | null;
  cell: { width: number; height: number };
  wallIds: readonly string[];
  showHeat: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const items = useStore((s) => s.items);
  const unit = useStore((s) => s.unit);
  const baselineId = useStore((s) => s.baselineLayoutId);

  const diff = useMemo(() => diffLayouts(items, a.layout, b.layout), [items, a.layout, b.layout]);

  const gained =
    a.walkableMm2 === null || b.walkableMm2 === null
      ? null
      : mm2ToM2(b.walkableMm2 - a.walkableMm2);

  return (
    <div className="twoup">
      <div className="twoup__head">
        <button className="btn btn--quiet btn--sm" type="button" onClick={onClose}>
          ← All arrangements
        </button>
        <button className="btn btn--sm" type="button" onClick={onOpen}>
          Edit {b.layout.name}
        </button>
      </div>

      <div className="twoup__plans">
        {[a, b].map((side, i) => (
          <figure className="twoup__side" key={side.layout.id}>
            <Thumb
              layout={side.layout}
              width={cell.width}
              height={cell.height}
              wallIds={wallIds}
              showHeat={showHeat}
            />
            <figcaption className="twoup__caption">
              <span className="twoup__name">{side.layout.name}</span>
              <Stats
                walkableMm2={side.walkableMm2}
                zero={zero}
                problems={side.problems}
                isZero={side.layout.id === baselineId}
              />
            </figcaption>
            {i === 0 && (
              <span className="twoup__arrow" aria-hidden="true">
                →
              </span>
            )}
          </figure>
        ))}
      </div>

      {/* The verdict in one line, before the detail. Somebody deciding between
          two arrangements wants the answer first and the reasoning after. */}
      <p className="twoup__verdict">
        <strong>{describeDiff(diff)}</strong>
        {gained !== null && gained !== 0 && (
          <>
            {' for '}
            <span className={gained > 0 ? 'card__delta--up' : 'card__delta--down'}>
              {gained > 0 ? '+' : ''}
              {gained.toFixed(1)} m²
            </span>
            {' of walkable floor'}
          </>
        )}
        {'.'}
      </p>

      {diff.moves.length > 0 && (
        <ol className="moves">
          {diff.moves.map((move) => (
            <li className="move" key={move.itemId}>
              <span className="move__name">{move.name}</span>
              <span className="move__what">
                {move.distance > 0 && (
                  <>
                    {/* With the unit — on the plan the scale bar supplies it,
                        but in a sentence "moves 310" could be anything.

                        Rounded to the nearest centimetre, because this figure
                        is how much work the move is, not an instruction to
                        carry out: "move it 193.3 cm" invites someone to measure
                        the journey instead of the destination, and the
                        destination is what the blueprint gives as two gaps from
                        a named corner. */}
                    moves{' '}
                    <span className="num">
                      {formatLengthWithUnit(Math.round(move.distance / 10) * 10, unit)}
                    </span>
                  </>
                )}
                {move.distance > 0 && move.turns !== 0 && ' and '}
                {move.turns !== 0 && describeTurn(move.turns)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Plain English, and never "270°". */
function describeTurn(turns: -1 | 1 | 2): string {
  if (turns === 2) return 'turns to face the other way';
  return turns === 1 ? 'turns a quarter clockwise' : 'turns a quarter anticlockwise';
}
