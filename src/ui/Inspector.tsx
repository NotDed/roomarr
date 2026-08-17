import { ArrangePanel } from '@/ui/ArrangePanel';
import { FeaturePanel } from '@/ui/FeaturePanel';
import { ItemPanel } from '@/ui/ItemPanel';
import { MetricPanel } from '@/ui/MetricPanel';
import { ProblemsPanel } from '@/ui/ProblemsPanel';
import { RoomForm } from '@/ui/RoomForm';

/**
 * The right-hand panel.
 *
 * Ordered by how often you need it, not by the order things were built: the
 * headline figure and anything wrong with the room sit at the top, because
 * those are what you glance at after every change. The forms that built the
 * room are below, since they are mostly used once.
 */
export function Inspector() {
  return (
    <aside className="inspector" aria-label="Inspector">
      <section className="panel panel--metric">
        <MetricPanel />
      </section>

      <section className="panel panel--arrange">
        <ArrangePanel />
      </section>

      <section className="panel">
        <ProblemsPanel />
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
