import { formatAreaM2, formatLength, mm2ToM2 } from '@/core/units';
import { BODY_RADII, type BodyRadiusName, type WalkableResult } from '@/core/walkable';
import { useStore } from '@/state/store';

/**
 * The headline figure.
 *
 * Two rules govern this card, and both exist because the number is
 * counter-intuitive the first time somebody sees it — walkable floor is much
 * less than the floor they can see, and if it feels arbitrary then nothing
 * downstream gets believed:
 *
 * 1. **Never show the walkable figure alone.** The clear-floor figure sits
 *    beside it always. The gap between them is the app's entire insight made
 *    visible: "12.4 m² of floor is clear, but only 8.1 m² of it is walkable."
 * 2. **Say what body it assumed.** The radius is a visible control, not a
 *    constant buried in the code, and all three figures are shown at once so
 *    the number reads as a measurement with an assumption rather than a verdict.
 */
export function MetricCard({ result }: { result: WalkableResult | null }) {
  const unit = useStore((s) => s.unit);
  const bodyRadius = useStore((s) => s.bodyRadius);
  const setBodyRadius = useStore((s) => s.setBodyRadius);

  if (result === null) {
    return (
      <>
        <h2 className="panel__title">Walkable floor</h2>
        <p className="panel__empty">Measure the room to start.</p>
      </>
    );
  }

  const pct = result.roomMm2 === 0 ? 0 : Math.round((result.walkableMm2 / result.roomMm2) * 100);

  return (
    <>
      <h2 className="panel__title">Walkable floor</h2>

      {result.infeasible !== null ? (
        <p className="callout callout--nudge">{result.infeasible.message}</p>
      ) : (
        <div className="metriccard">
          <div className="metriccard__headline">
            <span className="metriccard__value num">{formatAreaM2(result.walkableMm2)}</span>
            <span className="metriccard__unit">m²</span>
            <span className="metriccard__pct num">{pct}% of the room</span>
          </div>

          {/* Never alone. The gap between these two is the whole insight. */}
          <p className="metriccard__beside">
            <span className="num">{formatAreaM2(result.rawOpenMm2)} m²</span> of floor is clear of
            furniture — this is how much of it you can actually walk on.
          </p>

          {result.strandedMm2 > 100_000 && (
            <p className="metriccard__stranded">
              <span className="num">{formatAreaM2(result.strandedMm2)} m²</span> is wide enough but
              you can't get to it.
            </p>
          )}

          {result.largestCircle.radius > 0 && (
            <p className="metriccard__aside">
              Biggest clear circle{' '}
              <span className="num">
                {formatLength(result.largestCircle.radius * 2, unit)} {unit}
              </span>{' '}
              across.
            </p>
          )}
        </div>
      )}

      {/* A measurement with a stated assumption, not a verdict. */}
      <div className="bodypick" role="group" aria-label="Body width">
        {(Object.keys(BODY_RADII) as BodyRadiusName[]).map((name) => (
          <button
            key={name}
            type="button"
            className={name === bodyRadius ? 'bodypick__opt bodypick__opt--on' : 'bodypick__opt'}
            aria-pressed={name === bodyRadius}
            onClick={() => setBodyRadius(name)}
          >
            <span className="bodypick__name">{BODY_LABELS[name]}</span>
            <span className="bodypick__gap num">{BODY_RADII[name] * 2} mm</span>
          </button>
        ))}
      </div>

      <p className="hint">
        How wide a gap counts as somewhere you can walk. {BODY_HINTS[bodyRadius]}
      </p>

      <ul className="legend">
        <li className="legend__row">
          <span className="legend__swatch legend__swatch--walkable" /> you can walk here
        </li>
        <li className="legend__row">
          <span className="legend__swatch legend__swatch--narrow" /> too narrow to get through
        </li>
        <li className="legend__row">
          <span className="legend__swatch legend__swatch--unreachable" /> can't get to it
        </li>
      </ul>
    </>
  );
}

const BODY_LABELS: Record<BodyRadiusName, string> = {
  tight: 'Squeeze',
  comfort: 'Comfortable',
  accessible: 'Wheelchair',
};

const BODY_HINTS: Record<BodyRadiusName, string> = {
  tight: 'Bare passability — you would turn sideways.',
  comfort: 'The usual residential minimum, and achievable in a real bedroom.',
  accessible: 'ADA §403.5.1. Most bedrooms fail this almost everywhere.',
};

/** Formats a delta between two figures, for the before/after comparisons later. */
export function formatDeltaM2(before: number, after: number): string {
  const delta = mm2ToM2(after - before);
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} m²`;
}
