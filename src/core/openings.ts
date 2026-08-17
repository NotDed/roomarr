import type { Rect, Vec } from '@/core/geometry';
import {
  type Feature,
  TYPICAL_SILL,
  featureRect,
  featureSpan,
  isEgressWindow,
} from '@/core/features';
import type { Wall } from '@/core/room';
import type { Mm } from '@/core/units';

/**
 * The geometry that makes an opening more than a gap in a wall.
 *
 * Everything here produces a **zone**: a region with a rule attached. The
 * distinction that governs all of them, and that is easy to get backwards:
 *
 *   A door swing blocks **furniture**, never **walking**.
 *
 * You walk through a doorway constantly; the leaf is closed while you stand
 * there. Treating the swing as a walking obstacle would carve a quarter-circle
 * out of the walkable figure right where the room's main route is.
 */

export type ZoneKind = 'swing' | 'landing' | 'slide-track' | 'operate' | 'egress' | 'thermal';

/**
 * How much a zone may be shared.
 *
 * Treating every clearance as exclusive reports most real bedrooms as
 * infeasible: one corridor legitimately serves the bed side, the wardrobe front
 * and the door landing at once.
 */
export type Share = 'exclusive' | 'shareable' | 'soft';

export interface Zone {
  featureId: string;
  kind: ZoneKind;
  share: Share;
  /**
   * Items **shorter** than this may sit inside the zone.
   *
   * This single field is what stops the tool from writing off the best wall in
   * the room. A window's operating zone sets it to `sill − 50`, so a low
   * dresser under the window is fine and a wardrobe is not. A door swing sets
   * it to 0 — leaves go to the floor, there is no height exemption.
   */
  minHeight: Mm;
  /** Axis-aligned bounds. For a swing this is the sector's bounding box. */
  bounds: Rect;
  /** Present for swings; the region is the circular sector, not the box. */
  sector?: { center: Vec; radius: Mm; fromDeg: number; toDeg: number };
  /** Printed verbatim in the violation list and on the blueprint. */
  reason: string;
}

/** Doors open past square; a leaf against a stop rests around 95°. */
export const SWING_SWEEP_DEG = 95;

/** Slack so a leaf isn't judged to graze whatever sits exactly at its radius. */
export const SWING_SLACK: Mm = 20;

/** Clear floor inside the door so you can stand and open it. */
export const DOOR_LANDING_DEPTH: Mm = 900;

/** The landing is a little wider than the opening on each side. */
export const DOOR_LANDING_MARGIN: Mm = 150;

/** Depth of the track a sliding or bifold leaf needs against the wall. */
export const SLIDE_TRACK_DEPTH: Mm = 100;

/** Reach-the-handle space in front of an operable window. */
export const WINDOW_OPERATE_DEPTH: Mm = 600;

/** Clear floor in front of an escape window (IRC R310). */
export const EGRESS_DEPTH: Mm = 900;

/** A low item may sit under a window; this is how far below the sill it must stay. */
export const SILL_HEADROOM: Mm = 50;

/** Clear floor in front of a radiator, so it isn't boxed in. */
export const RADIATOR_CLEAR: Mm = 300;

// ── Doors ─────────────────────────────────────────────────────────────────

/**
 * The quarter-circle a door leaf sweeps.
 *
 * Hinged at whichever end the user says, swept `0 → 95°` — doors open past
 * square, and a wardrobe placed at 91° of a leaf's travel is still in the way.
 * Radius is the leaf plus slack.
 *
 * Returns null for swing types that do not sweep: an outward door's leaf is
 * outside the room entirely, a pocket door vanishes into the wall, and sliding
 * and bifold doors get a track zone instead.
 */
