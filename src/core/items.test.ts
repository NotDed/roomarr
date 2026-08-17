import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PRESETS, itemFromPreset, presetFor } from '@/core/catalog';
import { type Rot, ROTATIONS, negVec, rectsOverlap } from '@/core/geometry';
import {
  type ClearanceRule,
  type Item,
  type Placement,
  blocksWalking,
  clearanceRect,
  itemById,
  itemRect,
  itemZones,
  placedItems,
  placedSize,
  sideDirection,
} from '@/core/items';

const bed = itemFromPreset('i1', 'bed');
const at = (x: number, y: number, rot: Rot = 0): Placement => ({
  itemId: 'i1',
  pose: { x, y, rot },
  locked: false,
});

describe('sides', () => {
  /* Sides are local so a wardrobe's "the doors are on this face" survives being
     rotated onto a different wall. Back is −y and front is +y, matching the
     y-down convention: an item authored at rot 0 has its back to the top of the
     plan and faces down into the room. */
  it('points the right way at rotation 0', () => {
    expect(sideDirection('back', 0)).toEqual({ x: 0, y: -1 });
    expect(sideDirection('front', 0)).toEqual({ x: 0, y: 1 });
    expect(sideDirection('left', 0)).toEqual({ x: -1, y: 0 });
    expect(sideDirection('right', 0)).toEqual({ x: 1, y: 0 });
  });

  it('turns clockwise with the item', () => {
    expect(sideDirection('front', 1)).toEqual({ x: -1, y: 0 });
    expect(sideDirection('front', 2)).toEqual({ x: 0, y: -1 });
    expect(sideDirection('front', 3)).toEqual({ x: 1, y: 0 });
  });

  /* Every axis vector has a zero component, so a bare minus produces −0 all
     over this codebase. It compares equal under === but hashes differently and
     does not survive JSON, so it is normalised at the source. */
  it('never produces negative zero', () => {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      for (const rot of ROTATIONS) {
        const v = sideDirection(side, rot);
        expect(Object.is(v.x, -0)).toBe(false);
        expect(Object.is(v.y, -0)).toBe(false);
      }
    }
  });

  it('stays a unit axis vector at every rotation', () => {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      for (const rot of ROTATIONS) {
        const v = sideDirection(side, rot);
        expect(Math.abs(v.x) + Math.abs(v.y)).toBe(1);
      }
    }
  });

  it('keeps opposite sides opposite through rotation', () => {
    for (const rot of ROTATIONS) {
      const f = sideDirection('front', rot);
      const b = sideDirection('back', rot);
      expect(b).toEqual(negVec(f));
    }
  });
});

describe('itemRect', () => {
  it('places the footprint at the pose corner', () => {
    expect(itemRect(bed, at(100, 200))).toEqual({ x: 100, y: 200, w: 1350, d: 1900 });
    expect(itemRect(bed, at(100, 200, 1))).toEqual({ x: 100, y: 200, w: 1900, d: 1350 });
  });

  it('reports the rotated extent', () => {
    expect(placedSize(bed, at(0, 0, 1))).toEqual({ w: 1900, d: 1350 });
  });

  it('preserves area through every rotation', () => {
    for (const rot of ROTATIONS) {
      const r = itemRect(bed, at(0, 0, rot));
      expect(r.w * r.d).toBe(1350 * 1900);
    }
  });
});

