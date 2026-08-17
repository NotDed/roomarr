/**
 * The right-hand panel. Its job across the whole app is "details of the thing
 * you have selected, and nothing else" — room dimensions, one item's real
 * measurements, or the violations attached to a selection.
 *
 * Sections are stubbed rather than hidden so the frame's proportions are honest
 * from the start; each one is filled in by the milestone that owns it.
 */
export function Inspector() {
  return (
    <aside className="inspector" aria-label="Inspector">
      <section className="panel">
        <h2 className="panel__title">Room</h2>
        <p className="panel__empty">No room yet.</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Selection</h2>
        <p className="panel__empty">Nothing selected.</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Problems</h2>
        <p className="panel__empty">Nothing to check yet.</p>
      </section>
    </aside>
  );
}
