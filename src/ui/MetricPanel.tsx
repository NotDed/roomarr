import { useMemo } from 'react';
import { computeMetric, layoutWithPreview, selectActiveLayout, useStore } from '@/state/store';
import { MetricCard } from '@/ui/MetricCard';

/**
 * Connects the metric card to the document.
 *
 * The computation is memoised on exactly what the answer depends on — room,
 * items, placements, features, body radius — so selecting an item or renaming
 * a wall does not pay for a recompute.
 */
export function MetricPanel() {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const items = useStore((s) => s.items);
  const layout = useStore(selectActiveLayout);
  const features = useStore((s) => s.features);
  const bodyRadius = useStore((s) => s.bodyRadius);
  const preview = useStore((s) => s.preview);

  /* The preview is what makes the number track a drag. Nothing that draws the
     plan reads it, so the plan is not re-rendered by it — the item is still
     being moved by a single imperative transform. */
  const live = useMemo(() => layoutWithPreview(layout, preview), [layout, preview]);

  const result = useMemo(
    () => computeMetric(room, run, items, live, features, bodyRadius),
    [room, run, items, live, features, bodyRadius],
  );

  return <MetricCard result={result} />;
}
