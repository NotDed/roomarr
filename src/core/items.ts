import {
  type Pose,
  type Rect,
  type Rot,
  type Size,
  neg,
  poseRect,
  rotatedSize,
} from '@/core/geometry';
import type { Mm } from '@/core/units';

/**
 * Furniture, and the space each piece needs around it to be usable.
 *
 * The clearance model here is where most layout tools go wrong, in three
 * specific ways that each make the tool useless in a different direction:
 *
 * 1. **Treating every clearance as exclusive.** One corridor legitimately
 *    serves the bed side, the wardrobe front and the door landing at once.
 *    Insisting they be disjoint reports most real bedrooms as impossible.
 * 2. **Ignoring height.** "Nothing in front of the window" writes off the best
 *    wall in the room; "nothing *taller than the sill*" is the real rule.
 * 3. **Forbidding things that nest.** A nightstand sits inside the bed's side
 *    clearance by design. A rule that forbids it while the scoring function
 *    rewards it makes every bedroom simultaneously illegal and optimal.
 */

// ── Sides ─────────────────────────────────────────────────────────────────

/**
 * A face of an item, in its own frame.
 *
 * At rotation 0 an item occupies `[0,w] × [0,d]`, and — following the y-down
 * convention used everywhere — **`back` is the −y edge and `front` is +y**. So
 * an item authored at rotation 0 has its back against a wall at the top of the
 * plan and faces down into the room.
 *
 * Sides are local rather than absolute so that a wardrobe's "the doors are on
 * this face" survives being rotated onto a different wall. There is no separate
 * `frontFace` field: the item is authored facing +y, and rotation does the rest.
 */
export type Side = 'front' | 'back' | 'left' | 'right';

