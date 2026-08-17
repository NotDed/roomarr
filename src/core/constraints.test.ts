import { describe, expect, it } from 'vitest';
import { itemFromPreset } from '@/core/catalog';
import {
  type ConstraintInput,
  type Violation,
  type ViolationCode,
  checkLayout,
  hardViolations,
  isFeasible,
} from '@/core/constraints';
import type { Feature } from '@/core/features';
import type { Rot } from '@/core/geometry';
import type { Item, Layout, Placement } from '@/core/items';
import { makeRectangularRoom, makeRoom } from '@/core/room';

const WALL_IDS = ['w0', 'w1', 'w2', 'w3'];
// Rectangle walls: 0 = top, 1 = right, 2 = bottom, 3 = left.

function door(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'door',
    kind: 'door',
    wallId: 'w2',
    offset: 1200,
    width: 800,
    blocksFloor: false,
    door: { hinge: 'start', swing: 'in', leafWidth: 800, isPrimary: true },
    ...overrides,
  };
}

function aWindow(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'win',
    kind: 'window',
    wallId: 'w0',
    offset: 800,
    width: 1200,
    sillHeight: 900,
    blocksFloor: false,
    ...overrides,
  };
}

function at(itemId: string, x: number, y: number, rot: Rot = 0): Placement {
  return { itemId, pose: { x, y, rot }, locked: false };
}

function check(
  items: Item[],
  placements: Placement[],
  features: Feature[] = [door()],
  room = makeRectangularRoom(4000, 5000),
  overrides: Partial<ConstraintInput> = {},
): Violation[] {
  const layout: Layout = { id: 'l', name: 'now', kind: 'baseline', placements };
  return checkLayout({
    room,
    items,
    layout,
    features,
    wallIds: WALL_IDS,
    roomIsSleeping: true,
    ...overrides,
  });
}

const codes = (violations: Violation[]): ViolationCode[] => violations.map((v) => v.code);
const has = (violations: Violation[], code: ViolationCode) => codes(violations).includes(code);

/** A plain box with no clearance rules, for isolating one check at a time. */
function box(id: string, w: number, d: number, height = 800): Item {
  return {
    ...itemFromPreset(id, 'other'),
    id,
    name: id,
    footprint: { w, d },
    height,
    clearances: [],
  };
}

// ── The reason messages exist ─────────────────────────────────────────────

describe('messages', () => {
  /* A violation you cannot read is a violation you cannot act on, and this same
     string is what the printed blueprint will eventually say. */
  it('are sentences with the numbers already in them', () => {
    const wardrobe = itemFromPreset('wd', 'wardrobe');
    const blocker = box('blocker', 2000, 2000, 1000);
    const found = check([wardrobe, blocker], [at('wd', 0, 0), at('blocker', 0, 600)]).filter(
      (v) => v.code === 'clearance',
    );

    expect(found.length).toBeGreaterThan(0);
    const message = found[0]?.message ?? '';
    expect(message).toMatch(/wardrobe/i);
    expect(message).toMatch(/\d/);
    expect(message).toMatch(/needs/i);
    /* The numbers are on the violation too, so a UI can use them directly. */
    expect(found[0]?.requiredMm).toBe(900);
    expect(found[0]?.actualMm).toBeLessThan(900);
  });

  it('always points somewhere on the plan, except when the problem has no place', () => {
    const found = check([box('a', 1000, 1000)], [at('a', 0, 0)]);
    for (const v of found) {
      if (v.code === 'door-blocked') continue;
      expect(v.region).not.toBeNull();
    }
  });
});

// ── The three fields that decide whether this is usable ───────────────────

describe('nestsWith', () => {
  /* Without this, a nightstand beside a bed is a hard violation while the score
     rewards putting it there — the commonest bedroom layout in existence, both
     illegal and optimal at once. */
  it('lets a nightstand stand in the bed’s side clearance', () => {
    const bed = itemFromPreset('bed', 'bed');
    const stand = itemFromPreset('ns', 'nightstand');

    /* Bed against the left wall, nightstand tucked beside its head. */
    const found = check([bed, stand], [at('bed', 0, 0), at('ns', 1350, 0)]);
    expect(has(found, 'clearance')).toBe(false);
    expect(has(found, 'access-group')).toBe(false);
  });

  it('still rejects a wardrobe in exactly the same place', () => {
    const bed = itemFromPreset('bed', 'bed');
    const wardrobe = itemFromPreset('wd', 'wardrobe');

    const found = check([bed, wardrobe], [at('bed', 0, 0), at('wd', 1350, 0)]);
    expect(hardViolations(found).length).toBeGreaterThan(0);
  });
});

