import { type Feature, wallsById } from '@/core/features';
import {
  type Pose,
  type Rect,
  ROTATIONS,
  type Rot,
  rectsOverlap,
  rotatedSize,
} from '@/core/geometry';
import { type Item, clearanceRect, itemRect, sideDirection } from '@/core/items';
import { type Zone, featureZones } from '@/core/openings';
import { type Room, type Wall, rectInsideRoom, roomBounds, roomWalls } from '@/core/room';
import type { Mm } from '@/core/units';
import { rectIntersectsSector } from '@/core/constraints';
import type { WallId } from '@/core/wallrun';

/**
 * The poses worth considering for each item.
 *
 * Two decisions here shape everything downstream.
 *
 * **Poses are generated, not searched over continuously.** Furniture in real
 * rooms is overwhelmingly wall-hugging, and rotation is restricted to quarter
 * turns, so the space of sensible positions is small and enumerable. That turns
 * an awkward continuous optimisation into picking one integer per item — and an
 * integer index is a state a later annealing search can mutate with a single
 * write.
 *
 * **Every generated pose is already legal.** Each one is checked against the
 * hard constraints *at generation time*, so any layout the search can reach is
 * feasible by construction: no repair step, no invalid intermediate state, and
 * no possibility of the search proposing something with the bed across the
 * doorway. Filtering here rather than scoring-then-rejecting also means the
 * search never wastes a step on a state it will throw away.
 */

export interface Candidate {
  pose: Pose;
  /** The wall this pose sits against, or null for a floating pose. */
  wallIndex: number | null;
  /** Roughly where along that wall — used later to keep suggestions diverse. */
  third: 0 | 1 | 2;
}

export interface CandidateSet {
  itemId: string;
  candidates: Candidate[];
}

export interface CandidateContext {
  room: Room;
  features: readonly Feature[];
  wallIds: readonly WallId[];
  roomIsSleeping: boolean;
  /** Items that cannot move, with the space they occupy. */
  fixed: readonly { item: Item; rect: Rect }[];
}

/** How finely a pose slides along a wall. Coarse on purpose — see below. */
export const WALL_STEP: Mm = 50;

/** Ceiling on poses per item, so a big room cannot explode the search. */
export const MAX_CANDIDATES = 240;

/** Gap left behind an item for a skirting board. */
export const SKIRTING: Mm = 20;

/**
 * Generate the poses an item could sensibly take.
 *
 * Sources, in the order they are added — which matters, because the cap keeps
 * the earliest and those are the most valuable:
 *
 * 1. **Corner-nested** — flush against two walls at once. Enumerated explicitly
 *    rather than left for the search to stumble into, because corners are where
 *    most good layouts put their biggest pieces and a stepped scan hits them
 *    only by luck.
 * 2. **Wall-flush** — back against each wall, stepped along it.
 * 3. **Against another item** — flush to a fixed item's edge, so a nightstand
 *    can find the side of a bed.
 * 4. **Floating** — a coarse lattice, and only for items that may float. A
 *    bedroom has one or two of those; enabling it for everything is what makes
 *    naive layout tools propose a wardrobe marooned in the middle of the room.
 */
export function generateCandidates(item: Item, ctx: CandidateContext): CandidateSet {
  const walls = roomWalls(ctx.room);
  const bounds = roomBounds(ctx.room);
  const blockers = collectBlockers(ctx, walls);

  const out: Candidate[] = [];
  const seen = new Set<string>();

  const consider = (pose: Pose, wallIndex: number | null, third: 0 | 1 | 2): void => {
    if (out.length >= MAX_CANDIDATES) return;
    const key = `${pose.x},${pose.y},${pose.rot}`;
    if (seen.has(key)) return;
    if (!isLegal(item, pose, ctx, blockers)) return;
    seen.add(key);
    out.push({ pose, wallIndex, third });
  };

  for (const wall of walls) {
    const rot = facingAwayFrom(wall);

    /* Corners first. */
    for (const t of [0, wall.length] as const) {
      const pose = poseAgainstWall(wall, item, rot, t, bounds);
      if (pose !== null) consider(pose, wall.index, t === 0 ? 0 : 2);
    }

    for (let t = 0; t <= wall.length; t += WALL_STEP) {
      const pose = poseAgainstWall(wall, item, rot, t, bounds);
      if (pose === null) continue;
      const frac = wall.length === 0 ? 0 : t / wall.length;
      consider(pose, wall.index, frac < 0.34 ? 0 : frac < 0.67 ? 1 : 2);
    }
  }

  for (const blocker of ctx.fixed) {
    for (const rot of ROTATIONS) {
      const size = rotatedSize(item.footprint, rot);
      const r = blocker.rect;
      for (const pose of [
        { x: r.x + r.w, y: r.y, rot },
        { x: r.x - size.w, y: r.y, rot },
        { x: r.x, y: r.y + r.d, rot },
        { x: r.x, y: r.y - size.d, rot },
      ] as Pose[]) {
        consider(pose, null, 1);
      }
    }
  }

  if (item.allowFloat) {
    const step = 250;
    for (const rot of ROTATIONS) {
      const size = rotatedSize(item.footprint, rot);
      for (let y = bounds.y; y + size.d <= bounds.y + bounds.d; y += step) {
        for (let x = bounds.x; x + size.w <= bounds.x + bounds.w; x += step) {
          consider({ x, y, rot }, null, 1);
        }
      }
    }
  }

  return { itemId: item.id, candidates: out };
}

