import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type Room, makeRectangularRoom, validateOutline } from '@/core/room';
import type { DisplayUnit } from '@/core/units';
import { SCHEMA_VERSION } from '@/core/version';
import {
  type RecessDirection,
  type WallRun,
  closeRun,
  insertRecess,
  outlineToRun,
  runToOutline,
  traceRun,
} from '@/core/wallrun';

/**
 * The app's working document.
 *
 * The room is kept as **both** a wall run and an outline, and that redundancy is
 * intentional. The run is what the user typed and can keep editing; the outline
 * is the validated geometry everything downstream consumes. Deriving the
 * outline on every read would mean re-validating on every render, and deriving
 * the run from the outline would throw away which wall the person entered
 * first — the one they measured from, and the anchor the blueprint should use.
 */

export interface RoomarrState {
  schemaVersion: number;
  unit: DisplayUnit;

  /** What the user typed. Present even while it does not close. */
  run: WallRun | null;
  /** Validated geometry. Null until the run closes and passes validation. */
  room: Room | null;
  wallLabels: Record<number, string>;

  setUnit: (unit: DisplayUnit) => void;
  startRectangle: (width: number, depth: number) => void;
  setRun: (run: WallRun) => void;
  applyClosure: () => void;
  addRecess: (
    segmentIndex: number,
    options: { offset: number; width: number; depth: number; direction: RecessDirection },
  ) => string | null;
  setWallLabel: (index: number, label: string) => void;
  reset: () => void;
}

const RECESS_PROBLEMS: Record<string, string> = {
  'no-such-wall': 'That wall no longer exists.',
  'not-positive': 'Width and depth both need to be more than zero.',
  'too-wide': "That doesn't fit on the wall you picked.",
  'needs-margin':
    'Leave a little wall on each side. A recess flush to a corner has no wall beside it, so move it in, or edit the wall list directly.',
};

/** Rebuild the room from a run, or null it out if the run is not usable yet. */
function roomFromRun(run: WallRun, previous: Room | null): Room | null {
  const result = runToOutline(run);
  if (!result.ok) return null;
  if (validateOutline(result.outline).length > 0) return null;

  return {
    outline: result.outline,
    wallThickness: previous?.wallThickness ?? 100,
    ceilingHeight: previous?.ceilingHeight ?? 2400,
  };
}

export const useStore = create<RoomarrState>()(
  persist(
    (set, get) => ({
      schemaVersion: SCHEMA_VERSION,
      unit: 'cm',
      run: null,
      room: null,
      wallLabels: {},

      setUnit: (unit) => set({ unit }),

      startRectangle: (width, depth) => {
        const room = makeRectangularRoom(width, depth);
        set({ room, run: outlineToRun(room.outline), wallLabels: {} });
      },

      setRun: (run) => set({ run, room: roomFromRun(run, get().room) }),

      applyClosure: () => {
        const run = get().run;
        if (run === null) return;
        const result = closeRun(run);
        if (!result.ok) return;
        set({ run: result.run, room: roomFromRun(result.run, get().room) });
      },

      /** Returns a message to show when the recess could not be made, else null. */
      addRecess: (segmentIndex, options) => {
        const run = get().run;
        if (run === null) return 'There is no room to add it to yet.';

        const result = insertRecess(run, segmentIndex, options);
        if (!result.ok) return RECESS_PROBLEMS[result.reason] ?? 'That recess will not fit.';

        set({ run: result.run, room: roomFromRun(result.run, get().room) });
        return null;
      },

      setWallLabel: (index, label) =>
        set((state) => ({ wallLabels: { ...state.wallLabels, [index]: label } })),

      reset: () => set({ run: null, room: null, wallLabels: {} }),
    }),
    {
      name: 'roomarr',
      version: SCHEMA_VERSION,
      /* Only the document is persisted. Derived state and callbacks are not. */
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        unit: state.unit,
        run: state.run,
        room: state.room,
        wallLabels: state.wallLabels,
      }),
    },
  ),
);

/** Live closure feedback for the room form. Null when there is no run yet. */
export function selectClosure(state: RoomarrState) {
  return state.run === null ? null : traceRun(state.run);
}
