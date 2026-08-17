import type { Rect, Vec } from '@/core/geometry';
import { type Wall, pointAlongWall } from '@/core/room';
import type { Mm } from '@/core/units';
import type { WallId } from '@/core/wallrun';

/**
 * Things fixed to a wall: doors, windows, radiators, sockets, a wall-mounted
 * TV. They are not furniture — none of them can be rearranged — but they
 * constrain furniture more tightly than furniture constrains itself.
 *
 * Every feature is anchored to a **wall id** and an offset along that wall from
 * its start vertex. Storage is by id so an alcove inserted elsewhere in the run
 * cannot relocate a window; storage is by offset-along-wall rather than by
 * world coordinates so that stretching a wall by 40 mm to close the run does
 * not leave the door floating 40 mm off it.
 */

export type FeatureKind =
  'door' | 'window' | 'radiator' | 'outlet' | 'switch' | 'tv-mount' | 'vent' | 'column';

export type DoorSwing = 'in' | 'out' | 'slide' | 'bifold' | 'pocket' | 'none';

/** Which end of the opening carries the hinge, in wall direction order. */
export type HingeSide = 'start' | 'end';

export interface DoorSpec {
  hinge: HingeSide;
  swing: DoorSwing;
  /** Width of the leaf itself. Usually the opening width; different for doubles. */
  leafWidth: Mm;
  /**
   * Exactly one door in a room is primary. It seeds the reachability flood that
   * defines walkable area, and it fixes the vocabulary the blueprint speaks
   * ("Door Wall", "Far Wall"). Without one there is no honest walkable figure.
   */
  isPrimary: boolean;
}

export interface TvSpec {
  /** Screen diagonal. Viewing distance bands are all multiples of this. */
  diagonalMm: Mm;
  /**
   * Defaults to false. Re-mounting a TV means patching drywall, so the
   * optimizer treats it as fixed unless the user explicitly frees it — and
   * then it should say what the move is worth.
   */
  remountable: boolean;
}

export interface Feature {
  id: string;
  kind: FeatureKind;
  wallId: WallId;
  /** Distance from the wall's start vertex to the feature's near edge. */
  offset: Mm;
  width: Mm;

  /**
   * Floor to the underside of the opening. The rule that matters is not
   * "nothing under the window" but "nothing *taller than the sill*" — a 750 mm
   * desk under an 850 mm sill is a good layout, and treating the whole wall as
   * unusable wastes the best wall in the room.
   */
  sillHeight?: Mm;
  /** Floor to the top of the opening. */
  headHeight?: Mm;
  /** Floor to the centre of a mounted item, or to a socket. */
  mountHeight?: Mm;
  /** How far it protrudes into the room. Radiator ~80, boxed column ~300. */
  projection?: Mm;

  /**
   * Whether it blocks someone walking. A radiator does; a socket, a wall TV and
   * a window do not. This is the flag that decides whether the feature joins
   * the walking-obstacle set at all.
   */
  blocksFloor: boolean;