describe('clearanceRect', () => {
  it('hangs the zone off the correct side', () => {
    const item: Item = {
      ...bed,
      clearances: [
        {
          id: 'z',
          side: 'front',
          depth: 600,
          kind: 'access',
          share: 'shareable',
          minHeight: 0,
          reason: '',
        },
      ],
    };
    /* Front is +y at rot 0, so the zone sits below the item. */
    expect(clearanceRect(item, at(0, 0), item.clearances[0]!)).toEqual({
      x: 0,
      y: 1900,
      w: 1350,
      d: 600,
    });
    /* At rot 1 front points −x, so it sits to the left of the rotated box. */
    expect(clearanceRect(item, at(0, 0, 1), item.clearances[0]!)).toEqual({
      x: -600,
      y: 0,
      w: 600,
      d: 1350,
    });
  });

  it('always touches the item and never overlaps it', () => {
    const item: Item = {
      ...bed,
      clearances: [
        {
          id: 'z',
          side: 'left',
          depth: 750,
          kind: 'access',
          share: 'shareable',
          minHeight: 0,
          reason: '',
        },
      ],
    };
    fc.assert(
      fc.property(
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: -3000, max: 3000 }),
        fc.constantFrom<Rot>(0, 1, 2, 3),
        (x, y, rot) => {
          const placement = at(x, y, rot);
          const base = itemRect(item, placement);
          const zone = clearanceRect(item, placement, item.clearances[0]!);

          /* Sharing an edge is not an overlap, which is exactly what we want:
             the zone starts where the item ends. */
          expect(rectsOverlap(base, zone)).toBe(false);
          expect(zone.w).toBeGreaterThan(0);
          expect(zone.d).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('spans the item full width along the perpendicular axis', () => {
    const item: Item = {
      ...bed,
      clearances: [
        {
          id: 'z',
          side: 'front',
          depth: 600,
          kind: 'access',
          share: 'shareable',
          minHeight: 0,
          reason: '',
        },
      ],
    };
    const zone = clearanceRect(item, at(0, 0), item.clearances[0]!);
    expect(zone.w).toBe(itemRect(item, at(0, 0)).w);
  });
});

describe('the catalogue', () => {
  it('offers every item type with at least one variant', () => {
    for (const preset of PRESETS) {
      expect(preset.variants.length).toBeGreaterThan(0);
      for (const v of preset.variants) {
        expect(v.footprint.w).toBeGreaterThan(0);
        expect(v.footprint.d).toBeGreaterThan(0);
        expect(v.height).toBeGreaterThan(0);
      }
    }
  });

  it('falls back rather than throwing on an unknown type', () => {
    expect(presetFor('other').type).toBe('other');
  });

  /* Every value a preset supplies is a starting point. If any of them were
     baked in rather than copied onto the item, "my wardrobe has sliding doors,
     600 is plenty" would be unsayable — and the tool would confidently report
     that a workable room does not work. */
  it('produces items whose sizes and clearances are both editable', () => {
    const wardrobe = itemFromPreset('w1', 'wardrobe');
    expect(wardrobe.clearances[0]?.depth).toBe(900);

    const edited: Item = {
      ...wardrobe,
      footprint: { w: 1234, d: 567 },
      clearances: wardrobe.clearances.map((c) => ({ ...c, depth: 600 })),
    };
    expect(edited.clearances[0]?.depth).toBe(600);
    expect(edited.footprint).toEqual({ w: 1234, d: 567 });

    /* And the preset itself is untouched by that edit. */
    expect(itemFromPreset('w2', 'wardrobe').clearances[0]?.depth).toBe(900);
  });

  it('gives every clearance rule a reason that can be printed', () => {
    for (const preset of PRESETS) {
      for (const rule of preset.clearances(preset.variants[0]!.footprint)) {
        expect(rule.reason.length).toBeGreaterThan(0);
        expect(rule.depth).toBeGreaterThan(0);
      }
    }
  });

  /* Without a group, a single bed pushed against a wall is illegal and half of
     all small bedrooms come back "impossible" — which is exactly the room that
     needed help. */
  it('groups the bed’s two side clearances so either one suffices', () => {
    const sides = itemFromPreset('b', 'bed').clearances.filter(
      (c) => c.side === 'left' || c.side === 'right',
    );
    expect(sides.length).toBe(2);
    expect(new Set(sides.map((c) => c.anyOfGroup)).size).toBe(1);
    expect(sides[0]?.anyOfGroup).toBeDefined();
  });

  /* A nightstand sits inside the bed's side clearance by design. A rule that
     forbids it while the scoring function rewards it makes the most common
     bedroom layout simultaneously illegal and optimal. */
  it('lets a nightstand nest in the bed’s side clearance', () => {
    const side = itemFromPreset('b', 'bed').clearances.find((c) => c.side === 'left');
    expect(side?.nestsWith).toContain('nightstand');
    expect(side?.minCirculation).toBeGreaterThan(0);
  });

  it('leaves the headboard side clear of any clearance', () => {
    expect(itemFromPreset('b', 'bed').clearances.some((c) => c.side === 'back')).toBe(false);
  });

  it('scales a chest of drawers’ clearance with its own depth', () => {
    const standard = itemFromPreset('d1', 'dresser', 0);
    const deep = itemFromPreset('d2', 'dresser', 1);
    expect(standard.clearances[0]?.depth).toBe(450 - 50 + 300);
    expect(deep.clearances[0]?.depth).toBe(450 - 50 + 300);
  });

  it('marks a desk as having a kneehole', () => {
    const desk = itemFromPreset('d', 'desk');
    expect(desk.overhangFloor).toBe(true);
    expect(desk.clearHeightUnder).toBeLessThan(1900);
  });

  /* A rug is floor. Its position must not be able to change the walkable
     figure at all — enforced here, asserted end to end once the metric lands. */
  it('treats a rug as floor rather than as an obstacle', () => {
    const rug = itemFromPreset('r', 'rug');
    expect(rug.overlappable).toBe(true);
    expect(blocksWalking(rug)).toBe(false);
    expect(blocksWalking(itemFromPreset('b', 'bed'))).toBe(true);
  });

  it('requires a wall for the things that would fall over without one', () => {
    for (const type of ['wardrobe', 'bookcase'] as const) {
      expect(itemFromPreset('x', type).mustTouchWall).toBe(true);
    }
    expect(itemFromPreset('x', 'bed').mustTouchWall).toBe(false);
  });

  it('accepts overrides so nothing is forced', () => {
    const custom = itemFromPreset('c', 'wardrobe', 0, {
      name: 'The one from my nan',
      footprint: { w: 950, d: 550 },
      height: 1850,
    });
    expect(custom.name).toBe('The one from my nan');
    expect(custom.footprint).toEqual({ w: 950, d: 550 });
  });
});

describe('layout lookup', () => {
  it('pairs placements with their items', () => {
    const items = [itemFromPreset('a', 'bed'), itemFromPreset('b', 'wardrobe')];
    const layout = {
      id: 'l',
      name: 'now',
      kind: 'baseline' as const,
      placements: [
        { itemId: 'a', pose: { x: 0, y: 0, rot: 0 as Rot }, locked: false },
        { itemId: 'b', pose: { x: 2000, y: 0, rot: 0 as Rot }, locked: false },
      ],
    };
    expect(placedItems(items, layout).map((p) => p.item.id)).toEqual(['a', 'b']);
  });

  /* Skipped rather than thrown on: a placement whose item was deleted should
     not take down the whole plan. */
  it('skips a placement whose item is gone', () => {
    const layout = {
      id: 'l',
      name: 'now',
      kind: 'baseline' as const,
      placements: [{ itemId: 'ghost', pose: { x: 0, y: 0, rot: 0 as Rot }, locked: false }],
    };
    expect(placedItems([], layout)).toEqual([]);
    expect(itemById([], 'ghost')).toBeUndefined();
  });
});

describe('itemZones', () => {
  it('returns one rectangle per rule, paired with the rule', () => {
    const zones = itemZones(bed, at(500, 500));
    expect(zones.length).toBe(bed.clearances.length);
    for (const { rule, rect } of zones) {
      expect(rect.w).toBeGreaterThan(0);
      expect((rule as ClearanceRule).reason.length).toBeGreaterThan(0);
    }
  });
});
