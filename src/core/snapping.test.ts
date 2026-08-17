import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemFromPreset } from '@/core/catalog';
import type { Item, Placement } from '@/core/items';
import { makeRectangularRoom } from '@/core/room';
import { ALL_SNAPS, NO_SNAPS, type SnapToggles, collectTargets, snapRect } from '@/core/snapping';

const ROOM = makeRectangularRoom(3400, 4200);

function at(item: Item, x: number, y: number): Placement {
  return { itemId: item.id, pose: { x, y, rot: 0 }, locked: false };
}

/** Everything the collector needs, with the boring parts filled in. */
function setup(options: {
  items?: Item[];
  placements?: Placement[];
  moving: { x: number; y: number; w: number; d: number };
  toggles?: SnapToggles;
}) {
  const items = options.items ?? [];
  const moving = {
    x: options.moving.x,
    y: options.moving.y,
    w: options.moving.w,
    d: options.moving.d,
  };

  return {
    moving,
    targets: collectTargets({
      room: ROOM,
      items,
      placements: options.placements ?? [],
      movingId: 'moving',
      movingRect: moving,
      toggles: options.toggles ?? ALL_SNAPS,
    }),
  };
}

describe('snapping to walls', () => {
  it('pulls an item flush when it is dragged close', () => {
    const { moving, targets } = setup({ moving: { x: 37, y: 1000, w: 800, d: 600 } });
    const result = snapRect(moving, targets, 50);

    expect(result.x).toBe(0);
    expect(result.hits.some((h) => h.target.label === 'wall')).toBe(true);
  });

  it('snaps the far edge to the far wall', () => {
    /* 3400 − 800 = 2600 is flush against the right wall; 2578 is 22 mm short. */
    const { moving, targets } = setup({ moving: { x: 2578, y: 1000, w: 800, d: 600 } });
    expect(snapRect(moving, targets, 50).x).toBe(2600);
  });

  it('leaves an item alone when nothing is within tolerance', () => {
    const { moving, targets } = setup({ moving: { x: 1200, y: 1800, w: 400, d: 400 } });
    const result = snapRect(moving, targets, 50);

    expect([result.x, result.y]).toEqual([1200, 1800]);
    expect(result.hits).toEqual([]);
  });
});

describe('the axes resolve independently', () => {
  /**
   * The property the whole design exists for. Sliding along a wall must not
   * disturb the wall snap, and a single-winner model gets this wrong the
   * moment anything else in the room comes within tolerance.
   */
  it('holds a wall snap in y while x moves freely', () => {
    const wardrobe = itemFromPreset('ward', 'wardrobe');
    const { targets } = setup({
      items: [wardrobe],
      placements: [at(wardrobe, 2000, 2000)],
      moving: { x: 0, y: 0, w: 800, d: 600 },
    });

    for (const x of [400, 900, 1400, 1900, 2400]) {
      const result = snapRect({ x, y: 8, w: 800, d: 600 }, targets, 50);
      expect(result.y).toBe(0);
    }
  });

  it('can take a wall on one axis and an item on the other', () => {
    const wardrobe = itemFromPreset('ward', 'wardrobe');
    const placement = at(wardrobe, 1500, 2000);
    const { targets } = setup({
      items: [wardrobe],
      placements: [placement],
      moving: { x: 0, y: 0, w: 800, d: 600 },
    });

    /* y within tolerance of the top wall, x within tolerance of the wardrobe's
       left edge. Both should land. */
    const result = snapRect({ x: 1512, y: 14, w: 800, d: 600 }, targets, 50);

    expect(result.y).toBe(0);
    expect(result.x).toBe(1500);
    expect(result.hits).toHaveLength(2);
  });
});

describe('snapping to other items', () => {
  it('lands flush against an item edge', () => {
    const bed = itemFromPreset('bed', 'bed');
    const { targets } = setup({
      items: [bed],
      placements: [at(bed, 1000, 1000)],
      moving: { x: 0, y: 0, w: 450, d: 400 },
    });

    /* The bed's left edge is at 1000, so flush-on-the-left puts our right edge
       there: x = 1000 − 450 = 550. */
    expect(snapRect({ x: 562, y: 1200, w: 450, d: 400 }, targets, 50).x).toBe(550);
  });

  it('aligns edges as well as butting against them', () => {
    const bed = itemFromPreset('bed', 'bed');
    const { targets } = setup({
      items: [bed],
      placements: [at(bed, 1000, 1000)],
      moving: { x: 0, y: 0, w: 450, d: 400 },
    });

    /* Our left edge onto the bed's left edge — the same rule, because every
       item contributes both edges as targets and the mover brings both as
       sources. */
    expect(snapRect({ x: 1020, y: 2400, w: 450, d: 400 }, targets, 50).x).toBe(1000);
  });

  it('never snaps an item to itself', () => {
    const bed = itemFromPreset('moving', 'bed');
    const { moving, targets } = setup({
      items: [bed],
      placements: [at(bed, 1000, 1000)],
      moving: { x: 1000, y: 1000, w: bed.footprint.w, d: bed.footprint.d },
    });

    /* Only walls and the room centre may appear; the item's own lines must not,
       or it would be pinned in place and impossible to drag at all. */
    expect(targets.every((t) => !t.label.includes('bed'))).toBe(true);
    expect(snapRect({ ...moving, x: 1400 }, targets, 50).x).toBe(1400);
  });
});

