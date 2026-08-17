import { describeMoves } from '@/core/archive';
import { formatAreaM2, mm2ToM2 } from '@/core/units';
import { useStore } from '@/state/store';
import type { SearchOption } from '@/workers/protocol';

/**
 * Ask for a better arrangement, then choose between the answers.
 *
 * Several options rather than one, because a single answer is an edict while a
 * short list of genuinely different ideas is advice. Each is named for what
 * actually makes it different and states its own numbers, so the choice is
 * between things you can compare rather than between "A" and "B".
 *
 * Nothing is applied until Keep. The selected option is drawn on the plan as
 * ghosts meanwhile, so choosing is a matter of looking rather than imagining.
 *
 * The result people least expect a tool to give is the one that matters most:
 * **"what you have is already the best I found."** An optimizer that always
 * proposes a change is not optimising, it is selling.
 */
export function ArrangePanel() {
  const room = useStore((s) => s.room);
  const items = useStore((s) => s.items);
  const suggestion = useStore((s) => s.suggestion);
  const searching = useStore((s) => s.searching);
  const maxMoves = useStore((s) => s.maxMoves);

  const run = useStore((s) => s.runAutoArrange);
  const cancel = useStore((s) => s.cancelAutoArrange);
  const choose = useStore((s) => s.chooseOption);
  const setMaxMoves = useStore((s) => s.setMaxMoves);
  const keep = useStore((s) => s.keepSuggestion);
  const discard = useStore((s) => s.discardSuggestion);

  if (room === null) return null;

  const ready = items.length > 0;

  return (
    <>
      <h2 className="panel__title">Rearrange</h2>

      {/* A count, not a slider of abstract willingness. "Move at most two
          things" is what people actually think, and it is enforceable exactly —
          the same weight would mean something different in every room. */}
      <div className="budget" role="group" aria-label="How much may move">
        {[1, 3, 6, null].map((value) => (
          <button
            key={String(value)}
            type="button"
            className={value === maxMoves ? 'budget__opt budget__opt--on' : 'budget__opt'}
            aria-pressed={value === maxMoves}
            onClick={() => setMaxMoves(value)}
          >
            {value === null ? 'Anything' : `≤ ${value}`}
          </button>
        ))}
      </div>
      <p className="hint">How much of the room you're willing to move.</p>

      {searching !== null ? (
        <div className="searching">
          <p className="searching__label">
            Trying arrangements… <span className="num">{searching.evals}</span> so far
          </p>
          <button className="btn" type="button" onClick={cancel}>
            Stop
          </button>
        </div>
      ) : suggestion === null ? (
        <button
          className="btn btn--primary arrange__go"
          type="button"
          disabled={!ready}
          onClick={run}
        >
          Find a better arrangement
        </button>
      ) : suggestion.keptOriginal ? (
        <>
          {/* The result people least expect a tool to give. */}
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
      ) : suggestion.options.length === 0 ? (
        <>
          {/* Emphatically not the same answer as "yours is already best", and
              conflating the two would be a lie: this room has problems and the
              limit is what stopped them being fixed. */}
          <p className="arrange__none">
            {maxMoves === null
              ? "I couldn't find an arrangement that works. Something may be too big for the room."
              : `Nothing works within ${maxMoves === 1 ? 'one move' : `${maxMoves} moves`}. Allow more to move and I'll try again.`}
          </p>
          <div className="btnrow">
            {maxMoves !== null && (
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => {
                  setMaxMoves(null);
                  run();
                }}
              >
                Let anything move
              </button>
            )}
            <button className="btn" type="button" onClick={discard}>
              OK
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="options">
            {suggestion.options.map((option, index) => (
              <li key={option.label + String(index)}>
                <button
                  type="button"
                  className={index === suggestion.chosen ? 'option option--on' : 'option'}
                  aria-pressed={index === suggestion.chosen}
                  onClick={() => choose(index)}
                >
                  <OptionSummary
                    option={option}
                    baselineMm2={suggestion.baseline.walkableMm2}
                    baselineProblems={suggestion.baseline.hardProblems}
                  />
                </button>
              </li>
            ))}
          </ul>

          <div className="btnrow">
            <button className="btn btn--primary" type="button" onClick={keep}>
              Keep this one
            </button>
            <button className="btn" type="button" onClick={discard}>
              No thanks
            </button>
            <button className="btn" type="button" onClick={run}>
              Again
            </button>
          </div>

          <p className="hint">
            The dashed outlines show where things would go. Found in{' '}
            <span className="num">{(suggestion.ms / 1000).toFixed(1)}s</span>.
          </p>
        </>
      )}
    </>
  );
}

/**
 * One option, stated as a difference rather than an absolute.
 *
 * "+1.4 m²" is actionable; "9.7 m²" makes you remember what it was before.
 * Fixed problems are called out separately from floor gained, because they are
 * a different kind of good and people weigh them differently.
 */
function OptionSummary({
  option,
  baselineMm2,
  baselineProblems,
}: {
  option: SearchOption;
  baselineMm2: number;
  baselineProblems: number;
}) {
  const delta = mm2ToM2(option.walkableMm2 - baselineMm2);
  const fixed = baselineProblems - option.hardProblems;

  return (
    <>
      <span className="option__label">{option.label}</span>
      <span className="option__stats">
        <span className={delta >= 0.05 ? 'option__delta option__delta--up' : 'option__delta'}>
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)} m²
        </span>
        <span className="option__sub num">{formatAreaM2(option.walkableMm2)} m² walkable</span>
      </span>
      <span className="option__facts">
        {describeMoves(option.moved.length)}
        {fixed > 0 && <em> · {fixed === 1 ? '1 problem fixed' : `${fixed} problems fixed`}</em>}
        {option.hardProblems > 0 && <strong> · {option.hardProblems} still unresolved</strong>}
      </span>
    </>
  );
}
