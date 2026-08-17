import { useEffect, useMemo, useRef, useState } from 'react';
import { RoomPlan } from '@/render/RoomPlan';
import { RunPreview } from '@/render/RunPreview';
import { runWallIds } from '@/core/wallrun';
import {
  selectActiveLayout,
  selectDoorWallIndex,
  useStore,
  wallLabelsByIndex,
} from '@/state/store';
import { EmptyState } from '@/ui/EmptyState';

/**
 * Hosts the plan and gives it a pixel size.
 *
 * The SVG is sized explicitly rather than with `width="100%"` because the
 * projector needs real numbers to centre the room and place annotation in paper
 * space, and a percentage would leave those calculations guessing.
 *
 * There are three states and the middle one is the important one: a run that
 * has been started but does not currently close still gets drawn, as an open
 * polyline with the gap marked. Falling back to the empty state there would
 * make the room disappear every time a digit is mistyped.
 */
export function PlanStage() {
  const room = useStore((s) => s.room);
  const run = useStore((s) => s.run);
  const unit = useStore((s) => s.unit);
  const labelsById = useStore((s) => s.wallLabels);
  const features = useStore((s) => s.features);
  const selectedFeatureId = useStore((s) => s.selectedFeatureId);
  const selectFeature = useStore((s) => s.selectFeature);
  const doorWallIndex = useStore(selectDoorWallIndex);

  const items = useStore((s) => s.items);
  const layout = useStore(selectActiveLayout);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const selectItem = useStore((s) => s.selectItem);
  const moveItem = useStore((s) => s.moveItem);

  const wallLabels = useMemo(() => wallLabelsByIndex(run, labelsById), [run, labelsById]);
  const wallIds = useMemo(() => (run === null ? [] : runWallIds(run)), [run]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setBox({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const sized = box.width > 0 && box.height > 0;

  return (
    <div className="stage" role="region" aria-label="Floor plan" ref={hostRef}>
      {!sized ? null : room !== null ? (
        <RoomPlan
          room={room}
          width={box.width}
          height={box.height}
          unit={unit}
          wallLabels={wallLabels}
          doorWallIndex={doorWallIndex}
          features={features}
          wallIds={wallIds}
          selectedFeatureId={selectedFeatureId}
          onSelectFeature={selectFeature}
          items={items}
          placements={layout.placements}
          selectedItemId={selectedItemId}
          onSelectItem={selectItem}
          onItemMove={moveItem}
          onBackgroundClick={() => {
            selectItem(null);
            selectFeature(null);
          }}
        />
      ) : run !== null ? (
        <RunPreview run={run} width={box.width} height={box.height} unit={unit} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
