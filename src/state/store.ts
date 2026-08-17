import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type Room, makeRectangularRoom, validateOutline } from '@/core/room';
import type { DisplayUnit } from '@/core/units';
import { SCHEMA_VERSION } from '@/core/version';
import {
  type RecessDirection,
  type WallId,
  type WallRun,
  closeRun,
  insertRecess,
  outlineToRun,
  runToOutline,
  runWallIds,
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
 *
 * Anything attached to a wall is keyed by the wall's **id**, never its index.
 * Indices shift the moment an alcove is inserted or a wall deleted, and a
 * label or a window that silently relocates to a different wall is a
 * corruption that draws perfectly and is only caught by measuring the printed
 * plan.
 */

export interface RoomarrState {
  schemaVersion: number;
  unit: DisplayUnit;

  /** What the user typed. Present even while it does not close. */
  run: WallRun | null;
  /** Validated geometry. Null until the run closes and passes validation. */
  room: Room | null;
  /** User-supplied wall names, keyed by wall id. */
  wallLabels: Record<WallId, string>;
  /**
   * Counter behind wall ids. Persisted so ids stay unique across reloads — a
   * counter that restarted at zero would hand a fresh wall the id of one that
   * a window is already attached to.
   */
  nextWallId: number;

  setUnit: (unit: DisplayUnit) => void;
  startRectangle: (width: number, depth: number) => void;
  setRun: (run: WallRun) => void;
  addWall: () => void;
  removeWall: (index: number) => void;
  applyClosure: () => void;
  addRecess: (
    segmentIndex: number,
    options: { offset: number; width: number; depth: number; direction: RecessDirection },
  ) => string | null;
  setWallLabel: (id: WallId, label: string) => void;
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
      nextWallId: 0,

      setUnit: (unit) => set({ unit }),

      startRectangle: (width, depth) => {
        const room = makeRectangularRoom(width, depth);
        const base = get().nextWallId;
        set({
          room,
          run: outlineToRun(room.outline, (i) => `w${base + i}`),
          nextWallId: base + room.outline.length,
          wallLabels: {},
        });
      },

      setRun: (run) => set({ run, room: roomFromRun(run, get().room) }),

      /* Wall creation lives here rather than in the form, because minting the
         id is the store's job — the UI has no business inventing identities
         that windows will later be attached to. */
      addWall: () => {
        const { run, nextWallId } = get();
        if (run === null) return;

        const segments = [
          ...run.segments,
          { id: `w${nextWallId}`, length: 1000, turn: run.segments.at(-1)?.turn ?? 'right' },
        ];
        const next = { ...run, segments };
        set({ run: next, room: roomFromRun(next, get().room), nextWallId: nextWallId + 1 });
      },

      removeWall: (index) => {
        const run = get().run;
        if (run === null || run.segments.length <= 4) return;

        const next = { ...run, segments: run.segments.filter((_, i) => i !== index) };
        set({ run: next, room: roomFromRun(next, get().room) });
      },

      applyClosure: () => {
        const run = get().run;
        if (run === null) return;
        const result = closeRun(run);
        if (!result.ok) return;
        set({ run: result.run, room: roomFromRun(result.run, get().room) });
      },

      /** Returns a message to show when the recess could not be made, else null. */
      addRecess: (segmentIndex, options) => {
        const { run, nextWallId } = get();
        if (run === null) return 'There is no room to add it to yet.';

        const base = nextWallId;
        const result = insertRecess(run, segmentIndex, options, [
          `w${base}`,
          `w${base + 1}`,
          `w${base + 2}`,
          `w${base + 3}`,
        ]);
        if (!result.ok) return RECESS_PROBLEMS[result.reason] ?? 'That recess will not fit.';

        set({
          run: result.run,
          room: roomFromRun(result.run, get().room),
          nextWallId: base + 4,
        });
        return null;
      },

      setWallLabel: (id, label) =>
        set((state) => ({ wallLabels: { ...state.wallLabels, [id]: label } })),

      reset: () => set({ run: null, room: null, wallLabels: {} }),
    }),
    {
      name: 'roomarr',
      version: SCHEMA_VERSION,
      /**
       * v1 had no wall ids, and keyed wall labels by index. Mint ids in outline
       * order and re-key the labels onto them.
       *
       * Written now, for a schema with exactly one prior version and no users,
       * precisely because that is when the mechanism is cheap to get right.
       * Discovering the migration path is broken at v6 with real saved rooms is
       * the expensive version of this.
       */
      migrate: (persisted, from) => {
        const state = persisted as Partial<RoomarrState> & {
          wallLabels?: Record<string, string>;
        };
        if (from >= 2) return state as RoomarrState;

        const run = state.run;
        if (run === null || run === undefined) return { ...state, nextWallId: 0 } as RoomarrState;

        const segments = run.segments.map((segment, i) => ({ ...segment, id: `w${i}` }));
        const relabelled: Record<WallId, string> = {};
        for (const [key, label] of Object.entries(state.wallLabels ?? {})) {
          const index = Number(key);
          if (Number.isInteger(index) && index >= 0 && index < segments.length) {
            relabelled[`w${index}`] = label;
          }
        }

        return {
          ...state,
          run: { ...run, segments },
          wallLabels: relabelled,
          nextWallId: segments.length,
        } as RoomarrState;
      },
      /* Only the document is persisted. Derived state and callbacks are not. */
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        unit: state.unit,
        run: state.run,
        room: state.room,
        wallLabels: state.wallLabels,
        nextWallId: state.nextWallId,
      }),
    },
  ),
);

/** Live closure feedback for the room form. Null when there is no run yet. */
export function selectClosure(state: RoomarrState) {
  return state.run === null ? null : traceRun(state.run);
}

/**
 * Wall labels re-keyed by index, for the renderer.
 *
 * Storage is by id so labels survive edits; drawing works from the outline and
 * so knows only indices. This is the single place the two meet, rather than
 * having every consumer do the lookup and one of them eventually get it wrong.
 *
 * Deliberately a plain function rather than a zustand selector. It builds a new
 * object on every call, and zustand v5 compares snapshots by reference with no
 * automatic shallow check — passing this to `useStore` renders forever. Callers
 * select `run` and `wallLabels` (both stable references) and wrap this in a
 * `useMemo`, which needs no equality function to be correct.
 */
export function wallLabelsByIndex(
  run: WallRun | null,
  wallLabels: Readonly<Record<WallId, string>>,
): Record<number, string> {
  if (run === null) return {};
  const byIndex: Record<number, string> = {};
  runWallIds(run).forEach((id, index) => {
    const label = wallLabels[id];
    if (label !== undefined) byIndex[index] = label;
  });
  return byIndex;
}
