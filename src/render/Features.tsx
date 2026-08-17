import { type Feature, TYPICAL_SILL, featureSpan } from '@/core/features';
import { doorSwingZone, slideTrackZone } from '@/core/openings';
import type { Wall } from '@/core/room';
import type { WallId } from '@/core/wallrun';
import { type Projector, sw, toPaper } from '@/render/projector';

/**
 * Doors, windows and fixtures, drawn on the plan.
 *
 * Openings are drawn as a **break in the wall** rather than a symbol laid over
 * it, because that is how a floor plan reads and because it makes a mistyped
 * offset obvious — a door that overlaps a corner looks wrong immediately.
 */
export function Features({
  features,
  wallsById,
  projector,
  selectedId,
  onSelect,
}: {
  features: readonly Feature[];
  wallsById: ReadonlyMap<WallId, Wall>;
  projector: Projector;
  selectedId?: string | null;
  onSelect?: ((id: string) => void) | undefined;
}) {
  return (
    <g className="feat">
      {features.map((feature) => {
        const wall = wallsById.get(feature.wallId);
        if (wall === undefined) return null;
        return (
          <FeatureMark
            key={feature.id}
            feature={feature}
            wall={wall}
            projector={projector}
            selected={selectedId === feature.id}
            onSelect={onSelect}
          />
        );
      })}
    </g>
  );
}

function FeatureMark({
  feature,
  wall,
  projector,
  selected,
  onSelect,
}: {
  feature: Feature;
  wall: Wall;
  projector: Projector;
  selected: boolean;
  onSelect?: ((id: string) => void) | undefined;
}) {
  const span = featureSpan(wall, feature);
  const a = toPaper(projector, span.start);
  const b = toPaper(projector, span.end);
  const into = { x: wall.inward.x, y: wall.inward.y };

  const common = {
    className: selected ? 'feat__item feat__item--on' : 'feat__item',
    onPointerDown: onSelect === undefined ? undefined : () => onSelect(feature.id),
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': `${feature.kind} on ${wall.index}`,
  };

  switch (feature.kind) {
    case 'door':
      return (
        <g {...common}>
          <DoorMark feature={feature} wall={wall} projector={projector} />
        </g>
      );

    case 'window':
      return (
        <g {...common}>
          {/* Two parallel lines, the drafting convention for glazing. */}
          <line className="feat__glass" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          <line
            className="feat__glass"
            x1={a.x - into.x * 3}
            y1={a.y - into.y * 3}
            x2={b.x - into.x * 3}
            y2={b.y - into.y * 3}
          />
          <line className="feat__reveal" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={7} />
          <FeatureLabel
            projector={projector}
            at={span.mid}
            into={into}
            text={`sill ${Math.round((feature.sillHeight ?? TYPICAL_SILL) / 10)}`}
          />
        </g>
      );

    case 'radiator':
    case 'column':
    case 'vent': {
      const depth = (feature.projection ?? 60) * projector.k;
      return (
        <g {...common}>
          <polygon
            className="feat__fixture"
            points={[
              `${a.x},${a.y}`,
              `${b.x},${b.y}`,
              `${b.x + into.x * depth},${b.y + into.y * depth}`,
              `${a.x + into.x * depth},${a.y + into.y * depth}`,
            ].join(' ')}
          />
        </g>
      );
    }

    case 'tv-mount':
      return (
        <g {...common}>
          {/* A wall TV has no footprint, so it is drawn as a bar ON the wall,
              never as something standing on the floor. */}
          <line className="feat__tv" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          <FeatureLabel
            projector={projector}
            at={span.mid}
            into={into}
            text={`TV ${Math.round((feature.mountHeight ?? 1100) / 10)}`}
          />
        </g>
      );

    case 'outlet':
    case 'switch':
      return (
        <g {...common}>
          <circle
            className="feat__point"
            cx={(a.x + b.x) / 2 + into.x * 4}
            cy={(a.y + b.y) / 2 + into.y * 4}
            r={3}
          />
        </g>
      );
  }
}

/** A door: the opening cleared, the leaf drawn, and the arc it sweeps. */
function DoorMark({
  feature,
  wall,
  projector,
}: {
  feature: Feature;
  wall: Wall;
  projector: Projector;
}) {
  const span = featureSpan(wall, feature);
  const a = toPaper(projector, span.start);
  const b = toPaper(projector, span.end);
  const spec = feature.door;

  const swing = doorSwingZone(wall, feature);
  const track = slideTrackZone(wall, feature);

  return (
    <>
      {/* Clear the wall through the opening, so the door reads as a gap. */}
      <line
        className="feat__opening"
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        strokeWidth={sw(projector, 1) * projector.k * 6}
      />

      {swing?.sector !== undefined && (
        <>
          {(() => {
            const c = toPaper(projector, swing.sector.center);
            const r = swing.sector.radius * projector.k;
            const from = (swing.sector.fromDeg * Math.PI) / 180;
            const to = (swing.sector.toDeg * Math.PI) / 180;
            const p0 = { x: c.x + r * Math.cos(from), y: c.y + r * Math.sin(from) };
            const p1 = { x: c.x + r * Math.cos(to), y: c.y + r * Math.sin(to) };

            return (
              <>
                <path
                  className="feat__swingfill"
                  d={`M${c.x} ${c.y} L${p0.x} ${p0.y} A${r} ${r} 0 0 1 ${p1.x} ${p1.y} Z`}
                />
                <path
                  className="feat__swingarc"
                  d={`M${p0.x} ${p0.y} A${r} ${r} 0 0 1 ${p1.x} ${p1.y}`}
                />
                {/* The leaf itself, at rest against the wall. */}
                <line className="feat__leaf" x1={c.x} y1={c.y} x2={p0.x} y2={p0.y} />
              </>
            );
          })()}
        </>
      )}

      {track !== null && (
        <line
          className="feat__track"
          x1={toPaper(projector, { x: track.bounds.x, y: track.bounds.y }).x}
          y1={toPaper(projector, { x: track.bounds.x, y: track.bounds.y }).y}
          x2={
            toPaper(projector, {
              x: track.bounds.x + track.bounds.w,
              y: track.bounds.y + track.bounds.d,
            }).x
          }
          y2={
            toPaper(projector, {
              x: track.bounds.x + track.bounds.w,
              y: track.bounds.y + track.bounds.d,
            }).y
          }
        />
      )}

      {spec?.isPrimary === true && (
        <FeatureLabel
          projector={projector}
          at={span.mid}
          into={{ x: -wall.inward.x, y: -wall.inward.y }}
          text="way in"
        />
      )}
    </>
  );
}

function FeatureLabel({
  projector,
  at,
  into,
  text,
}: {
  projector: Projector;
  at: { x: number; y: number };
  into: { x: number; y: number };
  text: string;
}) {
  const p = toPaper(projector, at);
  return (
    <text
      className="feat__label"
      x={p.x + into.x * 13}
      y={p.y + into.y * 13}
      textAnchor="middle"
      dominantBaseline="middle"
    >
      {text}
    </text>
  );
}
