import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type Feature,
  type FeatureKind,
  FEATURE_DEFAULTS,
  featureSpan,
  primaryDoor,
  primaryDoorWallIndex,
  wallsById,
} from '@/core/features';
import { doorLandingZone } from '@/core/openings';
import { itemFromPreset } from '@/core/catalog';
import { type Pose, type Rect, rectsOverlap, rotateAbout, translatePose } from '@/core/geometry';
import {
  type ClearanceRule,
  type Item,
  type ItemType,
  type Layout,
  type Placement,
  itemRect,
} from '@/core/items';
import {
  type Room,
  type Wall,
  makeRectangularRoom,
  roomBounds,
  roomWalls,
  validateOutline,
} from '@/core/room';
import type { DisplayUnit, Mm } from '@/core/units';
import { SCHEMA_VERSION } from '@/core/version';
import {
  BODY_RADII,
  type BodyRadiusName,
  type WalkableResult,
  computeWalkable,
} from '@/core/walkable';
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
   * Doors, windows, radiators, sockets, the wall TV.
   *
   * A sleeping room is the default because it is the case with the extra rule
   * (an escape window), and defaulting to the stricter reading means the
   * warning appears for someone who never touches the setting.
   */
  features: Feature[];
  roomType: 'bedroom' | 'living' | 'other';
  selectedFeatureId: string | null;
  nextFeatureId: number;

  /**
   * The furniture, and where it sits.
   *
   * Items and placements are separate on purpose: before and after become two
   * layouts over one `items` array, so a move diff is a join on `itemId` and
   * the dimensions can never disagree between them.
   */
  items: Item[];
  layouts: Layout[];
  /** "As it is now" — what every later suggestion is measured against. */
  baselineLayoutId: string;
  activeLayoutId: string;
  selectedItemId: string | null;
  nextItemId: number;

  /**
   * Which body the walkable figure assumes.
   *
   * A visible control rather than a constant, because the number is
   * counter-intuitive the first time it is seen and "walkable for whom" is the
   * first question a sceptical person asks.
   */
  bodyRadius: BodyRadiusName;
  showHeat: boolean;

  /**
   * The pose an item is being dragged toward, before it is committed.
   *
   * Lives in the store so the headline figure can track a drag frame by frame
   * while the plan itself does not re-render: zustand only wakes a component
   * whose selected slice changed, and nothing that draws the plan reads this.
   * The drag keeps mutating one transform imperatively; only the number moves.
   */
  preview: { itemId: string; pose: Pose } | null;
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

  setRoomType: (type: RoomarrState['roomType']) => void;
  addFeature: (kind: FeatureKind, wallId: WallId) => void;
  updateFeature: (id: string, patch: Partial<Feature>) => void;
  removeFeature: (id: string) => void;
  selectFeature: (id: string | null) => void;
  makePrimaryDoor: (id: string) => void;

  addItem: (type: ItemType, variantIndex?: number) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;
  updateClearance: (itemId: string, ruleId: string, patch: Partial<ClearanceRule>) => void;
  removeItem: (id: string) => void;
  selectItem: (id: string | null) => void;
  moveItem: (id: string, pose: Pose) => void;
  nudgeItem: (id: string, dx: Mm, dy: Mm) => void;
  rotateItem: (id: string, quarterTurns: number) => void;
  toggleItemLock: (id: string) => void;

  setBodyRadius: (name: BodyRadiusName) => void;
  toggleHeat: () => void;
  setPreview: (preview: { itemId: string; pose: Pose } | null) => void;

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
      features: [],
      roomType: 'bedroom',
      selectedFeatureId: null,
      nextFeatureId: 0,
      items: [],
      layouts: [{ id: 'now', name: 'As it is now', kind: 'baseline', placements: [] }],
      baselineLayoutId: 'now',
      activeLayoutId: 'now',
      selectedItemId: null,
      nextItemId: 0,
      bodyRadius: 'comfort',
      showHeat: true,
      preview: null,

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

      setRoomType: (roomType) => set({ roomType }),

      addFeature: (kind, wallId) => {
        const { nextFeatureId, features } = get();
        const defaults = FEATURE_DEFAULTS[kind];
        const id = `f${nextFeatureId}`;

        /* The first door placed becomes the primary one. It is almost always
           the right guess, and it means the walkable figure and the wall names
           come alive the moment a door exists rather than after a second,
           unexplained step. */
        const isFirstDoor = kind === 'door' && !features.some((f) => f.kind === 'door');

        const feature: Feature = {
          id,
          kind,
          wallId,
          offset: 200,
          width: defaults.width,
          blocksFloor: defaults.blocksFloor,
          ...(defaults.sillHeight === undefined ? {} : { sillHeight: defaults.sillHeight }),
          ...(defaults.headHeight === undefined ? {} : { headHeight: defaults.headHeight }),
          ...(defaults.mountHeight === undefined ? {} : { mountHeight: defaults.mountHeight }),
          ...(defaults.projection === undefined ? {} : { projection: defaults.projection }),
          ...(kind === 'door'
            ? {
                door: {
                  hinge: 'start' as const,
                  swing: 'in' as const,
                  leafWidth: defaults.width,
                  isPrimary: isFirstDoor,
                },
              }
            : {}),
          ...(kind === 'tv-mount' ? { tv: { diagonalMm: 1400, remountable: false } } : {}),
        };

        set({
          features: [...features, feature],
          nextFeatureId: nextFeatureId + 1,
          selectedFeatureId: id,
        });
      },

      updateFeature: (id, patch) =>
        set((state) => ({
          features: state.features.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),

      removeFeature: (id) =>
        set((state) => ({
          features: state.features.filter((f) => f.id !== id),
          selectedFeatureId: state.selectedFeatureId === id ? null : state.selectedFeatureId,
        })),

      selectFeature: (selectedFeatureId) => set({ selectedFeatureId }),

      /* Exactly one primary door, enforced here rather than hoped for. Two
         primaries would give the reachability flood two seeds and the blueprint
         two conflicting vocabularies. */
      makePrimaryDoor: (id) =>
        set((state) => ({
          features: state.features.map((f) =>
            f.kind === 'door' && f.door !== undefined
              ? { ...f, door: { ...f.door, isPrimary: f.id === id } }
              : f,
          ),
        })),

      addItem: (type, variantIndex = 0) => {
        const { nextItemId, items, room, features } = get();
        const id = `i${nextItemId}`;
        const item = itemFromPreset(id, type, variantIndex);
        const layout = selectActiveLayout(get());

        const pose = firstFreePose(room, features, get().run, items, layout, item);

        set((state) => ({
          items: [...state.items, item],
          nextItemId: nextItemId + 1,
          selectedItemId: id,
          layouts: state.layouts.map((l) =>
            l.id === state.activeLayoutId
              ? { ...l, placements: [...l.placements, { itemId: id, pose, locked: false }] }
              : l,
          ),
        }));
      },

      updateItem: (id, patch) =>
        set((state) => ({
          items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        })),

      /* Clearances are edited per item instance, not per type: "my wardrobe has
         sliding doors" is a fact about that wardrobe, not about wardrobes. */
      updateClearance: (itemId, ruleId, patch) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  clearances: i.clearances.map((c) => (c.id === ruleId ? { ...c, ...patch } : c)),
                }
              : i,
          ),
        })),

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
          layouts: state.layouts.map((l) => ({
            ...l,
            placements: l.placements.filter((p) => p.itemId !== id),
          })),
          selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
        })),

      selectItem: (selectedItemId) => set({ selectedItemId }),

      moveItem: (id, pose) =>
        set((state) => ({
          preview: null,
          layouts: state.layouts.map((l) =>
            l.id === state.activeLayoutId
              ? {
                  ...l,
                  placements: l.placements.map((p) => (p.itemId === id ? { ...p, pose } : p)),
                }
              : l,
          ),
        })),

      nudgeItem: (id, dx, dy) => {
        const placement = selectActivePlacement(get(), id);
        if (placement === undefined) return;
        get().moveItem(id, translatePose(placement.pose, dx, dy));
      },

      rotateItem: (id, quarterTurns) => {
        const state = get();
        const placement = selectActivePlacement(state, id);
        const item = state.items.find((i) => i.id === id);
        if (placement === undefined || item === undefined) return;
        get().moveItem(id, rotateAbout(placement.pose, item.footprint, quarterTurns));
      },

      toggleItemLock: (id) =>
        set((state) => ({
          layouts: state.layouts.map((l) =>
            l.id === state.activeLayoutId
              ? {
                  ...l,
                  placements: l.placements.map((p) =>
                    p.itemId === id ? { ...p, locked: !p.locked } : p,
                  ),
                }
              : l,
          ),
        })),

      setBodyRadius: (bodyRadius) => set({ bodyRadius }),
      toggleHeat: () => set((state) => ({ showHeat: !state.showHeat })),
      setPreview: (preview) => set({ preview }),

      reset: () =>
        set({
          run: null,
          room: null,
          wallLabels: {},
          features: [],
          selectedFeatureId: null,
          items: [],
          layouts: [{ id: 'now', name: 'As it is now', kind: 'baseline', placements: [] }],
          selectedItemId: null,
        }),
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
        features: state.features,
        roomType: state.roomType,
        nextFeatureId: state.nextFeatureId,
        items: state.items,
        layouts: state.layouts,
        baselineLayoutId: state.baselineLayoutId,
        activeLayoutId: state.activeLayoutId,
        nextItemId: state.nextItemId,
        bodyRadius: state.bodyRadius,
        showHeat: state.showHeat,
      }),
    },
  ),
);

