import { useMemo } from 'react';
import { formatAreaM2 } from '@/core/units';
import { computeMetric, layoutWithPreview, selectActiveLayout, useStore } from '@/state/store';

/**
 * The headline figure, permanently in the header.
 *
 * It has lived here since the first milestone, before anything could compute
 * it, because it is the number the whole app exists to move — and because the
 * plan is usually where your eyes are, not the inspector.
 */
export function AppHeader() {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const items = useStore((s) => s.items);
  const layout = useStore(selectActiveLayout);
  const features = useStore((s) => s.features);
  const bodyRadius = useStore((s) => s.bodyRadius);
  const preview = useStore((s) => s.preview);
  const showHeat = useStore((s) => s.showHeat);
  const toggleHeat = useStore((s) => s.toggleHeat);

  const live = useMemo(() => layoutWithPreview(layout, preview), [layout, preview]);
  const result = useMemo(
    () => computeMetric(room, run, items, live, features, bodyRadius),
    [room, run, items, live, features, bodyRadius],
  );

  const value =
    result === null || result.infeasible !== null ? null : formatAreaM2(result.walkableMm2);

  return (
    <header className="header">
      <div className="header__brand">
        <h1 className="header__title">roomarr</h1>
        <span className="header__tagline">rearrange for walkable floor</span>
      </div>

      <div className="header__spacer" />

      {result !== null && (
        <button
          className="btn btn--quiet"
          type="button"
          aria-pressed={showHeat}
          onClick={toggleHeat}
        >
          {showHeat ? 'Hide' : 'Show'} what counts
        </button>
      )}

      <div className={value === null ? 'metric metric--idle' : 'metric'}>
        <span className="metric__label">Walkable</span>
        <span className="metric__value num">{value ?? '—'} m²</span>
      </div>
    </header>
  );
}