/**
 * The rotation that turns an item's back to a wall, so its usable face looks
 * into the room.
 *
 * `front` is +y at rotation 0, so this is a lookup against the wall's inward
 * normal rather than a search. A wardrobe whose doors open into masonry is not
 * a layout worth scoring.
 */
export function facingAwayFrom(wall: Wall): Rot {
  const { x, y } = wall.inward;
  if (x === 0 && y === 1) return 0;
  if (x === -1) return 1;
  if (x === 0 && y === -1) return 2;
  return 3;
}

/**
 * Place an item flush against a wall, `t` millimetres along it.
 *
 * Returns null when it would hang off the end — the caller steps along the
 * whole wall and simply skips the positions where the item does not fit.
 */
function poseAgainstWall(wall: Wall, item: Item, rot: Rot, t: Mm, bounds: Rect): Pose | null {
  const size = rotatedSize(item.footprint, rot);
  const along = wall.direction;
  const inward = wall.inward;

  /* Start at the wall's origin, walk `t` along it, then step in far enough to
     clear the skirting. */
  const anchorX = wall.start.x + along.x * t;
  const anchorY = wall.start.y + along.y * t;

  /* The anchor is one corner of the item; which one depends on the direction
     the wall runs, so the item always extends *forward* along the wall. */
  const x = Math.round(
    anchorX +
      Math.min(along.x, 0) * size.w +
      Math.min(inward.x, 0) * size.w +
      (inward.x > 0 ? SKIRTING : inward.x < 0 ? -SKIRTING : 0),
  );
  const y = Math.round(
    anchorY +
      Math.min(along.y, 0) * size.d +
      Math.min(inward.y, 0) * size.d +
      (inward.y > 0 ? SKIRTING : inward.y < 0 ? -SKIRTING : 0),
  );

  const pose: Pose = { x, y, rot };
  const rect: Rect = { x, y, w: size.w, d: size.d };

  if (
    rect.x < bounds.x - 1 ||
    rect.y < bounds.y - 1 ||
    rect.x + rect.w > bounds.x + bounds.w + 1 ||
    rect.y + rect.d > bounds.y + bounds.d + 1
  ) {
    return null;
  }

  return pose;
}

interface Blockers {
  /** Zones that exclude furniture, with the height below which they don't. */
  zones: Zone[];
  fixed: readonly { item: Item; rect: Rect }[];
}

function collectBlockers(ctx: CandidateContext, walls: readonly Wall[]): Blockers {
  const byId = wallsById(walls, ctx.wallIds);
  const zones: Zone[] = [];

  for (const feature of ctx.features) {
    const wall = byId.get(feature.wallId);
    if (wall === undefined) continue;
    for (const zone of featureZones(wall, feature, ctx.roomIsSleeping)) {
      /* Egress is a warning, not a rule — it must not silently delete poses. */
      if (zone.kind === 'egress' || zone.kind === 'thermal') continue;
      zones.push(zone);
    }
  }

  return { zones, fixed: ctx.fixed };
}