  door?: DoorSpec;
  tv?: TvSpec;
  /** User note, printed verbatim on the blueprint. */
  notes?: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Starting values only. Every one is editable, and the UI marks anything it
 * assumed rather than presenting a guess as a measurement.
 */
export const FEATURE_DEFAULTS: Readonly<
  Record<FeatureKind, { width: Mm; label: string; blocksFloor: boolean } & Partial<Feature>>
> = {
  door: { width: 800, label: 'Door', blocksFloor: false },
  window: { width: 1200, label: 'Window', blocksFloor: false, sillHeight: 900, headHeight: 2100 },
  radiator: { width: 1000, label: 'Radiator', blocksFloor: true, projection: 80, mountHeight: 150 },
  outlet: { width: 80, label: 'Socket', blocksFloor: false, mountHeight: 300 },
  switch: { width: 80, label: 'Switch', blocksFloor: false, mountHeight: 1100 },
  'tv-mount': { width: 1230, label: 'Wall TV', blocksFloor: false, mountHeight: 1100 },
  vent: { width: 300, label: 'Vent', blocksFloor: false, mountHeight: 0 },
  column: { width: 300, label: 'Column', blocksFloor: true, projection: 300 },
};

/** Typical residential sill height. Defaulted, always editable. */
export const TYPICAL_SILL: Mm = 900;

/**
 * A window whose sill is at or below this is presumed to be an emergency escape
 * opening in a sleeping room (IRC R310.2.2 — 44 in). That presumption drives a
 * warning, never a hard rejection: refusing to help the person with the worst
 * room is the opposite of the point.
 */
export const EGRESS_SILL_MAX: Mm = 1120;

export function isEgressWindow(feature: Feature, roomIsSleeping: boolean): boolean {
  return (
    feature.kind === 'window' &&
    roomIsSleeping &&
    (feature.sillHeight ?? TYPICAL_SILL) <= EGRESS_SILL_MAX
  );
}

// ── Placement ─────────────────────────────────────────────────────────────

/** Where a feature sits along its wall, in world coordinates. */
export interface FeatureSpan {
  /** The near end, at `offset` from the wall start. */
  start: Vec;
  /** The far end, at `offset + width`. */
  end: Vec;
  /** Midpoint of the span, on the wall line. */
  mid: Vec;
  wall: Wall;
}

export function featureSpan(wall: Wall, feature: Feature): FeatureSpan {
  const start = pointAlongWall(wall, feature.offset);
  const end = pointAlongWall(wall, feature.offset + feature.width);
  return {
    start,
    end,
    mid: pointAlongWall(wall, feature.offset + Math.round(feature.width / 2)),
    wall,
  };
}

/**
 * The floor rectangle a feature occupies, projecting `depth` into the room.
 *
 * Built from the wall's exact unit `direction` and `inward` vectors rather than
 * by interpolation, so an integer offset produces an integer rectangle.
 */
export function featureRect(wall: Wall, feature: Feature, depth: Mm): Rect {
  const into = wall.inward;

  const corners: Vec[] = [
    pointAlongWall(wall, feature.offset),
    pointAlongWall(wall, feature.offset + feature.width),
  ].flatMap((p) => [p, { x: p.x + into.x * depth, y: p.y + into.y * depth }]);

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  /* The wall's direction and its inward normal are perpendicular axis vectors,
     so this rectangle is axis-aligned by construction — features never need a
     rotation, which is what keeps every downstream overlap test to two interval
     comparisons. */
  return { x, y, w: Math.max(...xs) - x, d: Math.max(...ys) - y };
}

/**
 * The distances from each end of the wall to the feature, which is how the
 * form asks for a position and how the blueprint prints it.
 *
 * Two numbers that must sum to the wall length with the feature's width. That
 * redundancy is the point: someone measuring 1200 from one corner and 900 from
 * the other on a 3400 wall with an 800 door has made an arithmetic error the
 * form can catch, exactly as the wall run catches a mistyped wall.
 */
export function featureGaps(
  wall: Wall,
  feature: Feature,
): { fromStart: Mm; fromEnd: Mm; fits: boolean } {
  const fromStart = feature.offset;
  const fromEnd = wall.length - feature.offset - feature.width;
  return { fromStart, fromEnd, fits: fromStart >= 0 && fromEnd >= 0 };
}

// ── Lookup ────────────────────────────────────────────────────────────────

/** Walls by id, given the run's wall ids in outline order. */
export function wallsById(walls: readonly Wall[], wallIds: readonly WallId[]): Map<WallId, Wall> {
  const map = new Map<WallId, Wall>();
  wallIds.forEach((id, index) => {
    const wall = walls[index];
    if (wall !== undefined) map.set(id, wall);
  });
  return map;
}

/**
 * Features whose wall no longer exists.
 *
 * Surfaced as a problem rather than dropped silently — "the window was on a
 * wall you removed" is recoverable; a window that quietly vanishes is not.
 */
export function orphanedFeatures(
  features: readonly Feature[],
  byId: ReadonlyMap<WallId, Wall>,
): Feature[] {
  return features.filter((f) => !byId.has(f.wallId));
}

/** The primary door, or null. There is no honest walkable figure without one. */
export function primaryDoor(features: readonly Feature[]): Feature | null {
  return features.find((f) => f.kind === 'door' && f.door?.isPrimary === true) ?? null;
}

/** Index of the wall carrying the primary door, for naming. */
export function primaryDoorWallIndex(
  features: readonly Feature[],
  wallIds: readonly WallId[],
): number | undefined {
  const door = primaryDoor(features);
  if (door === null) return undefined;
  const index = wallIds.indexOf(door.wallId);
  return index < 0 ? undefined : index;
}