export function doorSwingZone(wall: Wall, feature: Feature): Zone | null {
  const spec = feature.door;
  if (spec === undefined || spec.swing !== 'in') return null;

  const span = featureSpan(wall, feature);
  const center = spec.hinge === 'start' ? span.start : span.end;
  const radius = spec.leafWidth + SWING_SLACK;

  /* The leaf starts flat against the wall, pointing back along the opening,
     and sweeps into the room. Which angular direction that is depends on which
     end the hinge is at. */
  const alongDeg = Math.round(Math.atan2(wall.direction.y, wall.direction.x) * (180 / Math.PI));
  const inwardDeg = Math.round(Math.atan2(wall.inward.y, wall.inward.x) * (180 / Math.PI));

  const closedDeg = spec.hinge === 'start' ? alongDeg : alongDeg + 180;
  /* Sweep toward the inward normal, the short way round. */
  const sweep = normalizeSigned(inwardDeg - closedDeg) >= 0 ? SWING_SWEEP_DEG : -SWING_SWEEP_DEG;

  return {
    featureId: feature.id,
    kind: 'swing',
    share: 'shareable',
    minHeight: 0,
    bounds: sectorBounds(center, radius, closedDeg, closedDeg + sweep),
    sector: {
      center,
      radius,
      fromDeg: Math.min(closedDeg, closedDeg + sweep),
      toDeg: Math.max(closedDeg, closedDeg + sweep),
    },
    reason: 'The door needs room to open.',
  };
}

/**
 * Clear floor just inside the door.
 *
 * Applies whichever way the door swings, including outward and sliding: you
 * still have to stand somewhere while you open it and walk through.
 */
export function doorLandingZone(wall: Wall, feature: Feature): Zone | null {
  if (feature.door === undefined) return null;

  const widened: Feature = {
    ...feature,
    offset: feature.offset - DOOR_LANDING_MARGIN,
    width: feature.width + DOOR_LANDING_MARGIN * 2,
  };

  return {
    featureId: feature.id,
    kind: 'landing',
    share: 'shareable',
    minHeight: 0,
    bounds: featureRect(wall, widened, DOOR_LANDING_DEPTH),
    reason: 'You need somewhere to stand as you come through the door.',
  };
}

/**
 * The wall a sliding or bifold leaf travels across.
 *
 * Without this, nothing stops a wardrobe being placed exactly where the leaf
 * slides — a layout that looks perfectly legal on the plan and cannot be used.
 * The track runs beside the opening, on the hinge side, for one leaf width.
 */
export function slideTrackZone(wall: Wall, feature: Feature): Zone | null {
  const spec = feature.door;
  if (spec === undefined || (spec.swing !== 'slide' && spec.swing !== 'bifold')) return null;

  const trackOffset =
    spec.hinge === 'start' ? feature.offset - spec.leafWidth : feature.offset + feature.width;

  const track: Feature = { ...feature, offset: trackOffset, width: spec.leafWidth };

  return {
    featureId: feature.id,
    kind: 'slide-track',
    share: 'shareable',
    minHeight: 0,
    bounds: featureRect(wall, track, SLIDE_TRACK_DEPTH),
    reason: 'The sliding leaf travels across this piece of wall.',
  };
}

// ── Windows ───────────────────────────────────────────────────────────────

/**
 * Reach-the-handle space in front of an operable window.
 *
 * `minHeight` is the load-bearing part: it is `sill − 50`, not 0. A 750 mm desk
 * under an 850 mm sill sits happily inside this zone; a wardrobe does not.
 * Setting it to 0 would forbid furniture under every window in the room and
 * throw away the wall people most want to put a desk against.
 */
export function windowOperateZone(wall: Wall, feature: Feature): Zone | null {
  if (feature.kind !== 'window') return null;
  const sill = feature.sillHeight ?? TYPICAL_SILL;

  return {
    featureId: feature.id,
    kind: 'operate',
    share: 'shareable',
    minHeight: Math.max(sill - SILL_HEADROOM, 0),
    bounds: featureRect(wall, feature, WINDOW_OPERATE_DEPTH),
    reason: 'You need to be able to reach the window to open it.',
  };
}

