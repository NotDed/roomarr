import { type Feature, TYPICAL_SILL, isEgressWindow, wallsById } from '@/core/features';
import { type Rect, rectOverlapArea, rectsOverlap } from '@/core/geometry';
import {
  type ClearanceRule,
  type Item,
  type Layout,
  type Placement,
  clearanceRect,
  itemRect,
  placedItems,
  sideDirection,
} from '@/core/items';
import { type Zone, featureZones, sectorContains } from '@/core/openings';
import { type Room, distanceToNearestWall, rectInsideRoom, roomWalls } from '@/core/room';
import { type DisplayUnit, type Mm, formatLength } from '@/core/units';
import { BODY_RADII, type WalkableResult, computeWalkable } from '@/core/walkable';
import type { WallId } from '@/core/wallrun';

/**
 * What is wrong with an arrangement, in sentences a person can act on.
 *
 * Every violation carries the numbers that produced it and a message that is
 * already readable — "The wardrobe has 400 mm in front of it, and its doors
 * need 900 mm" — rather than a code the UI has to translate. A violation you
 * cannot read is a violation you cannot act on, and the same string is what the
 * printed blueprint will eventually say.
 *
 * ── The three fields that decide whether this is usable ──────────────────
 *
 * `ClearanceRule` carries `share`, `minHeight` and `nestsWith`, and the
 * catalogue sets all three. A checker that ignores them contradicts its own
 * data and reports most real rooms as impossible:
 *
 * - **share** — one corridor legitimately serves the bed side, the wardrobe
 *   front and the door landing at the same time. Zones overlapping each other
 *   is normal and desirable; a zone overlapping a *solid* is the violation.
 * - **minHeight** — the rule is never "nothing in front of the window", it is
 *   "nothing taller than the sill". A 750 mm desk under an 850 mm sill is a
 *   good use of the best wall in the room.
 * - **nestsWith** — a nightstand inside the bed's side clearance is the
 *   intended arrangement. Forbidding it while the score rewards it would make
 *   the commonest bedroom layout simultaneously illegal and optimal.
 */

export type ViolationCode =
  | 'out-of-room'
  | 'overlap'
  | 'door-swing'
  | 'door-landing'
  | 'slide-track'
  | 'door-blocked'
  | 'clearance'
  | 'access-group'
  | 'wall-required'
  | 'window-blocked'
  | 'too-tall'
  | 'clearance-tight'
  | 'radiator-boxed'
  | 'egress-blocked';

export type Severity = 'hard' | 'soft';

export interface Violation {
  code: ViolationCode;
  severity: Severity;
  itemIds: string[];
  featureIds: string[];
  requiredMm?: Mm;
  actualMm?: Mm;
  /**
   * Which clearance rule this is about, when it is about one.
   *
   * Needed for identity: an item can breach two of its own clearances at once
   * (a bed short of room on its side *and* at its foot), and without this the
   * two are indistinguishable — they collide as list keys, and dismissing one
   * would silently dismiss the other.
   */
  ruleId?: string;
  /** Where to point on the plan. Null when the problem is not about a place. */
  region: Rect | null;
  /** Already a sentence, with the numbers in it. */
  message: string;
}

export interface ConstraintInput {
  room: Room;
  items: readonly Item[];
  layout: Layout;
  features: readonly Feature[];
  wallIds: readonly WallId[];
  roomIsSleeping: boolean;
  /** For the numbers inside messages. Storage stays millimetres regardless. */
  unit?: DisplayUnit;
  /**
   * An already-computed walkability result for this same layout.
   *
   * Only "is the door reachable" needs it, and the caller usually has one
   * already — scoring a layout computed it a moment ago. Recomputing was
   * doubling the cost of every evaluation the search makes, which is the
   * difference between a search that runs for a second and one that runs for
   * two.
   */
  walkable?: WalkableResult;
}

/** How close counts as "against the wall". A skirting board is about this. */
export const WALL_TOUCH_TOLERANCE: Mm = 60;

/** Step used when measuring how much clear depth a zone actually has. */
const PROBE_STEP: Mm = 10;

