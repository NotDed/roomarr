import { FeaturePanel } from '@/ui/FeaturePanel';
import { ItemPanel } from '@/ui/ItemPanel';
import { MetricPanel } from '@/ui/MetricPanel';
import { RoomForm } from '@/ui/RoomForm';

/**
 * The right-hand panel: details of whatever you have selected, and nothing
 * else. Sections below "Room" are stubbed rather than hidden so the frame's
 * proportions stay honest; each is filled in by the milestone that owns it.
 */
export function Inspector() {
  return (
    <aside className="inspector" aria-label="Inspector">
      <section className="panel panel--metric">
        <MetricPanel />
      </section>

      <section className="panel">
        <RoomForm />
      </section>

      <section className="panel">
        <FeaturePanel />
      </section>

      <section className="panel">
        <ItemPanel />
      </section>
    </aside>
  );
}
