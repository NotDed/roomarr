import { useState } from 'react';
import { type DisplayUnit, formatLength, parseLength } from '@/core/units';
import type { RecessDirection } from '@/core/wallrun';
import { useStore } from '@/state/store';

/**
 * Alcoves, bays, chimney breasts and boxed-in pipes.
 *
 * Every one of these is the same rectangular recess in a wall — outward for an
 * alcove or a bay, inward for a chimney breast — so they are one form rather
 * than four features. A stepped bay is this applied twice to the wall the first
 * one created.
 *
 * Worth having as a template even though the wall list can already express the
 * same shape: nobody thinks of a chimney breast as "four extra walls with these
 * turns", and the awkward corners of a room are exactly the reason someone came
 * looking for help arranging it.
 */
export function RecessForm() {
  const run = useStore((s) => s.run);
  const unit = useStore((s) => s.unit);
  const addRecess = useStore((s) => s.addRecess);

  const [open, setOpen] = useState(false);
  const [wall, setWall] = useState(0);
  const [offset, setOffset] = useState('50');
  const [width, setWidth] = useState('120');
  const [depth, setDepth] = useState('80');
  const [direction, setDirection] = useState<RecessDirection>('out');
  const [problem, setProblem] = useState<string | null>(null);

  if (run === null) return null;

  if (!open) {
    return (
      <button className="btn roomform__add" type="button" onClick={() => setOpen(true)}>
        + Alcove, bay or chimney breast
      </button>
    );
  }

  const parsed = {
    offset: parseLength(offset, unit),
    width: parseLength(width, unit),
    depth: parseLength(depth, unit),
  };
  const valid = Object.values(parsed).every((v) => v !== null);

  return (
    <div className="recess">
      <div className="recess__dir" role="group" aria-label="Direction">
        <button
          type="button"
          className={direction === 'out' ? 'recess__diropt recess__diropt--on' : 'recess__diropt'}
          aria-pressed={direction === 'out'}
          onClick={() => setDirection('out')}
        >
          Pushes out
          <small>alcove, bay</small>
        </button>
        <button
          type="button"
          className={direction === 'in' ? 'recess__diropt recess__diropt--on' : 'recess__diropt'}
          aria-pressed={direction === 'in'}
          onClick={() => setDirection('in')}
        >
          Eats in
          <small>chimney, boxing</small>
        </button>
      </div>

      <div className="field">
        <label htmlFor="recess-wall">On wall</label>
        <select
          id="recess-wall"
          value={wall}
          onChange={(e) => setWall(Number(e.target.value))}
          className="field__input"
        >
          {run.segments.map((segment, i) => (
            <option key={i} value={i}>
              {i + 1} — {formatLength(segment.length, unit)} {unit}
            </option>
          ))}
        </select>
      </div>

      <NumberField
        id="recess-offset"
        label="From corner"
        value={offset}
        unit={unit}
        onChange={setOffset}
      />
      <NumberField id="recess-width" label="Width" value={width} unit={unit} onChange={setWidth} />
      <NumberField id="recess-depth" label="Depth" value={depth} unit={unit} onChange={setDepth} />

      {problem !== null && <p className="recess__problem">{problem}</p>}

      <div className="recess__actions">
        <button
          className="btn btn--primary"
          type="button"
          disabled={!valid}
          onClick={() => {
            if (parsed.offset === null || parsed.width === null || parsed.depth === null) return;
            const message = addRecess(wall, {
              offset: parsed.offset,
              width: parsed.width,
              depth: parsed.depth,
              direction,
            });
            setProblem(message);
            if (message === null) setOpen(false);
          }}
        >
          Add it
        </button>
        <button
          className="linkbtn"
          type="button"
          onClick={() => {
            setOpen(false);
            setProblem(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  unit: DisplayUnit;
  onChange: (value: string) => void;
}) {
  const bad = parseLength(value, unit) === null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={bad ? 'num field__input field__input--bad' : 'num field__input'}
        aria-invalid={bad}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="field__unit">{unit}</span>
    </div>
  );
}
