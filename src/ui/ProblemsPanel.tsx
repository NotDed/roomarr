import { useMemo } from 'react';
import type { Violation } from '@/core/constraints';
import { computeViolations, selectActiveLayout, useStore } from '@/state/store';

/**
 * What is wrong with the room you already have.
 *
 * Deliberately arrives before any suggestion does. A tool that opens by
 * proposing a rearrangement is asking to be trusted on faith; one that first
 * points at the wardrobe and says its doors have 40 cm to open in has earned
 * some of that trust before it asks for any.
 *
 * Hard problems are listed first and separately from soft ones, because the
 * two mean genuinely different things: a hard problem is a layout that cannot
 * be used, a soft one is a layout that works but could be nicer. Mixing them
 * into one list of warnings teaches people to ignore all of them.
 */
export function ProblemsPanel() {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const items = useStore((s) => s.items);
  const layout = useStore(selectActiveLayout);
  const features = useStore((s) => s.features);
  const roomType = useStore((s) => s.roomType);
  const unit = useStore((s) => s.unit);
  const selectItem = useStore((s) => s.selectItem);
  const dismissed = useStore((s) => s.dismissedProblems);
  const dismissProblem = useStore((s) => s.dismissProblem);

  const violations = useMemo(
    () => computeViolations(room, run, items, layout, features, roomType, unit),
    [room, run, items, layout, features, roomType, unit],
  );

  if (room === null) {
    return (
      <>
        <h2 className="panel__title">Problems</h2>
        <p className="panel__empty">Measure the room first.</p>
      </>
    );
  }

  const live = violations.filter((v) => !dismissed.includes(keyOf(v)));
  const hard = live.filter((v) => v.severity === 'hard');
  const soft = live.filter((v) => v.severity === 'soft');

  return (
    <>
      <h2 className="panel__title">Problems</h2>

      {live.length === 0 ? (
        <p className="problems__clear">
          {items.length === 0
            ? 'Nothing to check yet — add some furniture.'
            : "Nothing wrong with this arrangement. Everything opens, everything's reachable."}
        </p>
      ) : (
        <>
          {hard.length > 0 && (
            <ul className="problems">
              {hard.map((v) => (
                <ProblemRow
                  key={keyOf(v)}
                  violation={v}
                  onSelect={() => selectItem(v.itemIds[0] ?? null)}
                />
              ))}
            </ul>
          )}

          {soft.length > 0 && (
            <>
              <p className="problems__heading">Works, but worth knowing</p>
              <ul className="problems">
                {soft.map((v) => (
                  <ProblemRow
                    key={keyOf(v)}
                    violation={v}
                    onSelect={() => selectItem(v.itemIds[0] ?? null)}
                    onDismiss={() => dismissProblem(keyOf(v))}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

function ProblemRow({
  violation,
  onSelect,
  onDismiss,
}: {
  violation: Violation;
  onSelect: () => void;
  onDismiss?: (() => void) | undefined;
}) {
  return (
    <li className={`problem problem--${violation.severity}`}>
      <button className="problem__pick" type="button" onClick={onSelect}>
        {violation.message}
      </button>
      {onDismiss !== undefined && (
        <button
          className="iconbtn"
          type="button"
          aria-label="Dismiss this warning"
          title="I know — stop telling me"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </li>
  );
}

/**
 * A stable identity for a violation, so dismissing one survives a re-check.
 *
 * Built from the code and the things involved rather than from an index, since
 * the list is recomputed from scratch on every edit and positions shift.
 */
export function keyOf(violation: Violation): string {
  return [
    violation.code,
    violation.ruleId ?? '',
    ...violation.itemIds,
    ...violation.featureIds,
  ].join('|');
}