export function checkLayout(input: ConstraintInput): Violation[] {
  const unit = input.unit ?? 'cm';
  const out: Violation[] = [];
  const placed = placedItems(input.items, input.layout);
  const byId = wallsById(roomWalls(input.room), input.wallIds);

  const solids = placed.filter(({ item }) => !item.overlappable);

  const zones: { zone: Zone; feature: Feature }[] = [];
  for (const feature of input.features) {
    const wall = byId.get(feature.wallId);
    if (wall === undefined) continue;
    for (const zone of featureZones(wall, feature, input.roomIsSleeping)) {
      zones.push({ zone, feature });
    }
  }

  const say = (mm: Mm) => `${formatLength(mm, unit)} ${unit}`;

  // ── Each item on its own ───────────────────────────────────────────────

  for (const { item, placement } of placed) {
    const rect = itemRect(item, placement);

    if (!rectInsideRoom(input.room, rect)) {
      out.push({
        code: 'out-of-room',
        severity: 'hard',
        itemIds: [item.id],
        featureIds: [],
        region: rect,
        message: `${item.name} is partly outside the room.`,
      });
    }

    if (item.height > input.room.ceilingHeight) {
      out.push({
        code: 'too-tall',
        severity: 'hard',
        itemIds: [item.id],
        featureIds: [],
        requiredMm: input.room.ceilingHeight,
        actualMm: item.height,
        region: rect,
        message: `${item.name} is ${say(item.height)} tall and the ceiling is ${say(
          input.room.ceilingHeight,
        )}.`,
      });
    }

    if (item.mustTouchWall) {
      const near = distanceToNearestWall(input.room, rect);
      if (near.mm > WALL_TOUCH_TOLERANCE) {
        out.push({
          code: 'wall-required',
          severity: 'hard',
          itemIds: [item.id],
          featureIds: [],
          requiredMm: 0,
          actualMm: near.mm,
          region: rect,
          message: `${item.name} needs to be against a wall — it is ${say(near.mm)} off the nearest one.`,
        });
      }
    }
  }

  // ── Items against each other ───────────────────────────────────────────

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i];
      const b = solids[j];
      if (a === undefined || b === undefined) continue;

      const ra = itemRect(a.item, a.placement);
      const rb = itemRect(b.item, b.placement);
      if (!rectsOverlap(ra, rb)) continue;
      /* A chair pushed under a desk is not a collision. */
      if (tucksUnder(a.item, b.item) || tucksUnder(b.item, a.item)) continue;

      out.push({
        code: 'overlap',
        severity: 'hard',
        itemIds: [a.item.id, b.item.id],
        featureIds: [],
        actualMm: Math.round(Math.sqrt(rectOverlapArea(ra, rb))),
        region: intersection(ra, rb),
        message: `${a.item.name} and ${b.item.name} are on top of each other.`,
      });
    }
  }

  // ── Items against the openings ─────────────────────────────────────────

  for (const { zone, feature } of zones) {
    for (const { item, placement } of solids) {
      /* Height exemption. A door leaf goes to the floor, so its zones set
         minHeight 0; a window's operating zone sets it to just under the sill,
         which is what lets a desk live there. */
      if (item.height <= zone.minHeight) continue;

      const rect = itemRect(item, placement);
      const hits =
        zone.sector === undefined
          ? rectsOverlap(zone.bounds, rect)
          : rectIntersectsSector(rect, zone.sector);
      if (!hits) continue;

      const problem = ZONE_PROBLEMS[zone.kind];
      if (problem === null) continue;

      out.push({
        code: problem.code,
        severity: problem.severity,
        itemIds: [item.id],
        featureIds: [feature.id],
        region: intersection(zone.bounds, rect),
        message: `${item.name} is in the way — ${lowerFirst(zone.reason)}`,
      });
    }
  }

  // ── Is the way in usable at all ────────────────────────────────────────

  const walkable =
    input.walkable ??
    computeWalkable({
      room: input.room,
      items: input.items,
      layout: input.layout,
      features: input.features,
      wallIds: input.wallIds,
      radius: BODY_RADII.comfort,
    });

  if (walkable.infeasible?.code === 'door-blocked') {
    out.push({
      code: 'door-blocked',
      severity: 'hard',
      itemIds: [],
      featureIds: [],
      region: null,
      message: 'Nothing in the room is reachable from the door — something is blocking the way in.',
    });
  }

  // ── Clearances ─────────────────────────────────────────────────────────

  for (const { item, placement } of placed) {
    if (item.clearances.length === 0) continue;

    const others = solids.filter((s) => s.item.id !== item.id);
    const results = item.clearances.map((rule) => ({
      rule,
      ...measureClearance(input.room, item, placement, rule, others),
    }));

    /* Grouped rules are satisfied by any one member. Without this a single bed
       against a wall is illegal, and half of all small bedrooms come back
       "impossible" — which is exactly the room that needed the help. */
    const groups = new Map<string, typeof results>();
    for (const r of results) {
      if (r.rule.anyOfGroup === undefined) continue;
      const list = groups.get(r.rule.anyOfGroup) ?? [];
      list.push(r);
      groups.set(r.rule.anyOfGroup, list);
    }

    for (const r of results) {
      if (r.rule.anyOfGroup !== undefined) continue;
      if (r.available >= r.rule.depth) {
        pushIfTight(out, item, r.rule, r.available, r.region, say);
        continue;
      }
      out.push({
        code: 'clearance',
        severity: 'hard',
        itemIds: [item.id, ...r.blockedBy],
        featureIds: [],
        requiredMm: r.rule.depth,
        actualMm: r.available,
        ruleId: r.rule.id,
        region: r.region,
        message: `${item.name} has ${say(r.available)} ${sideWord(r.rule.side)} and needs ${say(
          r.rule.depth,
        )}. ${r.rule.reason}`,
      });
    }

    for (const members of groups.values()) {
      const best = members.reduce((a, b) => (a.available >= b.available ? a : b));
      if (best.available >= best.rule.depth) {
        pushIfTight(out, item, best.rule, best.available, best.region, say);
        continue;
      }

      out.push({
        code: 'access-group',
        severity: 'hard',
        itemIds: [item.id, ...best.blockedBy],
        featureIds: [],
        requiredMm: best.rule.depth,
        actualMm: best.available,
        ruleId: best.rule.anyOfGroup ?? best.rule.id,
        region: best.region,
        message: `${item.name} needs ${say(best.rule.depth)} on at least one side — the best it has is ${say(
          best.available,
        )}. ${best.rule.reason}`,
      });
    }
  }

  // ── Windows ────────────────────────────────────────────────────────────

  for (const feature of input.features) {
    if (feature.kind !== 'window') continue;
    const wall = byId.get(feature.wallId);
    if (wall === undefined) continue;

    const sill = feature.sillHeight ?? TYPICAL_SILL;
    const band = featureZones(wall, feature, input.roomIsSleeping).find(
      (z) => z.kind === 'operate',
    );
    if (band === undefined) continue;

    for (const { item, placement } of solids) {
      if (item.height <= sill) continue;
      const rect = itemRect(item, placement);
      if (!rectsOverlap(band.bounds, rect)) continue;

      out.push({
        code: 'window-blocked',
        severity: 'hard',
        itemIds: [item.id],
        featureIds: [feature.id],
        requiredMm: sill,
        actualMm: item.height,
        region: intersection(band.bounds, rect),
        message: `${item.name} is ${say(item.height)} tall and stands in front of a window whose sill is at ${say(
          sill,
        )}.`,
      });
    }

    /* Life safety, and deliberately not a hard rejection: a tool that refuses
       to help the person with the most awkward room has the priorities
       backwards. Cited, loud, and dismissible. */
    if (isEgressWindow(feature, input.roomIsSleeping)) {
      const egress = featureZones(wall, feature, input.roomIsSleeping).find(
        (z) => z.kind === 'egress',
      );
      if (egress !== undefined) {
        for (const { item, placement } of solids) {
          if (item.height <= egress.minHeight) continue;
          const rect = itemRect(item, placement);
          if (!rectsOverlap(egress.bounds, rect)) continue;

          out.push({
            code: 'egress-blocked',
            severity: 'soft',
            itemIds: [item.id],
            featureIds: [feature.id],
            region: intersection(egress.bounds, rect),
            message: `${item.name} blocks a window low enough to climb out of (sill at ${say(
              sill,
            )}). Worth keeping clear if this is a bedroom.`,
          });
        }
      }
    }
  }

  return out;
}