describe('centre lines', () => {
  it('centres an item in the room', () => {
    const { targets } = setup({ moving: { x: 0, y: 0, w: 800, d: 600 } });

    /* Room centre is 1700; the item's centre lands there at x = 1300. */
    expect(snapRect({ x: 1288, y: 3000, w: 800, d: 600 }, targets, 50).x).toBe(1300);
  });

  it('centres one item on another', () => {
    const bed = itemFromPreset('bed', 'bed');
    /* Deliberately off the room's own centre line. Parked in the middle, the
       bed's centre and the room's centre are within a few millimetres of each
       other and the test would pass whichever one won. */
    const { targets } = setup({
      items: [bed],
      placements: [at(bed, 200, 1000)],
      moving: { x: 0, y: 0, w: 400, d: 400 },
    });

    const want = Math.round(200 + bed.footprint.w / 2 - 200);
    expect(snapRect({ x: want + 18, y: 3000, w: 400, d: 400 }, targets, 50).x).toBe(want);
  });

  it('prefers the clearer label when two kinds land on the same line', () => {
    /* The room's centre line is generated twice: once as a centre, and once as
       "centred between the wall and the wall". Identical coordinate, so the
       pose is the same either way — but without the rank the winner would
       depend on array order and the guide's caption would flicker between two
       names while the item did not move at all. */
    const { targets } = setup({ moving: { x: 0, y: 0, w: 800, d: 600 } });
    const both = targets.filter((t) => t.axis === 'x' && t.at === 1700);

    expect(both.map((t) => t.kind).toSorted()).toEqual(['center', 'gap']);
    expect(snapRect({ x: 1288, y: 3000, w: 800, d: 600 }, targets, 50).hits[0]?.target.label).toBe(
      'centre of the room',
    );
  });

  it('does not accept an edge onto a centre line', () => {
    const { targets } = setup({
      moving: { x: 0, y: 0, w: 800, d: 600 },
      toggles: { ...NO_SNAPS, center: true },
    });

    /* An edge 5 mm from the room's centre line must not be dragged onto it.
       Aligning an edge to a centre means nothing, and offering it would fight
       the centre-to-centre snap it sits beside. */
    expect(snapRect({ x: 1695, y: 3000, w: 800, d: 600 }, targets, 50).x).toBe(1695);
  });
});

describe('clearance edges', () => {
  it('offers the outer edge of a clearance zone but not the inner one', () => {
    const bed = itemFromPreset('bed', 'bed');
    const { targets } = setup({
      items: [bed],
      placements: [at(bed, 1000, 1000)],
      moving: { x: 0, y: 0, w: 400, d: 400 },
      toggles: { ...NO_SNAPS, clearance: true },
    });

    expect(targets.length).toBeGreaterThan(0);

    /* Every clearance target must sit outside the bed's own rectangle. One on
       the boundary would be the item's edge under a different name, and would
       survive turning the edge snaps off. */
    const bedRect = { x: 1000, y: 1000, w: bed.footprint.w, d: bed.footprint.d };
    for (const target of targets) {
      if (target.axis === 'x') {
        expect(target.at <= bedRect.x || target.at >= bedRect.x + bedRect.w).toBe(true);
      } else {
        expect(target.at <= bedRect.y || target.at >= bedRect.y + bedRect.d).toBe(true);
      }
    }
  });
});

describe('equal gaps', () => {
  it('centres between two items', () => {
    const a = itemFromPreset('a', 'wardrobe');
    const b = itemFromPreset('b', 'wardrobe');
    const items = [a, b];
    const placements = [at(a, 0, 1000), at(b, 2800, 1000)];

    const targets = collectTargets({
      room: ROOM,
      items,
      placements,
      movingId: 'moving',
      movingRect: { x: 1000, y: 1000, w: 400, d: 400 },
      toggles: { ...NO_SNAPS, gap: true },
    });

    /* The free span runs from a's right edge to b's left edge; a 400 mm item
       centred in it sits at (aRight + bLeft)/2 − 200. */
    const free = { lo: a.footprint.w, hi: 2800 };
    const want = Math.round((free.lo + free.hi) / 2 - 200);

    expect(snapRect({ x: want + 15, y: 1000, w: 400, d: 400 }, targets, 50).x).toBe(want);
  });

  it('ignores obstacles that do not overlap on the other axis', () => {
    const far = itemFromPreset('far', 'wardrobe');
    const targets = collectTargets({
      room: ROOM,
      items: [far],
      /* Down the far end of the room, nowhere near the moving item's row. */
      placements: [at(far, 0, 3600)],
      movingId: 'moving',
      movingRect: { x: 1000, y: 200, w: 400, d: 400 },
      toggles: { ...NO_SNAPS, gap: true },
    });

    /* Only the wall-to-wall span should exist, so the sole x target is the
       middle of the room. Anything else would be centring the item between
       things it is visibly not between. */
    const xs = targets.filter((t) => t.axis === 'x').map((t) => t.at);
    expect(xs).toEqual([1700]);
  });

  it('repeats a gap that already exists', () => {
    const bed = itemFromPreset('bed', 'bed');
    const stand = itemFromPreset('stand', 'nightstand');
    const bedX = 1000;
    const gap = 80;
    const standX = bedX - gap - stand.footprint.w;

    const targets = collectTargets({
      room: ROOM,
      items: [bed, stand],
      placements: [at(bed, bedX, 1000), at(stand, standX, 1000)],
      movingId: 'moving',
      movingRect: { x: 2000, y: 1000, w: stand.footprint.w, d: stand.footprint.d },
      toggles: { ...NO_SNAPS, gap: true },
    });

    /* The second nightstand should find the same 80 mm on the other side. */
    const want = bedX + bed.footprint.w + gap;
    const result = snapRect(
      { x: want + 17, y: 1000, w: stand.footprint.w, d: stand.footprint.d },
      targets,
      50,
    );

    expect(result.x).toBe(want);
    expect(result.hits[0]?.target.label).toBe('same 80 mm gap');
  });
});