/**
 * Would this pose be legal on its own?
 *
 * Checks only what depends on the item and the fixed surroundings — inside the
 * room, out of the door's way, not on top of anything immovable, and with its
 * own clearances landing on actual floor. Interactions between *movable* items
 * are the search's problem, not this function's, because they change with every
 * step and pre-filtering on them would throw away poses that become legal the
 * moment something else moves.
 */
function isLegal(item: Item, pose: Pose, ctx: CandidateContext, blockers: Blockers): boolean {
  const placement = { itemId: item.id, pose, locked: false };
  const rect = itemRect(item, placement);

  if (!rectInsideRoom(ctx.room, rect)) return false;
  if (item.height > ctx.room.ceilingHeight) return false;

  for (const blocker of blockers.fixed) {
    if (rectsOverlap(blocker.rect, rect)) return false;
  }

  for (const zone of blockers.zones) {
    if (item.height <= zone.minHeight) continue;
    const hits =
      zone.sector === undefined
        ? rectsOverlap(zone.bounds, rect)
        : rectIntersectsSector(rect, zone.sector);
    if (hits) return false;
  }

  /* A clearance that falls outside the room is a clearance the item does not
     have. Rejecting here is what stops a wardrobe being offered a pose where
     its doors open into a wall. */
  for (const rule of item.clearances) {
    if (rule.anyOfGroup !== undefined) continue;
    if (!rectInsideRoom(ctx.room, clearanceRect(item, placement, rule))) return false;
  }

  /* Grouped rules need only one member to land on floor. */
  const groups = new Map<string, boolean>();
  for (const rule of item.clearances) {
    if (rule.anyOfGroup === undefined) continue;
    const ok =
      groups.get(rule.anyOfGroup) === true ||
      rectInsideRoom(ctx.room, clearanceRect(item, placement, rule));
    groups.set(rule.anyOfGroup, ok);
  }
  for (const ok of groups.values()) {
    if (!ok) return false;
  }

  if (item.mustTouchWall && !touchesWall(ctx.room, rect)) return false;

  return true;
}

function touchesWall(room: Room, rect: Rect): boolean {
  for (const wall of roomWalls(room)) {
    const inward = wall.inward;
    /* Distance from the item's back face to the wall line. */
    const gap =
      inward.x === 1
        ? rect.x - wall.start.x
        : inward.x === -1
          ? wall.start.x - (rect.x + rect.w)
          : inward.y === 1
            ? rect.y - wall.start.y
            : wall.start.y - (rect.y + rect.d);

    if (gap >= -1 && gap <= SKIRTING + 40) {
      /* And it has to actually be alongside that wall, not merely level with
         its infinite extension. */
      const alongOk =
        wall.axis === 'horizontal'
          ? rect.x < Math.max(wall.start.x, wall.end.x) &&
            rect.x + rect.w > Math.min(wall.start.x, wall.end.x)
          : rect.y < Math.max(wall.start.y, wall.end.y) &&
            rect.y + rect.d > Math.min(wall.start.y, wall.end.y);
      if (alongOk) return true;
    }
  }
  return false;
}

/** Nearest candidate to an existing pose, for seeding a search from a layout. */
export function nearestCandidate(set: CandidateSet, pose: Pose): number {
  let best = -1;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const [i, candidate] of set.candidates.entries()) {
    const dx = candidate.pose.x - pose.x;
    const dy = candidate.pose.y - pose.y;
    /* Rotation costs a lot: a bed on the right wall turned the wrong way is a
       much bigger change than one slid a little along it. */
    const cost = dx * dx + dy * dy + (candidate.pose.rot === pose.rot ? 0 : 4_000_000);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }

  return best;
}

/** Every item's poses, in a stable order. */
export function generateAll(items: readonly Item[], ctx: CandidateContext): CandidateSet[] {
  return items.map((item) => generateCandidates(item, ctx));
}

/** Rectangles for a chosen candidate per item, for overlap tests in the search. */
export function rectsFor(
  items: readonly Item[],
  sets: readonly CandidateSet[],
  chosen: readonly number[],
): (Rect | null)[] {
  return items.map((item, i) => {
    const candidate = sets[i]?.candidates[chosen[i] ?? -1];
    if (candidate === undefined) return null;
    return itemRect(item, { itemId: item.id, pose: candidate.pose, locked: false });
  });
}

/** Which way an item's usable face points, for the functional score terms. */
export function frontDirection(rot: Rot): { x: number; y: number } {
  return sideDirection('front', rot);
}