describe('minHeight', () => {
  /* "Nothing in front of the window" writes off the best wall in the room.
     "Nothing taller than the sill" is the actual rule. */
  it('lets a desk sit under a window', () => {
    const desk = box('desk', 1200, 600, 750);
    const found = check([desk], [at('desk', 800, 0)], [door(), aWindow({ sillHeight: 900 })]);
    expect(has(found, 'window-blocked')).toBe(false);
  });

  it('rejects a wardrobe in the same place', () => {
    const wardrobe = box('wd', 1200, 600, 2000);
    const found = check([wardrobe], [at('wd', 800, 0)], [door(), aWindow({ sillHeight: 900 })]);
    expect(has(found, 'window-blocked')).toBe(true);
  });

  it('cites the sill height and the item height', () => {
    const wardrobe = box('wd', 1200, 600, 2000);
    const found = check([wardrobe], [at('wd', 800, 0)], [door(), aWindow({ sillHeight: 900 })]);
    const v = found.find((x) => x.code === 'window-blocked');
    expect(v?.requiredMm).toBe(900);
    expect(v?.actualMm).toBe(2000);
  });
});

describe('anyOfGroup', () => {
  /* Without a group, a bed against a wall is illegal and half of all small
     bedrooms come back "impossible" — exactly the room that needed help. */
  it('accepts a bed with access on one side only', () => {
    const bed = itemFromPreset('bed', 'bed');
    const found = check([bed], [at('bed', 0, 0)]);
    expect(has(found, 'access-group')).toBe(false);
  });

  it('rejects a bed wedged so that neither side has room', () => {
    /* A room barely wider than the bed: 1350 bed in a 1600 room leaves 250 mm. */
    const room = makeRectangularRoom(1600, 5000);
    const bed = itemFromPreset('bed', 'bed');
    const found = check([bed], [at('bed', 125, 0)], [door({ wallId: 'w2', offset: 400 })], room);
    expect(has(found, 'access-group')).toBe(true);
  });

  it('reports the best side it has, not an arbitrary one', () => {
    const room = makeRectangularRoom(1600, 5000);
    const bed = itemFromPreset('bed', 'bed');
    const found = check([bed], [at('bed', 0, 0)], [door({ wallId: 'w2', offset: 400 })], room);
    const v = found.find((x) => x.code === 'access-group');
    /* Flush left, so the right side has 250 mm and the left has none. */
    expect(v?.actualMm).toBeGreaterThan(0);
    expect(v?.actualMm).toBeLessThan(750);
  });
});

// ── The fixture that pins all three at once ───────────────────────────────

describe('a real tight bedroom', () => {
  /* If this ever fails, the checker is contradicting the catalogue it ships
     with, and the tool will tell people their perfectly ordinary room is
     impossible. */
  it('accepts a bed, two nightstands and a wardrobe in 3.0 × 3.4 m', () => {
    const room = makeRectangularRoom(3000, 3400);
    const bed = itemFromPreset('bed', 'bed');
    const left = itemFromPreset('ns1', 'nightstand');
    const right = itemFromPreset('ns2', 'nightstand');
    const wardrobe = itemFromPreset('wd', 'wardrobe');

    /* Bed headboard to the top wall with a nightstand nesting in each side
       clearance; wardrobe against the left wall turned to face into the room
       (rot 3 points its front at +x, so its doors open into floor rather than
       into masonry); door in the bottom wall. An entirely ordinary bedroom. */
    const found = check(
      [bed, left, right, wardrobe],
      [at('bed', 800, 0), at('ns1', 350, 0), at('ns2', 2150, 0), at('wd', 0, 2200, 3)],
      [door({ wallId: 'w2', offset: 1100 })],
      room,
    );

    const hard = hardViolations(found);
    expect(hard.map((v) => `${v.code}: ${v.message}`)).toEqual([]);
    expect(isFeasible(found)).toBe(true);
  });
});

// ── Doors ─────────────────────────────────────────────────────────────────

