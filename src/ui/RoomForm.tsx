import { useState } from 'react';
import { roomArea } from '@/core/room';
import { type DisplayUnit, formatAreaM2, formatLength, parseLength } from '@/core/units';
import { type Turn, residualMagnitude, runCloses, traceRun } from '@/core/wallrun';
import { useStore } from '@/state/store';
import { RecessForm } from '@/ui/RecessForm';

const flip = (turn: Turn): Turn => (turn === 'right' ? 'left' : 'right');

/**
 * Room entry as a wall run.
 *
 * The form mirrors what someone standing in the room is holding: an ordered
 * list of wall lengths and the turn at the end of each. The live closure
 * readout is the reason this shape is worth the extra components — it turns a
 * mistyped wall into immediate, specific feedback instead of a room that is
 * quietly the wrong shape for the rest of the session.
 */
export function RoomForm() {
  const unit = useStore((s) => s.unit);
  const run = useStore((s) => s.run);
  const room = useStore((s) => s.room);
  const setRun = useStore((s) => s.setRun);
  const addWall = useStore((s) => s.addWall);
  const removeWall = useStore((s) => s.removeWall);
  const setUnit = useStore((s) => s.setUnit);
  const applyClosure = useStore((s) => s.applyClosure);
  const startRectangle = useStore((s) => s.startRectangle);
  const reset = useStore((s) => s.reset);

  if (run === null) return <StartForm unit={unit} onStart={startRectangle} onUnit={setUnit} />;

  const traced = traceRun(run);
  const closed = runCloses(traced);
  const gap = residualMagnitude(traced);

  return (
    <div className="roomform">
      <div className="roomform__head">
        <h2 className="panel__title">Walls, clockwise</h2>
        <UnitToggle unit={unit} onChange={setUnit} />
      </div>

      <ol className="walllist">
        {run.segments.map((segment, index) => (
          <li className="walllist__row" key={index}>
            <span className="walllist__num num">{index + 1}</span>
            <LengthField
              value={segment.length}
              unit={unit}
              label={`Wall ${index + 1} length`}
              onCommit={(length) => {
                const segments = run.segments.map((s, i) => (i === index ? { ...s, length } : s));
                setRun({ ...run, segments });
              }}
            />
            <button
              className="turnbtn"
              type="button"
              aria-label={`Wall ${index + 1} turns ${segment.turn}`}
              onClick={() => {
                const segments = run.segments.map((s, i) =>
                  i === index ? { ...s, turn: flip(s.turn) } : s,
                );
                setRun({ ...run, segments });
              }}
            >
              {segment.turn === 'right' ? '↱ right' : '↰ left'}
            </button>
            <button
              className="iconbtn"
              type="button"
              aria-label={`Remove wall ${index + 1}`}
              disabled={run.segments.length <= 4}
              onClick={() => removeWall(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <button className="btn roomform__add" type="button" onClick={addWall}>
        + Add a wall
      </button>

      <RecessForm />

      {/* The whole reason for entering a room this way. A wall run is
          over-determined, so a transposed digit shows up here the moment it is
          typed — something a list of corner coordinates can never do. */}
      <div className={`closure ${closed ? 'closure--ok' : 'closure--gap'}`}>
        {closed ? (
          <span>✓ Your walls close.</span>
        ) : traced.headingCloses ? (
          <>
            <span>
              Your walls miss closing by <strong className="num">{formatLength(gap, unit)}</strong>{' '}
              {unit}.
            </span>
            <button className="btn closure__fix" type="button" onClick={applyClosure}>
              Take it off the longest wall
            </button>
          </>
        ) : (
          <span>
            The turns don't come back around — there's a corner missing or one too many. No change
            of length can fix that.
          </span>
        )}
      </div>

      {room !== null && (
        <p className="roomform__area">
          Floor area <strong className="num">{formatAreaM2(roomArea(room))}</strong> m²
        </p>
      )}

      <button className="linkbtn" type="button" onClick={reset}>
        Start over
      </button>
    </div>
  );
}

function StartForm({
  unit,
  onStart,
  onUnit,
}: {
  unit: DisplayUnit;
  onStart: (width: number, depth: number) => void;
  onUnit: (unit: DisplayUnit) => void;
}) {
  const [width, setWidth] = useState('340');
  const [depth, setDepth] = useState('420');

  const w = parseLength(width, unit);
  const d = parseLength(depth, unit);
  const valid = w !== null && d !== null && w > 0 && d > 0;

  return (
    <form
      className="roomform"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onStart(w, d);
      }}
    >
      <div className="roomform__head">
        <h2 className="panel__title">Your room</h2>
        <UnitToggle unit={unit} onChange={onUnit} />
      </div>

      <p className="roomform__hint">
        Start with the overall size. You can add alcoves and turn it into an L-shape next — nothing
        here is fixed.
      </p>

      <div className="field">
        <label htmlFor="room-w">Width</label>
        <input
          id="room-w"
          className="num"
          value={width}
          inputMode="decimal"
          onChange={(e) => setWidth(e.target.value)}
        />
        <span className="field__unit">{unit}</span>
      </div>

      <div className="field">
        <label htmlFor="room-d">Depth</label>
        <input
          id="room-d"
          className="num"
          value={depth}
          inputMode="decimal"
          onChange={(e) => setDepth(e.target.value)}
        />
        <span className="field__unit">{unit}</span>
      </div>

      <button className="btn btn--primary" type="submit" disabled={!valid}>
        Draw it
      </button>
    </form>
  );
}

function UnitToggle({
  unit,
  onChange,
}: {
  unit: DisplayUnit;
  onChange: (unit: DisplayUnit) => void;
}) {
  const units: DisplayUnit[] = ['mm', 'cm', 'm'];
  return (
    <div className="unittoggle" role="group" aria-label="Units">
      {units.map((u) => (
        <button
          key={u}
          type="button"
          className={u === unit ? 'unittoggle__btn unittoggle__btn--on' : 'unittoggle__btn'}
          aria-pressed={u === unit}
          onClick={() => onChange(u)}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

/**
 * A length input that only commits a parseable value.
 *
 * Keeps its own draft text so a half-typed "3." does not momentarily reshape
 * the room, and marks itself invalid rather than substituting a guess — the
 * whole point of `parseLength` returning null.
 */
function LengthField({
  value,
  unit,
  label,
  onCommit,
}: {
  value: number;
  unit: DisplayUnit;
  label: string;
  onCommit: (mm: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  /* Rows are keyed by index, so deleting a wall makes React reuse this
     component instance for what is now a different wall. Dropping the draft
     whenever the committed value changes underneath keeps a half-typed number
     from reappearing against its neighbour. Typing does not trigger this —
     `value` only moves on commit or on an edit from elsewhere. */
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(null);
  }

  const text = draft ?? formatLength(value, unit);
  const parsed = parseLength(text, unit);
  const invalid = draft !== null && (parsed === null || parsed <= 0);

  return (
    <span className="field field--inline">
      <input
        className={invalid ? 'num field__input field__input--bad' : 'num field__input'}
        aria-label={label}
        aria-invalid={invalid}
        inputMode="decimal"
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (parsed !== null && parsed > 0) onCommit(parsed);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      <span className="field__unit">{unit}</span>
    </span>
  );
}
