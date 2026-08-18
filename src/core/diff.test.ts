import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemFromPreset } from '@/core/catalog';
import { describeDiff, diffLayouts, turnsBetween } from '@/core/diff';
import { ROTATIONS, type Rot, rotateAbout } from '@/core/geometry';
import type { Item, Layout, Placement } from '@/core/items';

const bed = itemFromPreset('bed', 'bed');
const wardrobe = itemFromPreset('ward', 'wardrobe');
const ITEMS: Item[] = [bed, wardrobe];

function layout(placements: Placement[]): Layout {
  return { id: 'l', name: 'l', kind: 'saved', placements };
}

function at(id: string, x: number, y: number, rot: Rot = 0): Placement {
  return { itemId: id, pose: { x, y, rot }, locked: false };
}

describe('turnsBetween', () => {
  it('takes the short way round', () => {
    /* Three turns clockwise is one turn anticlockwise. Telling somebody to
       rotate a wardrobe 270° when 90° the other way does it is how a tool
       gets ignored. */
    expect(turnsBetween(0, 3)).toBe(-1);
    expect(turnsBetween(1, 0)).toBe(-1);
    expect(turnsBetween(0, 1)).toBe(1);
    expect(turnsBetween(0, 2)).toBe(2);
    expect(turnsBetween(2, 0)).toBe(2);
    expect(turnsBetween(2, 2)).toBe(0);
  });

  it('always names a rotation that actually gets there', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROTATIONS), fc.constantFrom(...ROTATIONS), (a, b) => {
        const turns = turnsBetween(a, b);
        expect((((a + turns) % 4) + 4) % 4).toBe(b);
        expect(Math.abs(turns)).toBeLessThanOrEqual(2);
      }),
      { numRuns: 100 },
    );
  });
});

describe('diffLayouts', () => {
  it('reports nothing when nothing changed', () => {
    const l = layout([at('bed', 100, 100), at('ward', 2000, 100)]);
    const diff = diffLayouts(ITEMS, l, l);

    expect(diff.moves).toEqual([]);
    expect(diff.unchanged.toSorted()).toEqual(['bed', 'ward']);
    expect(describeDiff(diff)).toBe('Nothing moves');
  });

  it('measures from the centre, so a pure rotation is not a move', () => {
    /* The bed is 1350 x 1900. Turning it about its own centre leaves the centre
       where it was but shifts the min corner by 275 mm — and the pose stores
       the corner. Reporting 389 mm for a bed that went nowhere would be a lie,
       and it is exactly what measuring corner-to-corner produces. */
    const start = { x: 1000, y: 1000, rot: 0 as const };
    const before = layout([{ itemId: 'bed', pose: start, locked: false }]);
    const after = layout([
      { itemId: 'bed', pose: rotateAbout(start, bed.footprint, 1), locked: false },
    ]);

    const [move] = diffLayouts(ITEMS, before, after).moves;
    expect(move?.distance).toBe(0);
    expect(move?.turns).toBe(1);
    expect(describeDiff(diffLayouts(ITEMS, before, after))).toBe('1 thing turns');
  });

  it('orders by how much work each move is', () => {
    const before = layout([at('bed', 0, 0), at('ward', 0, 3000)]);
    const after = layout([at('bed', 100, 0), at('ward', 2000, 3000)]);

    /* The heavy item crossing the room is what decides whether the whole plan
       is worth doing, so it goes first. */
    expect(diffLayouts(ITEMS, before, after).moves.map((m) => m.itemId)).toEqual(['ward', 'bed']);
  });

  it('separates moving from turning in the summary', () => {
    const before = layout([at('bed', 0, 0), at('ward', 0, 3000, 0)]);
    const after = layout([at('bed', 900, 0), at('ward', 1500, 3000, 1)]);

    expect(describeDiff(diffLayouts(ITEMS, before, after))).toBe(
      '2 things move, one of them turns',
    );
  });

  it('notices an item present in only one arrangement', () => {
    const before = layout([at('bed', 0, 0), at('ward', 0, 3000)]);
    const after = layout([at('bed', 0, 0)]);
    const diff = diffLayouts(ITEMS, before, after);

    expect(diff.onlyInFrom).toEqual(['ward']);
    expect(diff.onlyInTo).toEqual([]);
    expect(diff.moves).toEqual([]);
  });

  it('is antisymmetric in distance and rotation', () => {
    fc.assert(
      fc.property(
        fc.record({
          x1: fc.integer({ min: 0, max: 3000 }),
          y1: fc.integer({ min: 0, max: 3000 }),
          r1: fc.constantFrom(...ROTATIONS),
          x2: fc.integer({ min: 0, max: 3000 }),
          y2: fc.integer({ min: 0, max: 3000 }),
          r2: fc.constantFrom(...ROTATIONS),
        }),
        ({ x1, y1, r1, x2, y2, r2 }) => {
          const a = layout([at('bed', x1, y1, r1)]);
          const b = layout([at('bed', x2, y2, r2)]);

          const there = diffLayouts(ITEMS, a, b).moves[0];
          const back = diffLayouts(ITEMS, b, a).moves[0];

          if (there === undefined) {
            expect(back).toBeUndefined();
            return;
          }

          /* Undoing a move is the same distance and the opposite turn. If this
             ever fails, a move plan and its reverse disagree — and the reverse
             is exactly what somebody uses when they change their mind. */
          expect(back?.distance).toBe(there.distance);
          /* `|| 0` because negating zero gives −0, and `Object.is(-0, 0)` is
             false. Fourth time in this codebase. */
          expect(back?.turns).toBe(there.turns === 2 ? 2 : -there.turns || 0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