describe('toggles', () => {
  it('turning a kind off removes every target of that kind', () => {
    const bed = itemFromPreset('bed', 'bed');
    const base = {
      room: ROOM,
      items: [bed],
      placements: [at(bed, 1000, 1000)],
      movingId: 'moving',
      movingRect: { x: 200, y: 200, w: 400, d: 400 },
    };

    for (const kind of ['edge', 'center', 'clearance', 'gap'] as const) {
      const without = collectTargets({ ...base, toggles: { ...ALL_SNAPS, [kind]: false } });
      expect(without.some((t) => t.kind === kind)).toBe(false);
    }
  });

  it('all off means nothing moves', () => {
    const bed = itemFromPreset('bed', 'bed');
    const targets = collectTargets({
      room: ROOM,
      items: [bed],
      placements: [at(bed, 1000, 1000)],
      movingId: 'moving',
      movingRect: { x: 5, y: 5, w: 400, d: 400 },
      toggles: NO_SNAPS,
    });

    expect(targets).toEqual([]);
    expect(snapRect({ x: 5, y: 5, w: 400, d: 400 }, targets, 50)).toEqual({
      x: 5,
      y: 5,
      hits: [],
    });
  });
});

describe('properties', () => {
  const bed = itemFromPreset('bed', 'bed');
  const placements = [at(bed, 1000, 1400)];
  const rect = fc.record({
    x: fc.integer({ min: -500, max: 3500 }),
    y: fc.integer({ min: -500, max: 4300 }),
    w: fc.integer({ min: 100, max: 1200 }),
    d: fc.integer({ min: 100, max: 1200 }),
  });

  it('never moves anything further than the tolerance', () => {
    fc.assert(
      fc.property(rect, fc.integer({ min: 0, max: 200 }), (moving, tolerance) => {
        const targets = collectTargets({
          room: ROOM,
          items: [bed],
          placements,
          movingId: 'moving',
          movingRect: moving,
          toggles: ALL_SNAPS,
        });
        const result = snapRect(moving, targets, tolerance);

        /* A snap that can teleport an item is not a snap. The bound is the
           tolerance plus a millimetre, because a centre source on an
           odd-sized item rounds. */
        expect(Math.abs(result.x - moving.x)).toBeLessThanOrEqual(tolerance + 1);
        expect(Math.abs(result.y - moving.y)).toBeLessThanOrEqual(tolerance + 1);
      }),
      { numRuns: 300 },
    );
  });

  it('is idempotent — snapping a snapped rect changes nothing', () => {
    fc.assert(
      fc.property(rect, (moving) => {
        const collect = (r: typeof moving) =>
          collectTargets({
            room: ROOM,
            items: [bed],
            placements,
            movingId: 'moving',
            movingRect: r,
            toggles: ALL_SNAPS,
          });

        const once = snapRect(moving, collect(moving), 50);
        const settled = { ...moving, x: once.x, y: once.y };
        const twice = snapRect(settled, collect(settled), 50);

        /* If this fails, the item jitters while the pointer is still: each
           frame re-snaps the result of the last one. */
        expect([twice.x, twice.y]).toEqual([once.x, once.y]);
      }),
      { numRuns: 300 },
    );
  });

  it('returns integers, always', () => {
    fc.assert(
      fc.property(rect, (moving) => {
        const targets = collectTargets({
          room: ROOM,
          items: [bed],
          placements,
          movingId: 'moving',
          movingRect: moving,
          toggles: ALL_SNAPS,
        });
        const result = snapRect(moving, targets, 50);

        expect(Number.isInteger(result.x)).toBe(true);
        expect(Number.isInteger(result.y)).toBe(true);
        expect(Object.is(result.x, -0)).toBe(false);
        expect(Object.is(result.y, -0)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
