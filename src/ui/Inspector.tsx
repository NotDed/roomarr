import { RoomForm } from '@/ui/RoomForm';

/**
 * The right-hand panel: details of whatever you have selected, and nothing
 * else. Sections below "Room" are stubbed rather than hidden so the frame's
 * proportions stay honest; each is filled in by the milestone that owns it.
 */
export function Inspector() {
  return (
    <aside className="inspector" aria-label="Inspector">
      <section className="panel">
        <RoomForm />
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