/** Just the hard ones — what a search must reject rather than merely dislike. */
export function hardViolations(violations: readonly Violation[]): Violation[] {
  return violations.filter((v) => v.severity === 'hard');
}

export function isFeasible(violations: readonly Violation[]): boolean {
  return !violations.some((v) => v.severity === 'hard');
}

// ── Helpers ───────────────────────────────────────────────────────────────

const ZONE_PROBLEMS: Record<Zone['kind'], { code: ViolationCode; severity: Severity } | null> = {
  swing: { code: 'door-swing', severity: 'hard' },
  landing: { code: 'door-landing', severity: 'hard' },
  'slide-track': { code: 'slide-track', severity: 'hard' },
  /* Windows and radiators are handled separately, with their own wording. */
  operate: null,
  egress: null,
  thermal: { code: 'radiator-boxed', severity: 'soft' },
};

/** A chair under a desk, a stool under a table. Not a collision. */
function tucksUnder(under: Item, over: Item): boolean {
  return over.overhangFloor && under.height <= (over.clearHeightUnder ?? 0);
}

function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    d: Math.max(0, Math.min(a.y + a.d, b.y + b.d) - y),
  };
}

function sideWord(side: ClearanceRule['side']): string {
  switch (side) {
    case 'front':
      return 'in front of it';
    case 'back':
      return 'behind it';
    case 'left':
      return 'on its left';
    case 'right':
      return 'on its right';
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function pushIfTight(
  out: Violation[],
  item: Item,
  rule: ClearanceRule,
  available: Mm,
  region: Rect,
  say: (mm: Mm) => string,
): void {
  const preferred = rule.preferred;
  if (preferred === undefined || available >= preferred) return;

  out.push({
    code: 'clearance-tight',
    severity: 'soft',
    itemIds: [item.id],
    featureIds: [],
    requiredMm: preferred,
    actualMm: available,
    ruleId: rule.id,
    region,
    message: `${item.name} has ${say(available)} ${sideWord(rule.side)}. It works, but ${say(
      preferred,
    )} would be comfortable.`,
  });
}

/**
 * How much clear depth a clearance rule actually has.
 *
 * Probed rather than computed in closed form, because "clear" means three
 * different things at once: inside the room, not overlapping a solid taller
 * than `minHeight`, and — for a rule that permits nesting — leaving enough
 * width beside the nested item to still walk through.
 *
 * Returns the depth available, which is what makes the message specific: not
 * "the wardrobe does not have enough room" but "it has 400 mm and needs 900".
 */
function measureClearance(
  room: Room,
  item: Item,
  placement: Placement,
  rule: ClearanceRule,
  others: readonly { item: Item; placement: Placement }[],
): { available: Mm; region: Rect; blockedBy: string[] } {
  const full = clearanceRect(item, placement, rule);
  const dir = sideDirection(rule.side, placement.pose.rot);
  const base = itemRect(item, placement);
  const blockedBy = new Set<string>();

  const nests = new Set(rule.nestsWith ?? []);
  const minCirculation = rule.minCirculation ?? 0;

  const slabAt = (depth: Mm): Rect => {
    if (dir.x === 1) return { x: base.x + base.w, y: base.y, w: depth, d: base.d };
    if (dir.x === -1) return { x: base.x - depth, y: base.y, w: depth, d: base.d };
    if (dir.y === 1) return { x: base.x, y: base.y + base.d, w: base.w, d: depth };
    return { x: base.x, y: base.y - depth, w: base.w, d: depth };
  };

  let available = 0;
  for (let depth = PROBE_STEP; depth <= rule.depth; depth += PROBE_STEP) {
    const slab = slabAt(depth);
    if (!rectInsideRoom(room, slab)) break;

    let clear = true;
    for (const other of others) {
      if (other.item.height <= rule.minHeight) continue;
      const rect = itemRect(other.item, other.placement);
      if (!rectsOverlap(slab, rect)) continue;

      /* A nightstand may stand in the bed's side clearance, provided enough of
         the width is still open to get past it. */
      if (nests.has(other.item.type) && residualWidth(slab, rect, dir) >= minCirculation) {
        continue;
      }

      blockedBy.add(other.item.id);
      clear = false;
      break;
    }

    if (!clear) break;
    available = depth;
  }

  return { available, region: full, blockedBy: [...blockedBy] };
}

/** Width still open across a slab once `blocker` occupies part of it. */
function residualWidth(slab: Rect, blocker: Rect, dir: { x: number; y: number }): Mm {
  /* The slab's "width" runs across its depth axis. */
  if (dir.x !== 0) {
    const top = Math.max(slab.y, blocker.y) - slab.y;
    const bottom = slab.y + slab.d - Math.min(slab.y + slab.d, blocker.y + blocker.d);
    return Math.max(top, bottom);
  }
  const left = Math.max(slab.x, blocker.x) - slab.x;
  const right = slab.x + slab.w - Math.min(slab.x + slab.w, blocker.x + blocker.w);
  return Math.max(left, right);
}

/**
 * Does a rectangle reach into a door's swept sector?
 *
 * Sampled rather than solved. The bounding box alone over-reports badly — it
 * is a square around a quarter circle, so it would condemn furniture in the
 * corner behind the door that the leaf never reaches. Sampling at a step finer
 * than any real piece of furniture is close enough, and this is the same test
 * the search will later use to prune poses, so it stays cheap on purpose.
 */
export function rectIntersectsSector(
  rect: Rect,
  sector: { center: { x: number; y: number }; radius: Mm; fromDeg: number; toDeg: number },
  step: Mm = 50,
): boolean {
  const x0 = Math.max(rect.x, sector.center.x - sector.radius);
  const x1 = Math.min(rect.x + rect.w, sector.center.x + sector.radius);
  const y0 = Math.max(rect.y, sector.center.y - sector.radius);
  const y1 = Math.min(rect.y + rect.d, sector.center.y + sector.radius);
  if (x0 > x1 || y0 > y1) return false;

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (sectorContains(sector, { x, y })) return true;
    }
    /* Always test the far edge, so a thin item is never stepped over. */
    if (sectorContains(sector, { x: x1, y })) return true;
  }
  for (let x = x0; x <= x1; x += step) {
    if (sectorContains(sector, { x, y: y1 })) return true;
  }
  return sectorContains(sector, { x: x1, y: y1 });
}
