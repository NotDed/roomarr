import { useCallback, useRef } from 'react';
import { type Pose, type Rect, type Size, rotatedSize } from '@/core/geometry';
import type { Item, Placement } from '@/core/items';
import { snapMm } from '@/core/units';
import { type Projector, toModel } from '@/render/projector';

/**
 * Dragging an item, done imperatively.
 *
 * The obvious implementation puts the in-flight pose in React state and lets
 * the store re-render on every `pointermove`. That does not hold 60 fps here: a
 * furnished room is several hundred SVG nodes once clearance ghosts and
 * dimension chains are counted, and pushing every frame through zustand
 * reconciles all of them.
 *
 * So the drag mutates a single `transform` on the item's own `<g>` and commits
 * to the store exactly once, on drop. Everything else on the plan stays
 * untouched for the duration.
 *
 * `onPreview` is the hook the metric uses in the next milestone: it fires with
 * the candidate pose on each frame, so the walkable figure can recompute
 * without the whole plan re-rendering.
 */

export interface DragOptions {
  projector: Projector;
  items: readonly Item[];
  placements: readonly Placement[];
  /**
   * The room's bounding box. A drag is clamped to keep the item inside it.
   *
   * This is not the "item must be inside the room" constraint — that belongs to
   * the constraint checker, which can explain a violation instead of silently
   * preventing it. This only stops an item being flung off the canvas and lost,
   * which is a different problem with a different right answer.
   */
  bounds: Rect;
  /** Grid the pose snaps to while dragging. Alt bypasses it. */
  snap: number;
  onPreview?: ((itemId: string, pose: Pose) => void) | undefined;
  onCommit: (itemId: string, pose: Pose) => void;
}

function clamp(value: number, lo: number, hi: number): number {
  return hi < lo ? lo : value < lo ? lo : value > hi ? hi : value;
}

interface DragState {
  itemId: string;
  /** Model-space offset from the item's corner to where the pointer grabbed. */
  grabDx: number;
  grabDy: number;
  startPose: Pose;
  node: SVGGElement;
  pointerId: number;
  moved: boolean;
}

export function useItemDrag({
  projector,
  items,
  placements,
  bounds,
  snap,
  onPreview,
  onCommit,
}: DragOptions) {
  const drag = useRef<DragState | null>(null);

  /** Where the drag is pointing, snapped and kept on the canvas. */
  const resolvePose = useCallback(
    (state: DragState, event: React.PointerEvent, size: Size): Pose => {
      const svg = state.node.ownerSVGElement;
      if (svg === null) return state.startPose;

      const box = svg.getBoundingClientRect();
      const model = toModel(projector, {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });

      const raw = { x: model.x - state.grabDx, y: model.y - state.grabDy };
      /* Alt bypasses the grid, for the times when the room genuinely is not on
         a round number. */
      const stepped = event.altKey
        ? { x: Math.round(raw.x), y: Math.round(raw.y) }
        : { x: snapMm(raw.x, snap), y: snapMm(raw.y, snap) };

      return {
        ...state.startPose,
        x: clamp(stepped.x, bounds.x, bounds.x + bounds.w - size.w),
        y: clamp(stepped.y, bounds.y, bounds.y + bounds.d - size.d),
      };
    },
    [projector, snap, bounds],
  );

  /** Hand the node back to React and drop the drag, without committing. */
  const finish = useCallback(() => {
    const state = drag.current;
    if (state === null) return;
    drag.current = null;

    /* Clear the transform we were driving imperatively; the store update that
       follows (if any) re-renders the item at its real position. Leaving it in
       place would double-apply the move. */
    state.node.removeAttribute('transform');
    try {
      state.node.releasePointerCapture(state.pointerId);
    } catch {
      /* The pointer may already be gone; releasing it is best-effort. */
    }
  }, []);

  const onPointerDown = useCallback(
    (itemId: string, event: React.PointerEvent) => {
      if (event.button !== 0) return;

      const placement = placements.find((p) => p.itemId === itemId);
      const item = items.find((i) => i.id === itemId);
      if (placement === undefined || item === undefined || placement.locked) return;

      const node = event.currentTarget as unknown as SVGGElement;
      const svg = node.ownerSVGElement;
      if (svg === null) return;

      const box = svg.getBoundingClientRect();
      const model = toModel(projector, {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });

      drag.current = {
        itemId,
        grabDx: model.x - placement.pose.x,
        grabDy: model.y - placement.pose.y,
        startPose: placement.pose,
        node,
        pointerId: event.pointerId,
        moved: false,
      };

      node.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [items, placements, projector],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (state === null || event.pointerId !== state.pointerId) return;

      const item = items.find((i) => i.id === state.itemId);
      if (item === undefined) return;

      const pose = resolvePose(state, event, rotatedSize(item.footprint, state.startPose.rot));
      state.moved = true;

      /* One attribute write, in model units, inside the scaled group. Nothing
         else on the plan is touched. */
      const dx = (pose.x - state.startPose.x) * projector.k;
      const dy = (pose.y - state.startPose.y) * projector.k;
      state.node.setAttribute('transform', `translate(${dx} ${dy})`);

      onPreview?.(state.itemId, pose);
    },
    [items, resolvePose, onPreview, projector.k],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (state === null || event.pointerId !== state.pointerId) return;

      const item = items.find((i) => i.id === state.itemId);
      if (item !== undefined && state.moved) {
        onCommit(
          state.itemId,
          resolvePose(state, event, rotatedSize(item.footprint, state.startPose.rot)),
        );
      }

      finish();
    },
    [items, resolvePose, onCommit, finish],
  );

  const onPointerCancel = useCallback(() => finish(), [finish]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
