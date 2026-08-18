import { useMemo, useState } from 'react';
import { hardViolations } from '@/core/constraints';
import { formatAreaM2, mm2ToM2 } from '@/core/units';
import { computeMetric, computeViolations, useStore } from '@/state/store';

/**
 * The arrangements you have kept.
 *
 * Two things make this a comparison rather than a file menu, and both are the
 * whole point of the panel:
 *
 * **Every row carries its own numbers.** A list of names asks you to remember
 * which one was the good one, and memory is bad at "was that the 9.4 or the
 * 8.9". With the walkable figure and the problem count on the row, choosing is
 * reading rather than recalling.
 *
 * **Everything is a difference from the baseline.** "+0.8 m²" is a decision;
 * "9.4 m²" is a number you then have to do arithmetic on. The baseline is the
 * only row without a delta, because it *is* the zero.
 *
 * "As it is now" cannot be deleted. Every figure in the app is stated as a
 * difference from it, so losing it would leave nothing to measure against —
 * the control is simply absent on that row rather than present and refusing.
 */
export function LayoutPanel() {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const items = useStore((s) => s.items);
  const features = useStore((s) => s.features);
  const bodyRadius = useStore((s) => s.bodyRadius);
  const roomType = useStore((s) => s.roomType);
  const unit = useStore((s) => s.unit);

  const layouts = useStore((s) => s.layouts);
  const activeId = useStore((s) => s.activeLayoutId);
  const baselineId = useStore((s) => s.baselineLayoutId);

  const switchLayout = useStore((s) => s.switchLayout);
  const saveLayoutAs = useStore((s) => s.saveLayoutAs);
  const duplicateLayout = useStore((s) => s.duplicateLayout);
  const renameLayout = useStore((s) => s.renameLayout);
  const deleteLayout = useStore((s) => s.deleteLayout);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  /* Measured for every arrangement, not just the active one. It is the same
     work the header already does once, times the number of rows — a handful of
     milliseconds, and without it the list cannot be compared at all. */
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

  if (room === null) return null;

  const baseline = measured.find(({ layout }) => layout.id === baselineId);

  return (
    <>
      <div className="panel__head">
        <h2 className="panel__title">Arrangements</h2>
        <button
          className="btn btn--quiet btn--sm"
          type="button"
          onClick={() => saveLayoutAs()}
          title="Copy what is on screen into a new arrangement"
        >
          Save a copy
        </button>
      </div>

      <ul className="layouts">
        {measured.map(({ layout, walkableMm2, problems }) => {
          const isBaseline = layout.id === baselineId;
          const zero = baseline?.walkableMm2 ?? null;
          const delta =
            zero === null || walkableMm2 === null || isBaseline
              ? null
              : mm2ToM2(walkableMm2 - zero);

          return (
            <li key={layout.id} className={layout.id === activeId ? 'layout layout--on' : 'layout'}>
              {editing === layout.id ? (
                <input
                  className="layout__rename"
                  value={draft}
                  autoFocus
                  aria-label={`Name for ${layout.name}`}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    renameLayout(layout.id, draft);
                    setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    /* Escape abandons the edit. Committing on blur alone would
                       make a mistyped name unrecoverable without retyping it. */
                    if (event.key === 'Escape') {
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="layout__pick"
                  aria-pressed={layout.id === activeId}
                  onClick={() => switchLayout(layout.id)}
                  onDoubleClick={() => {
                    setDraft(layout.name);
                    setEditing(layout.id);
                  }}
                >
                  <span className="layout__name">{layout.name}</span>
                  <span className="layout__stats">
                    <span className="num">
                      {walkableMm2 === null ? '—' : formatAreaM2(walkableMm2)} m²
                    </span>
                    {delta !== null && (
                      <span
                        className={
                          delta >= 0.05
                            ? 'layout__delta layout__delta--up'
                            : delta <= -0.05
                              ? 'layout__delta layout__delta--down'
                              : 'layout__delta'
                        }
                      >
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(1)}
                      </span>
                    )}
                    {problems > 0 && (
                      <span className="layout__problems">
                        {problems} problem{problems === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </button>
              )}

              <div className="layout__acts">
                <button
                  className="iconbtn"
                  type="button"
                  title={`Rename ${layout.name}`}
                  aria-label={`Rename ${layout.name}`}
                  onClick={() => {
                    setDraft(layout.name);
                    setEditing(layout.id);
                  }}
                >
                  ✎
                </button>
                <button
                  className="iconbtn"
                  type="button"
                  title={`Duplicate ${layout.name}`}
                  aria-label={`Duplicate ${layout.name}`}
                  onClick={() => duplicateLayout(layout.id)}
                >
                  ⧉
                </button>
                {/* Absent, not disabled, on the baseline. A control that is
                    always there and never works reads as broken. */}
                {!isBaseline && (
                  <button
                    className="iconbtn iconbtn--danger"
                    type="button"
                    title={`Delete ${layout.name}`}
                    aria-label={`Delete ${layout.name}`}
                    onClick={() => deleteLayout(layout.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="hint">
        Editing changes the arrangement you have selected. “As it is now” is what everything else is
        measured against, so it is worth leaving as the room you actually have.
      </p>
    </>
  );
}