/** Live closure feedback for the room form. Null when there is no run yet. */
export function selectClosure(state: RoomarrState) {
  return state.run === null ? null : traceRun(state.run);
}

/**
 * Everything a renderer or the metric needs to relate features to geometry.
 *
 * Like `wallLabelsByIndex`, deliberately a plain function rather than a zustand
 * selector: it allocates, and zustand v5 compares snapshots by reference.
 * Callers pass stable slices and wrap it in `useMemo`.
 */
export function resolveWalls(
  room: Room | null,
  run: WallRun | null,
): { walls: Wall[]; byId: Map<WallId, Wall>; wallIds: WallId[] } {
  if (room === null || run === null) return { walls: [], byId: new Map(), wallIds: [] };

  const walls = roomWalls(room);
  const wallIds = runWallIds(run);
  return { walls, byId: wallsById(walls, wallIds), wallIds };
}

/** Which wall carries the primary door, for naming. Undefined until one exists. */
export function selectDoorWallIndex(state: RoomarrState): number | undefined {
  if (state.run === null) return undefined;
  return primaryDoorWallIndex(state.features, runWallIds(state.run));
}

/** True when the room is a sleeping room, which is what turns on egress rules. */
export function isSleepingRoom(state: RoomarrState): boolean {
  return state.roomType === 'bedroom';
}

