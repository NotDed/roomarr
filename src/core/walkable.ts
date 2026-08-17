import { type ClearanceField, computeClearance, erode, largestCircle } from '@/core/clearance';
import { edt2d } from '@/core/edt';
import { type Feature, featureSpan, primaryDoor, wallsById } from '@/core/features';
import type { Rect, Vec } from '@/core/geometry';
import { type Grid, cellIndex, chooseCell, makeGrid, rasterizeRoom } from '@/core/grid';
import { type Item, type Layout, itemRect, placedItems } from '@/core/items';
import { fixtureFootprint } from '@/core/openings';
import { type Room, roomArea, roomWalls } from '@/core/room';
import type { Mm, Mm2 } from '@/core/units';
import type { WallId } from '@/core/wallrun';

/**
 * Free walkable area — the number this whole project exists to move.
 *
 * ── Why the obvious definition is worthless ──────────────────────────────
 *
 * For a fixed room and fixed non-overlapping furniture,
 * `FreeArea = Area(room) − Σ Area(footprint)`. That expression contains no
 * position term at all: shove everything into a corner, spread it evenly, line
 * it along a wall — the number is identical every time. Every legal
 * arrangement ties for first place, and an optimizer built on it returns noise.
 *
 * Floor area only becomes a meaningful objective after three transformations:
 *
 *   F = P \ O                        free floor
 *   S = F \ LowHead                  minus desk kneeholes and the like
 *   C = { p ∈ S : clearance ≥ r }    ERODE — kills slivers nobody can use
 *   R = components of C meeting T    REACH — kills what you cannot get to
 *   W = (R ⊕ B_r) ∩ S                DILATE BACK — the reported figure
 *
 * Four details in there are load-bearing, and each has a specific failure:
 *
 * 1. **`O` excludes clearance zones and door swings.** The 700 mm beside the
 *    bed *is* walkable floor, and you walk through a doorway constantly — the
 *    leaf is closed while you stand there. Folding zones into the obstacle set
 *    roughly halves the measured area and produces layouts nobody would accept.
 * 2. **The doorway is seeded unconditionally.** A real person squeezes through
 *    a real door. Without this, a 700 mm door with a 350 mm body radius makes
 *    the entire room unreachable, which is a spectacular way to be wrong.
 * 3. **Four-connected, not eight.** Eight-connectivity lets the walker slip
 *    diagonally between two obstacles touching at a corner — a physically
 *    impossible route, reported as walkable.
 * 4. **Report the opening, not the erosion.** A 900 mm corridor eroded by
 *    350 mm is a 200 mm centreline. Reporting that undercounts every corridor
 *    in the room by about 78%.
 */

/** Body radii, as the radius of the disc a person sweeps. */
export const BODY_RADII = {
  /** 550 mm passage. Bare physical passability; below this it is not a walkway. */
  tight: 275 as Mm,
  /** 700 mm passage. Residential circulation minimum, and the default. */
  comfort: 350 as Mm,
  /** 915 mm passage, ADA §403.5.1. A mode, never the default. */
  accessible: 460 as Mm,
} as const;

export type BodyRadiusName = keyof typeof BODY_RADII;

export interface WalkableInput {
  room: Room;
  items: readonly Item[];
  layout: Layout;
  features: readonly Feature[];
  wallIds: readonly WallId[];
  radius: Mm;
  /** Overrides the automatic choice. Tests use it to compare two tiers. */
  cell?: Mm;
}

export type Infeasible =
  { code: 'no-door'; message: string } | { code: 'door-blocked'; message: string };

export interface WalkableResult {
  grid: Grid;
  /** Cells inside the room. */
  inside: Uint8Array;
  /** Free floor: inside, minus obstacles. */
  free: Uint8Array;
  /** Standable floor: free, minus low headroom. */
  standable: Uint8Array;
  /** Where a body's centre could be. */
  eroded: Uint8Array;
  /** Eroded and connected to the doorway. */
  reached: Uint8Array;
  /** The reported set: reachable, dilated back, clipped to standable. */
  walkable: Uint8Array;

  walkableMm2: Mm2;
  /** Free floor with no erosion or reachability applied. Always shown beside. */
  rawOpenMm2: Mm2;
  roomMm2: Mm2;
  /** Eroded but unreachable — "1.4 m² you cannot get to". */
  strandedMm2: Mm2;
  largestCircle: { centre: Vec; radius: Mm };

  field: ClearanceField;
  infeasible: Infeasible | null;
}