/**
 * Clear floor in front of an escape window.
 *
 * Exclusive, and deeper than the operating zone. Surfaced as a loud, cited
 * warning rather than a hard rejection — a tool that refuses to help the person
 * with the most awkward room has the priorities backwards.
 */
export function egressZone(wall: Wall, feature: Feature, roomIsSleeping: boolean): Zone | null {
  if (!isEgressWindow(feature, roomIsSleeping)) return null;
  const sill = feature.sillHeight ?? TYPICAL_SILL;

  return {
    featureId: feature.id,
    kind: 'egress',
    share: 'exclusive',
    minHeight: Math.max(sill - SILL_HEADROOM, 0),
    bounds: featureRect(wall, feature, EGRESS_DEPTH),
    reason: 'This window is low enough to be an escape route, so it has to stay reachable.',
  };
}

/** Breathing room in front of a radiator, so it isn't boxed in. */
export function radiatorZone(wall: Wall, feature: Feature): Zone | null {
  if (feature.kind !== 'radiator') return null;

  return {
    featureId: feature.id,
    kind: 'thermal',
    share: 'soft',
    minHeight: 0,
    bounds: featureRect(wall, feature, RADIATOR_CLEAR),
    reason: 'A radiator boxed in by furniture heats the furniture.',
  };
}

/** The floor a protruding fixture actually stands on. */
export function fixtureFootprint(wall: Wall, feature: Feature): Rect | null {
  if (!feature.blocksFloor) return null;
  return featureRect(wall, feature, feature.projection ?? 0);
}

// ── All of them ───────────────────────────────────────────────────────────

/** Every zone a feature generates, in a stable order. */
export function featureZones(wall: Wall, feature: Feature, roomIsSleeping: boolean): Zone[] {
  return [
    doorSwingZone(wall, feature),
    doorLandingZone(wall, feature),
    slideTrackZone(wall, feature),
    windowOperateZone(wall, feature),
    egressZone(wall, feature, roomIsSleeping),
    radiatorZone(wall, feature),
  ].filter((z): z is Zone => z !== null);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Wrap into (−180, 180]. */
function normalizeSigned(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * Bounding box of a circular sector.
 *
 * Not the naive "box of the two endpoints": a sector spanning due-east has its
 * rightmost point at the arc, not at either end of it. Each axis extreme is
 * included only when its angle actually falls inside the sweep.
 */
export function sectorBounds(center: Vec, radius: Mm, fromDeg: number, toDeg: number): Rect {
  const lo = Math.min(fromDeg, toDeg);
  const hi = Math.max(fromDeg, toDeg);

  const points: Vec[] = [
    center,
    pointAt(center, radius, lo),
    pointAt(center, radius, hi),
    ...[0, 90, 180, 270].flatMap((axis) => {
      /* Check every co-terminal copy of the axis angle, since the sweep may
         straddle the ±180 wrap. */
      for (let turn = -720; turn <= 720; turn += 360) {
        if (axis + turn >= lo && axis + turn <= hi) return [pointAt(center, radius, axis)];
      }
      return [];
    }),
  ];

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));

  return { x, y, w: Math.ceil(Math.max(...xs)) - x, d: Math.ceil(Math.max(...ys)) - y };
}

function pointAt(center: Vec, radius: Mm, deg: number): Vec {
  const rad = (deg * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
}

/** Is a point inside a sector? Used to rasterize a swing exactly. */
export function sectorContains(
  sector: { center: Vec; radius: Mm; fromDeg: number; toDeg: number },
  p: Vec,
): boolean {
  const dx = p.x - sector.center.x;
  const dy = p.y - sector.center.y;
  if (dx * dx + dy * dy > sector.radius * sector.radius) return false;

  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  for (let turn = -720; turn <= 720; turn += 360) {
    if (deg + turn >= sector.fromDeg && deg + turn <= sector.toDeg) return true;
  }
  return false;
}
