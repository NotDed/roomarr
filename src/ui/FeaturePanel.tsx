import { useMemo } from 'react';
import {
  type DoorSwing,
  type Feature,
  type FeatureKind,
  FEATURE_DEFAULTS,
  featureGaps,
  isEgressWindow,
} from '@/core/features';
import { type DisplayUnit, formatLength, parseLength } from '@/core/units';
import type { Wall } from '@/core/room';
import { nameWalls } from '@/core/wallnames';
import type { WallId } from '@/core/wallrun';
import { isSleepingRoom, resolveWalls, selectDoorWallIndex, useStore } from '@/state/store';

/**
 * Doors, windows and fixtures.
 *
 * The position field asks for the distance from a **named corner** and shows
 * the distance from the other one beside it. That pair is the same
 * self-checking measurement the blueprint will print, and it is the reason
 * this form asks for a gap rather than an abstract offset: someone reading
 * 1200 from one corner and 900 from the other on a 3400 wall with an 800 door
 * has made an arithmetic error the form can catch on the spot.
 */

const KINDS: FeatureKind[] = [
  'door',
  'window',
  'radiator',
  'tv-mount',
  'outlet',
  'switch',
  'column',
  'vent',
];

export function FeaturePanel() {
  const run = useStore((s) => s.run);
  const room = useStore((s) => s.room);
  const unit = useStore((s) => s.unit);
  const features = useStore((s) => s.features);
  const selectedId = useStore((s) => s.selectedFeatureId);
  const roomType = useStore((s) => s.roomType);
  const sleeping = useStore(isSleepingRoom);
  const doorWallIndex = useStore(selectDoorWallIndex);

  const addFeature = useStore((s) => s.addFeature);
  const removeFeature = useStore((s) => s.removeFeature);
  const selectFeature = useStore((s) => s.selectFeature);
  const setRoomType = useStore((s) => s.setRoomType);

  const { walls, byId, wallIds } = useMemo(() => resolveWalls(room, run), [room, run]);
  const naming = useMemo(() => nameWalls(walls, { doorWallIndex }), [walls, doorWallIndex]);

  if (room === null || walls.length === 0) {
    return (
      <>
        <h2 className="panel__title">Doors &amp; windows</h2>
        <p className="panel__empty">Close the walls first, then place the door.</p>
      </>
    );
  }

  const hasPrimaryDoor = doorWallIndex !== undefined;
  const selected = features.find((f) => f.id === selectedId) ?? null;

  return (
    <>
      <div className="roomform__head">
        <h2 className="panel__title">Doors &amp; windows</h2>
        <select
          aria-label="Room type"
          className="roomtype"
          value={roomType}
          onChange={(e) => setRoomType(e.target.value as typeof roomType)}
        >
          <option value="bedroom">Bedroom</option>
          <option value="living">Living room</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Walkable area is defined as the floor you can reach from the doorway,
          so without a door there is no honest number to show. Saying so beats
          showing a figure whose meaning changes the moment a door appears. */}
      {!hasPrimaryDoor && (
        <p className="callout callout--nudge">
          Add a door to measure walkable floor — and to name the walls Door / Left / Far / Right
          instead of A–D.
        </p>
      )}

      <div className="addrow">
        {KINDS.map((kind) => (
          <button
            key={kind}
            className="chip"
            type="button"
            onClick={() => addFeature(kind, wallIds[0] ?? '')}
          >
            + {FEATURE_DEFAULTS[kind].label}
          </button>
        ))}
      </div>

      {features.length === 0 ? (
        <p className="panel__empty">Nothing placed yet.</p>
      ) : (
        <ul className="featlist">
          {features.map((feature) => {
            const wall = byId.get(feature.wallId);
            const wallName =
              naming.walls.find((w) => w.index === wall?.index)?.label ?? 'a removed wall';
            const egress = isEgressWindow(feature, sleeping);

            return (
              <li
                key={feature.id}
                className={
                  feature.id === selectedId ? 'featlist__row featlist__row--on' : 'featlist__row'
                }
              >
                <button
                  className="featlist__pick"
                  type="button"
                  onClick={() => selectFeature(feature.id === selectedId ? null : feature.id)}
                >
                  <span className="featlist__name">
                    {FEATURE_DEFAULTS[feature.kind].label}
                    {feature.door?.isPrimary === true && <em> · way in</em>}
                    {egress && <em> · escape window</em>}
                  </span>
                  <span className="featlist__where">
                    {wall === undefined ? (
                      <strong className="featlist__orphan">on a wall you removed</strong>
                    ) : (
                      wallName
                    )}
                  </span>
                </button>
                <button
                  className="iconbtn"
                  type="button"
                  aria-label={`Remove ${FEATURE_DEFAULTS[feature.kind].label}`}
                  onClick={() => removeFeature(feature.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected !== null && (
        <FeatureEditor
          feature={selected}
          unit={unit}
          wallIds={wallIds}
          wallNames={naming.walls}
          byId={byId}
        />
      )}
    </>
  );
}

function FeatureEditor({
  feature,
  unit,
  wallIds,
  wallNames,
  byId,
}: {
  feature: Feature;
  unit: DisplayUnit;
  wallIds: readonly WallId[];
  wallNames: readonly { index: number; label: string }[];
  byId: ReadonlyMap<WallId, Wall>;
}) {
  const updateFeature = useStore((s) => s.updateFeature);
  const makePrimaryDoor = useStore((s) => s.makePrimaryDoor);

  const wall = byId.get(feature.wallId);
  const gaps = wall === undefined ? null : featureGaps(wall, feature);

  const set = (patch: Partial<Feature>) => updateFeature(feature.id, patch);

  return (
    <div className="feateditor">
      <div className="field">
        <label htmlFor="feat-wall">On wall</label>
        <select
          id="feat-wall"
          className="field__input"
          value={feature.wallId}
          onChange={(e) => set({ wallId: e.target.value })}
        >
          {wallIds.map((id) => {
            const w = byId.get(id);
            const label = wallNames.find((n) => n.index === w?.index)?.label ?? id;
            return (
              <option key={id} value={id}>
                {label} ({formatLength(w?.length ?? 0, unit)} {unit})
              </option>
            );
          })}
        </select>
      </div>

      <MmField
        id="feat-offset"
        label="From corner"
        value={feature.offset}
        unit={unit}
        onCommit={(offset) => set({ offset })}
      />
      <MmField
        id="feat-width"
        label="Width"
        value={feature.width}
        unit={unit}
        onCommit={(width) => set({ width })}
      />

      {/* The cross-check. Two gaps that must add up with the width — the same
          pair the printed plan uses, so an error shows up here rather than
          while someone is holding a tape against a wall. */}
      {gaps !== null && (
        <p className={gaps.fits ? 'crosscheck' : 'crosscheck crosscheck--bad'}>
          {gaps.fits ? (
            <>
              <span className="num">{formatLength(gaps.fromStart, unit)}</span> from one corner,{' '}
              <span className="num">{formatLength(gaps.fromEnd, unit)}</span> from the other.
            </>
          ) : (
            <>
              That runs off the end of the wall by {formatLength(-gaps.fromEnd, unit)} {unit}.
            </>
          )}
        </p>
      )}

      {feature.kind === 'window' && (
        <>
          <MmField
            id="feat-sill"
            label="Sill height"
            value={feature.sillHeight ?? 900}
            unit={unit}
            onCommit={(sillHeight) => set({ sillHeight })}
          />
          <p className="hint">
            Anything shorter than the sill can sit under this window — a desk or a low dresser there
            is a good use of the wall, not a problem.
          </p>
        </>
      )}

      {feature.door !== undefined && (
        <>
          <div className="field">
            <label htmlFor="feat-swing">Opens</label>
            <select
              id="feat-swing"
              className="field__input"
              value={feature.door.swing}
              onChange={(e) =>
                set({ door: { ...feature.door!, swing: e.target.value as DoorSwing } })
              }
            >
              <option value="in">Inward</option>
              <option value="out">Outward</option>
              <option value="slide">Slides</option>
              <option value="bifold">Bifold</option>
              <option value="pocket">Into the wall</option>
              <option value="none">No door</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="feat-hinge">Hinge</label>
            <select
              id="feat-hinge"
              className="field__input"
              value={feature.door.hinge}
              onChange={(e) =>
                set({ door: { ...feature.door!, hinge: e.target.value as 'start' | 'end' } })
              }
            >
              <option value="start">Near corner</option>
              <option value="end">Far corner</option>
            </select>
          </div>

          {!feature.door.isPrimary && (
            <button className="btn" type="button" onClick={() => makePrimaryDoor(feature.id)}>
              Make this the way in
            </button>
          )}
        </>
      )}

      {feature.kind === 'tv-mount' && (
        <>
          <MmField
            id="feat-diag"
            label="Screen"
            value={feature.tv?.diagonalMm ?? 1400}
            unit={unit}
            onCommit={(diagonalMm) =>
              set({ tv: { remountable: feature.tv?.remountable ?? false, diagonalMm } })
            }
          />
          <MmField
            id="feat-mount"
            label="Centre height"
            value={feature.mountHeight ?? 1100}
            unit={unit}
            onCommit={(mountHeight) => set({ mountHeight })}
          />
          <label className="checkline">
            <input
              type="checkbox"
              checked={feature.tv?.remountable ?? false}
              onChange={(e) =>
                set({
                  tv: { diagonalMm: feature.tv?.diagonalMm ?? 1400, remountable: e.target.checked },
                })
              }
            />
            I'd re-mount it if it helps
          </label>
        </>
      )}

      {feature.projection !== undefined && (
        <MmField
          id="feat-proj"
          label="Sticks out"
          value={feature.projection}
          unit={unit}
          onCommit={(projection) => set({ projection })}
        />
      )}
    </div>
  );
}

/** A length input that commits only a parseable value. */
function MmField({
  id,
  label,
  value,
  unit,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  unit: DisplayUnit;
  onCommit: (mm: number) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="num field__input"
        inputMode="decimal"
        defaultValue={formatLength(value, unit)}
        key={`${id}-${value}-${unit}`}
        onBlur={(e) => {
          const parsed = parseLength(e.target.value, unit);
          if (parsed !== null) onCommit(parsed);
          else e.target.value = formatLength(value, unit);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="field__unit">{unit}</span>
    </div>
  );
}