/** Rectangles that block a person walking. */
export function walkingObstacles(
  room: Room,
  items: readonly Item[],
  layout: Layout,
  features: readonly Feature[],
  wallIds: readonly WallId[],
): Rect[] {
  const rects: Rect[] = [];

  for (const { item, placement } of placedItems(items, layout)) {
    /* A rug is floor. Excluding it here is what makes "moving the rug cannot
       change the walkable figure" true by construction rather than by luck. */
    if (item.overlappable) continue;
    rects.push(itemRect(item, placement));
  }

  const byId = wallsById(roomWalls(room), wallIds);
  for (const feature of features) {
    const wall = byId.get(feature.wallId);
    if (wall === undefined) continue;
    const footprint = fixtureFootprint(wall, feature);
    if (footprint !== null) rects.push(footprint);
  }

  return rects;
}

/**
 * Floor that is free but not standable — a desk kneehole, under a loft bed.
 *
 * Kept separate from the obstacle set because the distinction matters: you
 * cannot stand there, but the space is not blocked either, and treating it as
 * an obstacle would wrongly sever a route that actually passes under nothing.
 */
function lowHeadRects(items: readonly Item[], layout: Layout): Rect[] {
  const rects: Rect[] = [];
  for (const { item, placement } of placedItems(items, layout)) {
    if (!item.overhangFloor) continue;
    if ((item.clearHeightUnder ?? 0) >= 1900) continue;
    rects.push(itemRect(item, placement));
  }
  return rects;
}

function stampInto(mask: Uint8Array, grid: Grid, rects: readonly Rect[], value: 0 | 1): void {
  for (const rect of rects) {
    const x0 = Math.max(0, Math.ceil((rect.x - grid.ox) / grid.cell - 0.5));
    const y0 = Math.max(0, Math.ceil((rect.y - grid.oy) / grid.cell - 0.5));
    const x1 = Math.min(grid.w, Math.floor((rect.x + rect.w - grid.ox) / grid.cell - 0.5) + 1);
    const y1 = Math.min(grid.h, Math.floor((rect.y + rect.d - grid.oy) / grid.cell - 0.5) + 1);

    for (let cy = y0; cy < y1; cy++) {
      const row = cy * grid.w;
      for (let cx = x0; cx < x1; cx++) mask[row + cx] = value;
    }
  }
}

/**
 * The cells a person entering through the door first occupies.
 *
 * Seeded **unconditionally** across the doorway's span, pushed one body radius
 * into the room. If the door is narrower than the body diameter the eroded set
 * has no cell there at all — and yet a real person still gets through a real
 * door, so refusing to seed would report the whole room unreachable.
 */
function doorSeeds(
  room: Room,
  grid: Grid,
  features: readonly Feature[],
  wallIds: readonly WallId[],
  radius: Mm,
): number[] {
  const door = primaryDoor(features);
  if (door === null) return [];

  const byId = wallsById(roomWalls(room), wallIds);
  const wall = byId.get(door.wallId);
  if (wall === undefined) return [];

  const seeds: number[] = [];
  const span = featureSpan(wall, door);
  const steps = Math.max(2, Math.ceil(door.width / grid.cell) + 1);

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const along = {
      x: span.start.x + (span.end.x - span.start.x) * t,
      y: span.start.y + (span.end.y - span.start.y) * t,
    };
    /* Step inward far enough to clear the wall itself. */
    for (const depth of [radius, radius + grid.cell, grid.cell]) {
      const p = { x: along.x + wall.inward.x * depth, y: along.y + wall.inward.y * depth };
      const cx = Math.floor((p.x - grid.ox) / grid.cell);
      const cy = Math.floor((p.y - grid.oy) / grid.cell);
      if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) continue;
      seeds.push(cellIndex(grid, cx, cy));
    }
  }

  return seeds;
}

/**
 * Four-connected flood from the seeds.
 *
 * Four, not eight: eight-connectivity would let the walker cross between two
 * obstacles that merely touch at a corner, which is a route no body can take
 * and which shows up as free floor on the far side of a blockage.
 */
