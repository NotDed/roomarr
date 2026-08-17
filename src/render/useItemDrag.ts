import { type RefObject, useCallback, useRef } from 'react';
import { type Pose, type Rect, type Size, rotatedSize } from '@/core/geometry';
import type { Item, Placement } from '@/core/items';
import type { Room } from '@/core/room';
import { type SnapResult, type SnapToggles, collectTargets, snapRect } from '@/core/snapping';
import { snapMm } from '@/core/units';
import type { GuideHandle } from '@/render/SnapGuides';
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
  /** Grid the pose falls back to when no magnetic snap is near. Alt bypasses it. */
  snap: number;
  /** Needed for wall targets. Omit to drag with magnetic snapping off. */
  room?: Room | undefined;
  toggles?: SnapToggles | undefined;
  /** Guides are driven imperatively; see `SnapGuides`. */
  guides?: RefObject<GuideHandle | null> | undefined;
  onPreview?: ((itemId: string, pose: Pose) => void) | undefined;
  onCommit: (itemId: string, pose: Pose) => void;
}

/**
 * Snap tolerance, in paper units, converted through the projector.
 *
 * Specified on screen rather than in millimetres because that is where it is
 * felt. A fixed 50 mm tolerance is a comfortable grab in a bedroom and an
 * invisible one in a 9 m room zoomed to fit, even though the pointer is moving
 * the same number of pixels in both.
 */
const TOLERANCE_PAPER = 8;

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
  room,
  toggles,
  guides,
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
      const rect: Rect = { x: raw.x, y: raw.y, w: size.w, d: size.d };

      /* Alt is the single escape hatch, and it means the same thing for both
         mechanisms: "I mean exactly here". Two separate modifiers for "ignore
         the grid" and "ignore the snaps" would be two things to remember for
         one intent. */
      const free = event.altKey;

      let snapped: SnapResult | null = null;
      if (!free && room !== undefined && toggles !== undefined) {
        /* Recollected every frame rather than once on pointer-down. The other
           items do hold still, but the gap targets depend on where the moving
           item currently is — which of them it overlaps decides which it can be
           said to be "between". It is a hundred small objects per frame on a
           furnished room, against a budget of 16 ms. */
        const targets = collectTargets({
          room,
          items,
          placements,
          movingId: state.itemId,
          movingRect: rect,
          toggles,
        });
        snapped = snapRect(rect, targets, TOLERANCE_PAPER / projector.k);
      }

      if (snapped === null) guides?.current?.hide();
      else guides?.current?.show(snapped.hits, { ...rect, x: snapped.x, y: snapped.y });

      /* The grid is the fallback, not a second opinion. An axis that found a
         magnetic target keeps it — rounding a wall-flush 0 to the nearest 10 is
         harmless, but rounding a 1675 mm centre line to 1680 would silently
         undo the snap the guide has just claimed happened. */
      const held = new Set(snapped?.hits.map((hit) => hit.axis) ?? []);

      const stepped = {
        x:
          held.has('x') && snapped !== null
            ? snapped.x
            : free
              ? Math.round(raw.x)
              : snapMm(raw.x, snap),
        y:
          held.has('y') && snapped !== null
            ? snapped.y
            : free
              ? Math.round(raw.y)
              : snapMm(raw.y, snap),
      };

      return {
        ...state.startPose,
        x: clamp(stepped.x, bounds.x, bounds.x + bounds.w - size.w),
        y: clamp(stepped.y, bounds.y, bounds.y + bounds.d - size.d),
      };
    },
    [projector, snap, bounds, room, toggles, items, placements, guides],
  );

  /** Hand the node back to React and drop the drag, without committing. */
  const finish = useCallback(() => {
    const state = drag.current;
    if (state === null) return;
    drag.current = null;

    /* Guides describe a drag in progress. Left up after the drop they become
       decoration that no longer refers to anything the pointer is doing. */
    guides?.current?.hide();

    /* Clear the transform we were driving imperatively; the store update that
       follows (if any) re-renders the item at its real position. Leaving it in
       place would double-apply the move. */
    state.node.removeAttribute('transform');
    try {
      state.node.releasePointerCapture(state.pointerId);
    } catch {
      /* The pointer may already be gone; releasing it is best-effort. */
    }
  }, [guides]);

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