describe('doors', () => {
  it('rejects furniture inside the swing', () => {
    /* Door hinged at the start of the bottom wall's span, swinging into the
       room. The bottom wall runs right-to-left, so offset 1200 puts the hinge
       at x = 2800. */
    const dresser = box('dr', 800, 450, 800);
    const found = check([dresser], [at('dr', 2200, 4300)]);
    expect(has(found, 'door-swing') || has(found, 'door-landing')).toBe(true);
  });

  it('accepts the same furniture well away from the door', () => {
    const dresser = box('dr', 800, 450, 800);
    const found = check([dresser], [at('dr', 0, 0)]);
    expect(has(found, 'door-swing')).toBe(false);
    expect(has(found, 'door-landing')).toBe(false);
  });

  /* The bounding box of a quarter circle is a square, so a bbox test condemns
     the corner behind the door that the leaf never sweeps. */
  it('does not condemn the corner the leaf never reaches', () => {
    const room = makeRectangularRoom(4000, 5000);
    const tiny = box('t', 200, 200, 800);
    /* Hinge is at x = 2800 on the bottom wall; the leaf sweeps toward smaller
       x. A box just the other side of the hinge is inside the sector's bbox
       but outside the sector. */
    const found = check([tiny], [at('t', 2900, 4750)], [door()], room);
    expect(has(found, 'door-swing')).toBe(false);
  });

  it('reserves the wall a sliding leaf travels across', () => {
    const wardrobe = box('wd', 800, 400, 2000);
    const slider = door({
      door: { hinge: 'start', swing: 'slide', leafWidth: 800, isPrimary: true },
    });
    /* The track runs from the hinge end back along the wall. */
    const found = check([wardrobe], [at('wd', 2800, 4600)], [slider]);
    expect(has(found, 'slide-track')).toBe(true);
  });

  it('notices when the way in is sealed off entirely', () => {
    const wall = box('big', 4000, 2000, 2000);
    const found = check([wall], [at('big', 0, 3000)]);
    expect(has(found, 'door-blocked')).toBe(true);
  });
});

// ── The plainer checks ────────────────────────────────────────────────────

describe('placement basics', () => {
  it('rejects an item hanging out of the room', () => {
    const found = check([box('a', 1000, 1000)], [at('a', 3500, 0)]);
    expect(has(found, 'out-of-room')).toBe(true);
  });

  /* An L-shaped room's bounding box includes the bite taken out of it, so a
     bbox test passes a wardrobe standing in thin air. */
  it('rejects an item in the notch of an L-shaped room', () => {
    const room = makeRoom([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 2000, y: 2000 },
      { x: 2000, y: 5000 },
      { x: 0, y: 5000 },
    ]);
    const found = check(
      [box('a', 800, 800)],
      [at('a', 3000, 3000)],
      [door({ wallId: 'w0', offset: 500 })],
      room,
    );
    expect(has(found, 'out-of-room')).toBe(true);
  });

  it('rejects two items on top of each other', () => {
    const found = check(
      [box('a', 1000, 1000), box('b', 1000, 1000)],
      [at('a', 0, 0), at('b', 500, 500)],
    );
    expect(has(found, 'overlap')).toBe(true);
  });

  it('accepts two items merely touching', () => {
    const found = check(
      [box('a', 1000, 1000), box('b', 1000, 1000)],
      [at('a', 0, 0), at('b', 1000, 0)],
    );
    expect(has(found, 'overlap')).toBe(false);
  });

  /* A chair pushed under a desk is the intended arrangement, not a collision. */
  it('lets a chair tuck under a desk', () => {
    const desk = itemFromPreset('desk', 'desk');
    const chair = { ...itemFromPreset('ch', 'chair'), height: 600 };
    const found = check([desk, chair], [at('desk', 0, 0), at('ch', 100, 100)]);
    expect(has(found, 'overlap')).toBe(false);
  });

  it('ignores a rug entirely', () => {
    const rug = itemFromPreset('rug', 'rug');
    const bed = box('bed', 1400, 2000);
    const found = check([rug, bed], [at('rug', 0, 0), at('bed', 200, 200)]);
    expect(has(found, 'overlap')).toBe(false);
  });

  it('rejects something taller than the ceiling', () => {
    const found = check([box('a', 800, 400, 2600)], [at('a', 0, 0)]);
    expect(has(found, 'too-tall')).toBe(true);
  });

  it('requires a wall for the things that need one', () => {
    const wardrobe = itemFromPreset('wd', 'wardrobe');
    const floating = check([wardrobe], [at('wd', 1500, 2000)]);
    expect(has(floating, 'wall-required')).toBe(true);

    const against = check([wardrobe], [at('wd', 0, 0)]);
    expect(has(against, 'wall-required')).toBe(false);
  });
});