function flood(mask: Uint8Array, grid: Grid, seeds: readonly number[]): Uint8Array {
  const out = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;

  for (const seed of seeds) {
    if (mask[seed] !== 0 && out[seed] === 0) {
      out[seed] = 1;
      queue[tail++] = seed;
    }
  }

  while (head < tail) {
    const i = queue[head++] ?? 0;
    const cx = i % grid.w;
    const cy = (i - cx) / grid.w;

    if (cx > 0) {
      const n = i - 1;
      if (mask[n] !== 0 && out[n] === 0) {
        out[n] = 1;
        queue[tail++] = n;
      }
    }
    if (cx + 1 < grid.w) {
      const n = i + 1;
      if (mask[n] !== 0 && out[n] === 0) {
        out[n] = 1;
        queue[tail++] = n;
      }
    }
    if (cy > 0) {
      const n = i - grid.w;
      if (mask[n] !== 0 && out[n] === 0) {
        out[n] = 1;
        queue[tail++] = n;
      }
    }
    if (cy + 1 < grid.h) {
      const n = i + grid.w;
      if (mask[n] !== 0 && out[n] === 0) {
        out[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  return out;
}

function areaOf(mask: Uint8Array, grid: Grid): Mm2 {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++;
  return n * grid.cell * grid.cell;
}

/** Compute the metric. */
export function computeWalkable(input: WalkableInput): WalkableResult {
  const { room, items, layout, features, wallIds, radius } = input;
  const cell = input.cell ?? chooseCell(room);
  const grid = makeGrid(room, cell);

  const inside = rasterizeRoom(room, grid);

  const obstacles = walkingObstacles(room, items, layout, features, wallIds);
  const free = Uint8Array.from(inside);
  stampInto(free, grid, obstacles, 0);

  const standable = Uint8Array.from(free);
  stampInto(standable, grid, lowHeadRects(items, layout), 0);

  const field = computeClearance(room, grid, obstacles, inside);
  const eroded = erode(field, standable, radius);

  const empty = (): WalkableResult => ({
    grid,
    inside,
    free,
    standable,
    eroded,
    reached: new Uint8Array(inside.length),
    walkable: new Uint8Array(inside.length),
    walkableMm2: 0,
    rawOpenMm2: areaOf(free, grid),
    roomMm2: roomArea(room),
    strandedMm2: areaOf(eroded, grid),
    largestCircle: { centre: { x: 0, y: 0 }, radius: 0 },
    field,
    infeasible: { code: 'no-door', message: 'Add a door to measure walkable floor.' },
  });

  if (primaryDoor(features) === null) return empty();

  const seeds = doorSeeds(room, grid, features, wallIds, radius);
  const reached = flood(eroded, grid, seeds);

  let anyReached = false;
  for (let i = 0; i < reached.length; i++) {
    if (reached[i] !== 0) {
      anyReached = true;
      break;
    }
  }

  if (!anyReached) {
    return {
      ...empty(),
      reached,
      infeasible: {
        code: 'door-blocked',
        message: 'Nothing is reachable from the door — something is blocking the way in.',
      },
    };
  }

  /* Dilate back. `edt2d` gives squared distance in CELLS to the nearest
     reachable cell, so the threshold is the radius expressed in cells. Without
     this step a 900 mm corridor would report as its 200 mm centreline. */
  const distToReach = edt2d(reached, grid.w, grid.h);
  const radiusCells = radius / grid.cell;
  const thresholdCells = radiusCells * radiusCells;

  const walkable = new Uint8Array(inside.length);
  for (let i = 0; i < walkable.length; i++) {
    if (standable[i] !== 0 && (distToReach[i] ?? Number.POSITIVE_INFINITY) <= thresholdCells) {
      walkable[i] = 1;
    }
  }

  const strandedCells = (() => {
    let n = 0;
    for (let i = 0; i < eroded.length; i++) if (eroded[i] !== 0 && reached[i] === 0) n++;
    return n;
  })();

  return {
    grid,
    inside,
    free,
    standable,
    eroded,
    reached,
    walkable,
    walkableMm2: areaOf(walkable, grid),
    rawOpenMm2: areaOf(free, grid),
    roomMm2: roomArea(room),
    strandedMm2: strandedCells * grid.cell * grid.cell,
    largestCircle: largestCircle(field, reached),
    field,
    infeasible: null,
  };
}

/**
 * How each cell should be explained to the user.
 *
 * The four-way split is what turns a number into something arguable: not just
 * "this much floor works" but "that strip is too narrow" and "you cannot get
 * behind there".
 */
export type CellClass = 'outside' | 'blocked' | 'walkable' | 'too-narrow' | 'unreachable';

export function classifyCells(result: WalkableResult): Uint8Array {
  const CLASSES: Record<CellClass, number> = {
    outside: 0,
    blocked: 1,
    walkable: 2,
    'too-narrow': 3,
    unreachable: 4,
  };

  const out = new Uint8Array(result.inside.length);
  for (let i = 0; i < out.length; i++) {
    if (result.inside[i] === 0) out[i] = CLASSES.outside;
    else if (result.standable[i] === 0) out[i] = CLASSES.blocked;
    else if (result.walkable[i] !== 0) out[i] = CLASSES.walkable;
    else if (result.eroded[i] !== 0) out[i] = CLASSES.unreachable;
    else out[i] = CLASSES['too-narrow'];
  }
  return out;
}

export const CELL_CLASS_VALUES = {
  outside: 0,
  blocked: 1,
  walkable: 2,
  'too-narrow': 3,
  unreachable: 4,
} as const;
