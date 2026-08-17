import type { SnapToggles } from '@/core/snapping';
import { useStore } from '@/state/store';

/**
 * Which snaps are live.
 *
 * Four switches rather than one, because they are useful at different moments
 * and get in the way at different moments. Laying a room out from scratch,
 * edges and centres do all the work. Fitting one last thing into a room that is
 * already tight, the clearance edges are the only ones worth having and the
 * others are noise. A single on/off would force that choice to be all or
 * nothing, and the usual outcome of that is people turn the whole thing off.
 *
 * Every label says what the snap *does* rather than naming the mechanism.
 * "Equal gaps" is jargon borrowed from drawing tools; "centred between things"
 * is what it actually finds for you.
 */

const KINDS: { key: keyof SnapToggles; label: string; hint: string }[] = [
  { key: 'edge', label: 'Walls and edges', hint: 'Flush against, or lined up with' },
  { key: 'center', label: 'Centre lines', hint: 'Middle of the room, middle of the bed' },
  { key: 'clearance', label: 'Clearance edges', hint: 'Just clear of what needs the space' },
  { key: 'gap', label: 'Equal gaps', hint: 'Centred between things, or matching a spacing' },
];

export function SnapPanel() {
  const room = useStore((s) => s.room);
  const snapTo = useStore((s) => s.snapTo);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const setAllSnaps = useStore((s) => s.setAllSnaps);

  if (room === null) return null;

  const on = KINDS.filter(({ key }) => snapTo[key]).length;

  return (
    <>
      <div className="panel__head">
        <h2 className="panel__title">Snapping</h2>
        {/* One control, whose label says what pressing it will do. A checkbox
            that is itself indeterminate is a puzzle at a glance. */}
        <button
          className="btn btn--quiet btn--sm"
          type="button"
          onClick={() => setAllSnaps(on === 0)}
        >
          {on === 0 ? 'All on' : 'All off'}
        </button>
      </div>

      <ul className="snaps">
        {KINDS.map(({ key, label, hint }) => (
          <li key={key}>
            <label className="snap">
              <input type="checkbox" checked={snapTo[key]} onChange={() => toggleSnap(key)} />
              <span className="snap__text">
                <span className="snap__label">{label}</span>
                <span className="snap__hint">{hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="hint">
        Hold <kbd>Alt</kbd> while dragging to place something exactly where you point.
      </p>
    </>
  );
}