/**
 * The active layout with an in-flight drag applied.
 *
 * Used only by the headline figure, so the number tracks the drag while the
 * drawing is still being moved imperatively.
 */
export function layoutWithPreview(
  layout: Layout,
  preview: { itemId: string; pose: Pose } | null,
): Layout {
  if (preview === null) return layout;
  return {
    ...layout,
    placements: layout.placements.map((p) =>
      p.itemId === preview.itemId ? { ...p, pose: preview.pose } : p,
    ),
  };
}

/** The layout currently being edited. */
export function selectActiveLayout(state: RoomarrState): Layout {
  return (
    state.layouts.find((l) => l.id === state.activeLayoutId) ??
    state.layouts[0] ?? { id: 'now', name: 'As it is now', kind: 'baseline', placements: [] }
  );
}

export function selectActivePlacement(state: RoomarrState, itemId: string): Placement | undefined {
  return selectActiveLayout(state).placements.find((p) => p.itemId === itemId);
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

/**
 * Somewhere sensible to drop a newly added item.
 *
 * The naive answer — a fixed corner, stepped a bit each time — puts the first
 * bed straight across the doorway, and the tool's opening move is then to
 * report that nothing in the room is reachable. Technically correct, and a
 * terrible thing to say to someone who has just added their first piece of
 * furniture.
 *
 * So: start at the corner furthest from the way in, and walk along until the
 * item clears both the door landing and everything already placed. This is not
 * a layout algorithm and is not trying to be one — the optimizer arrives in a
 * later milestone. It only has to avoid an answer that reads as broken.
 */
function firstFreePose(
  room: Room | null,
  features: readonly Feature[],
  run: WallRun | null,
  items: readonly Item[],
  layout: Layout,
  item: Item,
): Pose {
  if (room === null) return { x: 0, y: 0, rot: 0 };

  const bounds = roomBounds(room);
  const size = item.footprint;
  const inset = 50;

  const taken: Rect[] = layout.placements.flatMap((p) => {
    const existing = items.find((i) => i.id === p.itemId);
    return existing === undefined ? [] : [itemRect(existing, p)];
  });

  /* Keep clear of the doorway itself, plus somewhere to stand inside it. */
  if (run !== null) {
    const byId = wallsById(roomWalls(room), runWallIds(run));
    for (const feature of features) {
      if (feature.kind !== 'door') continue;
      const wall = byId.get(feature.wallId);
      if (wall === undefined) continue;
      const landing = doorLandingZone(wall, feature);
      if (landing !== null) taken.push(landing.bounds);
    }
  }

  /* Corner furthest from the way in, so the default is "against the far wall"
     rather than "in the traffic". */
  const door = primaryDoor(features);
  const doorPoint =
    door === null || run === null
      ? { x: bounds.x, y: bounds.y }
      : (() => {
          const wall = wallsById(roomWalls(room), runWallIds(run)).get(door.wallId);
          return wall === undefined ? { x: bounds.x, y: bounds.y } : featureSpan(wall, door).mid;
        })();

  const startFromRight = doorPoint.x - bounds.x < bounds.w / 2;
  const startFromBottom = doorPoint.y - bounds.y < bounds.d / 2;

  const maxX = bounds.x + bounds.w - size.w - inset;
  const maxY = bounds.y + bounds.d - size.d - inset;
  const minX = bounds.x + inset;
  const minY = bounds.y + inset;

  const step = 100;
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 60; col++) {
      const x = startFromRight ? maxX - col * step : minX + col * step;
      const y = startFromBottom ? maxY - row * step : minY + row * step;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;

      const candidate: Rect = { x, y, w: size.w, d: size.d };
      if (!taken.some((t) => rectsOverlap(t, candidate))) {
        return { x: Math.round(x), y: Math.round(y), rot: 0 };
      }
    }
  }

  /* Everything is crowded. Put it somewhere visible and let the user sort it
     out — refusing to add the item would be worse. */
  return { x: Math.round(minX), y: Math.round(minY), rot: 0 };
}

/**
 * The metric for the layout being edited.
 *
 * A plain function, not a zustand selector: it allocates several typed arrays,
 * and zustand v5 compares snapshots by reference, so using it as a selector
 * would recompute and re-render forever. Callers pass stable slices and wrap
 * it in a `useMemo` keyed on exactly what the answer depends on.
 *
 * Returns null when there is no room yet. It returns a result carrying an
 * `infeasible` reason when there is a room but no door — the raw clear-floor
 * figure is still honest and worth showing, even when the walkable one is not
 * yet defined.
 */
export function computeMetric(
  room: Room | null,
  run: WallRun | null,
  items: readonly Item[],
  layout: Layout,
  features: readonly Feature[],
  bodyRadius: BodyRadiusName,
): WalkableResult | null {
  if (room === null || run === null) return null;

  return computeWalkable({
    room,
    items,
    layout,
    features,
    wallIds: runWallIds(run),
    radius: BODY_RADII[bodyRadius],
  });
}