const SIDE_VECTORS: Readonly<Record<Side, { x: -1 | 0 | 1; y: -1 | 0 | 1 }>> = {
  back: { x: 0, y: -1 },
  front: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** The world direction a local side points after `rot` quarter turns. */
export function sideDirection(side: Side, rot: Rot): { x: number; y: number } {
  let v: { x: number; y: number } = SIDE_VECTORS[side];
  /* A clockwise quarter turn in y-down coordinates is (x, y) → (−y, x).
     `neg` rather than a bare minus: negating a zero component gives −0, which
     hashes differently from 0 and does not survive a JSON round trip. */
  for (let i = 0; i < rot; i++) v = { x: neg(v.y), y: v.x };
  return v;
}

// ── Clearance ─────────────────────────────────────────────────────────────

export type ClearanceKind = 'access' | 'operate' | 'activity';

/**
 * How much a clearance may be shared.
 *
 * `shareable` — a walkway may pass through and other clearances may overlap it,
 *   but no solid item may stand in it. This is the right default for almost
 *   everything.
 * `exclusive` — nothing at all, not even another clearance.
 * `soft` — overlap is allowed and merely penalised.
 */
export type Share = 'exclusive' | 'shareable' | 'soft';

export interface ClearanceRule {
  id: string;
  side: Side;
  /** How deep the clear space has to be. The number people actually argue about. */
  depth: Mm;
  /** Comfortable depth. Scoring ramps between `depth` and this. */
  preferred?: Mm;
  kind: ClearanceKind;
  share: Share;
  /**
   * Items **shorter** than this may intrude.
   *
   * 0 for a wardrobe door — the leaf goes to the floor and there is no
   * exemption. `sill − 50` for a window, which is what makes a desk under a
   * window a good layout rather than a violation.
   */
  minHeight: Mm;
  /**
   * Satisfying any one rule in the group is enough.
   *
   * A bed with one sleeper needs access on the left **or** the right, not both.
   * Without this, a single bed pushed against a wall is illegal and half of all
   * small bedrooms come back "impossible" — which is exactly the room that
   * needed the help.
   */
  anyOfGroup?: string;
  /**
   * Item types that may sit inside this zone anyway, provided they leave
   * `minCirculation` of the width still clear.
   *
   * A nightstand inside the bed's side clearance is not a violation, it is the
   * intended arrangement. Without this the constraint set contradicts the
   * scoring function on the most common bedroom layout there is.
   */
  nestsWith?: ItemType[];
  minCirculation?: Mm;
  /** Printed verbatim in the violations list and on the blueprint. */
  reason: string;
}

// ── Items ─────────────────────────────────────────────────────────────────

export type ItemType =
  | 'bed'
  | 'wardrobe'
  | 'dresser'
  | 'nightstand'
  | 'desk'
  | 'chair'
  | 'sofa'
  | 'armchair'
  | 'coffee-table'
  | 'dining-table'
  | 'bookcase'
  | 'tv-stand'
  | 'rug'
  | 'other';

/** How hard the thing is to move, which drives the move plan's ordering and prose. */
export type MoveClass = 'lift' | 'slide' | 'heavy';

export interface Item {
  id: string;
  /** User-editable, and printed exactly as typed on the blueprint. */
  name: string;
  type: ItemType;
  /** Extent at rotation 0. `w` is local x, `d` is local y. */
  footprint: Size;
  height: Mm;

  clearances: ClearanceRule[];

  /** Must sit against a wall — a wardrobe, a headboard, a bookcase. */
  mustTouchWall: boolean;
  /** Prefers a wall but does not require one. Seeds wall-flush candidates. */
  prefersWall: boolean;
  /** May float in the middle of the room. False for almost everything. */
  allowFloat: boolean;
  /**
   * Excluded from the walking-obstacle set entirely. A rug is floor.
   * Its position therefore cannot change the walkable figure, which is asserted
   * as a golden test rather than left as an assumption.
   */
  overlappable: boolean;

  /**
   * Has usable floor beneath it that is nonetheless not standable — a desk
   * kneehole, a loft bed. Subtracted from standable floor, not from free floor.
   */
  overhangFloor: boolean;
  clearHeightUnder?: Mm;

  moveClass: MoveClass;
  /** Has to be emptied before it can be moved. Adds a step to the move plan. */
  needsUnloading: boolean;
  needsPower: boolean;

  /** Beds only. Decides whether side access is needed on one side or both. */
  occupants?: 1 | 2;
  notes?: string;
}

// ── Placement ─────────────────────────────────────────────────────────────

export interface Placement {
  itemId: string;
  pose: Pose;
  /**
   * Pinned by the user: "that stays where it is". The optimizer must respect it
   * even when moving it would score better — this is the escape hatch that
   * turns disagreement into a better answer instead of an abandoned session.
   */
  locked: boolean;
}

/**
 * One arrangement of the items.
 *
 * Kept separate from the item list on purpose: before and after are two layouts
 * over **one** `items[]`, so a move diff is a join on `itemId` and the
 * dimensions can never disagree between them.
 */
export interface Layout {
  id: string;
  name: string;
  kind: 'baseline' | 'proposed' | 'saved';
  placements: Placement[];
}

// ── Geometry ──────────────────────────────────────────────────────────────

/** The floor rectangle an item occupies at a placement. */
export function itemRect(item: Item, placement: Placement): Rect {
  return poseRect(placement.pose, item.footprint);
}

/**
 * The world rectangle one clearance rule reserves.
 *
 * The zone hangs off whichever world side the rule's local side points to after
 * rotation, and spans the item's full extent along the perpendicular axis.
 */
export function clearanceRect(item: Item, placement: Placement, rule: ClearanceRule): Rect {
  const base = itemRect(item, placement);
  const dir = sideDirection(rule.side, placement.pose.rot);

  if (dir.x === 1) return { x: base.x + base.w, y: base.y, w: rule.depth, d: base.d };
  if (dir.x === -1) return { x: base.x - rule.depth, y: base.y, w: rule.depth, d: base.d };
  if (dir.y === 1) return { x: base.x, y: base.y + base.d, w: base.w, d: rule.depth };
  return { x: base.x, y: base.y - rule.depth, w: base.w, d: rule.depth };
}

/** Every clearance rectangle an item reserves, paired with its rule. */
export function itemZones(item: Item, placement: Placement): { rule: ClearanceRule; rect: Rect }[] {
  return item.clearances.map((rule) => ({ rule, rect: clearanceRect(item, placement, rule) }));
}

/** The item's extent at its current rotation. */
export function placedSize(item: Item, placement: Placement): Size {
  return rotatedSize(item.footprint, placement.pose.rot);
}

/**
 * Items that block a person walking.
 *
 * Rugs are excluded because they are floor. Items with `overhangFloor` still
 * block walking through them at floor level — you cannot walk through a desk —
 * but the space under them is separately excluded from *standable* floor, which
 * is a different mask.
 */
export function blocksWalking(item: Item): boolean {
  return !item.overlappable;
}

/** Look up an item by the id a placement refers to. */
export function itemById(items: readonly Item[], id: string): Item | undefined {
  return items.find((i) => i.id === id);
}

/** Placements paired with their items, skipping any that have gone missing. */
export function placedItems(
  items: readonly Item[],
  layout: Layout,
): { item: Item; placement: Placement }[] {
  const out: { item: Item; placement: Placement }[] = [];
  for (const placement of layout.placements) {
    const item = itemById(items, placement.itemId);
    if (item !== undefined) out.push({ item, placement });
  }
  return out;
}
