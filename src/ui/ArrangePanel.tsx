import { describeMoves } from '@/core/archive';
import { formatAreaM2, mm2ToM2 } from '@/core/units';
import { useStore } from '@/state/store';

/**
 * Ask for a better arrangement, and decide about the answer.
 *
 * The suggestion is shown as a ghost on the plan and stated as a difference —
 * "+1.4 m² walkable, 2 problems fixed, 4 things move" — before anything is
 * applied. Nothing changes until Keep is pressed, which is what makes this
 * advice rather than an edit that happened to you.
 *
 * The one result that matters most is the one people do not expect a tool to
 * give: **"what you have is already the best I found."** An optimizer that
 * always proposes a change is not optimising, it is selling.
 */
export function ArrangePanel() {
  const room = useStore((s) => s.room);
  const items = useStore((s) => s.items);
  const suggestion = useStore((s) => s.suggestion);
  const run = useStore((s) => s.runAutoArrange);
  const keep = useStore((s) => s.keepSuggestion);
  const discard = useStore((s) => s.discardSuggestion);

  if (room === null) return null;

  const ready = items.length > 0;

  return (
    <>
      <h2 className="panel__title">Rearrange</h2>

      {suggestion === null ? (
        <>
          <button
            className="btn btn--primary arrange__go"
            type="button"
            disabled={!ready}
            onClick={run}
          >
            Find a better arrangement
          </button>
          <p className="hint">
            {ready
              ? 'Tries every sensible spot for each thing. Nothing moves until you say so.'
              : 'Add some furniture first.'}
          </p>
        </>
      ) : suggestion.keptOriginal ? (
        <>
          <p className="arrange__same">
            Your current arrangement is the best I found. Nothing worth moving.
          </p>
          <div className="btnrow">
            <button className="btn" type="button" onClick={discard}>
              OK
            </button>
            <button className="btn" type="button" onClick={run}>
              Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <Delta suggestion={suggestion} />

          <ul className="arrange__facts">
            <li>{describeMoves(suggestion.moved.length)}</li>
            {suggestion.beforeProblems > suggestion.afterProblems && (
              <li className="arrange__fixed">
                {suggestion.beforeProblems - suggestion.afterProblems} problem
                {suggestion.beforeProblems - suggestion.afterProblems === 1 ? '' : 's'} fixed
              </li>
            )}
            {suggestion.afterProblems > 0 && (
              <li className="arrange__left">{suggestion.afterProblems} still unresolved</li>
            )}
          </ul>

          <div className="btnrow">
            <button className="btn btn--primary" type="button" onClick={keep}>
              Keep it
            </button>
            <button className="btn" type="button" onClick={discard}>
              No thanks
            </button>
            <button className="btn" type="button" onClick={run}>
              Another
            </button>
          </div>

          <p className="hint">The dashed outlines show where things would go.</p>
        </>
      )}
    </>
  );
}

function Delta({
  suggestion,
}: {
  suggestion: NonNullable<ReturnType<typeof useStore.getState>['suggestion']>;
}) {
  const delta = mm2ToM2(suggestion.afterMm2 - suggestion.beforeMm2);
  const better = delta >= 0.05;

  return (
    <div className="arrange__delta">
      <span className={better ? 'arrange__num arrange__num--up' : 'arrange__num'}>
        {delta >= 0 ? '+' : ''}
        {delta.toFixed(1)} m²
      </span>
      <span className="arrange__from num">
        {formatAreaM2(suggestion.beforeMm2)} → {formatAreaM2(suggestion.afterMm2)} m² walkable
      </span>
    </div>
  );
}