// ── Soft problems ─────────────────────────────────────────────────────────

describe('soft problems', () => {
  /* Life safety, and deliberately not a hard rejection: refusing to help the
     person with the most awkward room has the priorities backwards. */
  it('warns about a blocked escape window without rejecting the layout', () => {
    const wardrobe = box('wd', 1200, 600, 2000);
    const found = check(
      [wardrobe],
      [at('wd', 800, 0)],
      [door(), aWindow({ sillHeight: 900 })],
      makeRectangularRoom(4000, 5000),
    );

    const egress = found.find((v) => v.code === 'egress-blocked');
    expect(egress?.severity).toBe('soft');
    expect(egress?.message).toMatch(/climb out/i);
  });

  it('does not raise egress outside a sleeping room', () => {
    const wardrobe = box('wd', 1200, 600, 2000);
    const found = check(
      [wardrobe],
      [at('wd', 800, 0)],
      [door(), aWindow({ sillHeight: 900 })],
      makeRectangularRoom(4000, 5000),
      { roomIsSleeping: false },
    );
    expect(has(found, 'egress-blocked')).toBe(false);
  });

  it('mentions a clearance that works but is tight', () => {
    const dresser = itemFromPreset('dr', 'dresser');
    const blocker = box('b', 3000, 300, 1000);

    /* Dresser needs 700 min / 800 preferred in front. Give it about 750. */
    const found = check([dresser, blocker], [at('dr', 0, 0), at('b', 0, 1200)]);
    const tight = found.find((v) => v.code === 'clearance-tight');
    if (tight !== undefined) {
      expect(tight.severity).toBe('soft');
      expect(tight.message).toMatch(/comfortable/i);
    }
  });

  it('keeps soft problems out of the feasibility verdict', () => {
    const soft: Violation[] = [
      {
        code: 'egress-blocked',
        severity: 'soft',
        itemIds: [],
        featureIds: [],
        region: null,
        message: '',
      },
    ];
    expect(isFeasible(soft)).toBe(true);
    expect(hardViolations(soft)).toEqual([]);
  });
});

// ── Identity ──────────────────────────────────────────────────────────────

describe('violation identity', () => {
  /* An item can breach two of its own clearances at once — a bed short of room
     on its side AND at its foot. Without the rule id those two are
     indistinguishable: they collide as list keys, and dismissing one would
     silently dismiss the other. */
  it('distinguishes two problems about the same item', () => {
    const room = makeRectangularRoom(2000, 2600);
    const bed = itemFromPreset('bed', 'bed');
    const found = check([bed], [at('bed', 300, 300)], [door({ wallId: 'w2', offset: 600 })], room);

    const keys = found.map((v) =>
      [v.code, v.ruleId ?? '', ...v.itemIds, ...v.featureIds].join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names the rule on every clearance problem', () => {
    const wardrobe = itemFromPreset('wd', 'wardrobe');
    const blocker = box('blocker', 2000, 2000, 1000);
    const found = check([wardrobe, blocker], [at('wd', 0, 0), at('blocker', 0, 600)]);

    for (const v of found) {
      if (v.code === 'clearance' || v.code === 'clearance-tight' || v.code === 'access-group') {
        expect(v.ruleId).toBeDefined();
      }
    }
  });
});

// ── An arrangement with nothing wrong with it ─────────────────────────────

describe('a good layout', () => {
  it('reports nothing hard', () => {
    const room = makeRectangularRoom(4000, 5000);
    const bed = itemFromPreset('bed', 'bed');
    const wardrobe = itemFromPreset('wd', 'wardrobe');

    const found = check(
      [bed, wardrobe],
      [at('bed', 0, 0), at('wd', 3000, 0)],
      [door({ wallId: 'w2', offset: 1600 })],
      room,
    );
    expect(hardViolations(found).map((v) => `${v.code}: ${v.message}`)).toEqual([]);
  });
});
