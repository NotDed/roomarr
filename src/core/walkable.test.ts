import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemFromPreset } from '@/core/catalog';
import { computeClearance, erode } from '@/core/clearance';
import { edt2d, edt2dBrute } from '@/core/edt';
import type { Feature } from '@/core/features';
import type { Rect, Rot } from '@/core/geometry';
import { cellRange, chooseCell, makeGrid, rasterizeRoom, stampRect } from '@/core/grid';
import type { Item, Layout, Placement } from '@/core/items';
import { makeRectangularRoom, makeRoom, roomArea } from '@/core/room';
import { mm2ToM2 } from '@/core/units';
import { BODY_RADII, computeWalkable, walkingObstacles } from '@/core/walkable';

const WALL_IDS = ['w0', 'w1', 'w2', 'w3'];

/** A door centred on the bottom wall, which is wall 2 of a rectangle. */
function door(width = 800, wallId = 'w2', offset = 1200): Feature {
  return {
    id: 'd',
    kind: 'door',
    wallId,
    offset,
    width,
    blocksFloor: false,
    door: { hinge: 'start', swing: 'in', leafWidth: width, isPrimary: true },
  };
}

function layoutOf(placements: Placement[]): Layout {
  return { id: 'l', name: 'now', kind: 'baseline', placements };
}

function boxItem(id: string, w: number, d: number, height = 800): Item {
  return {
    ...itemFromPreset(id, 'other'),
    id,
    footprint: { w, d },
    height,
    clearances: [],
  };
}

function at(itemId: string, x: number, y: number, rot: Rot = 0): Placement {
  return { itemId, pose: { x, y, rot }, locked: false };
}

function walkable(
  room = makeRectangularRoom(4000, 3000),
  items: Item[] = [],
  placements: Placement[] = [],
  features: Feature[] = [door(800, 'w2', 1600)],
  radius = BODY_RADII.comfort,
  cell?: number,
) {
  return computeWalkable({
    room,
    items,
    layout: layoutOf(placements),
    features,
    wallIds: WALL_IDS,
    radius,
    ...(cell === undefined ? {} : { cell }),
  });
}

// ── The rasterizer ────────────────────────────────────────────────────────

describe('rasterizeRoom', () => {
  it('fills a rectangle exactly', () => {
    const room = makeRectangularRoom(4000, 3000);
    const grid = makeGrid(room, 50);
    const inside = rasterizeRoom(room, grid);
    expect(grid.w).toBe(80);
    expect(grid.h).toBe(60);
    expect(inside.reduce<number>((n, v) => n + v, 0)).toBe(80 * 60);
  });

  /* The reentrant corner of an alcove is where a naive scanline inverts the
     rest of the row. The half-open crossing rule is what prevents it. */
  it('handles an alcove without inverting the row', () => {
    const room = makeRoom([
      { x: 0, y: 0 },
      { x: 3400, y: 0 },
      { x: 3400, y: 1500 },
      { x: 4200, y: 1500 },
      { x: 4200, y: 2700 },
      { x: 3400, y: 2700 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ]);
    const grid = makeGrid(room, 50);
    const inside = rasterizeRoom(room, grid);
    const cells = inside.reduce<number>((n, v) => n + v, 0);
    const expected = (3400 * 4200 + 800 * 1200) / (50 * 50);
    expect(cells).toBe(expected);
  });

  it('is within a cell row of the polygon area for an awkward size', () => {
    const room = makeRectangularRoom(3437, 4213);
    const grid = makeGrid(room, 50);
    const cells = rasterizeRoom(room, grid).reduce<number>((n, v) => n + v, 0);
    const rastered = cells * 50 * 50;
    expect(Math.abs(rastered - roomArea(room))).toBeLessThan(50 * (3437 + 4213));
  });
});

// ── Stamp / unstamp ───────────────────────────────────────────────────────

describe('stampRect', () => {
  /* The highest-value test here. If stamp and unstamp ever disagree about
     which cells they touch, the grid accumulates phantom obstacles: the metric
     drifts, nothing throws, and the only symptom is numbers that stop making
     sense. */
  it('round-trips exactly over hundreds of random operations', () => {
    const room = makeRectangularRoom(4000, 3000);
    const grid = makeGrid(room, 50);

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -500, max: 4200 }),
            y: fc.integer({ min: -500, max: 3200 }),
            w: fc.integer({ min: 1, max: 2000 }),
            d: fc.integer({ min: 1, max: 2000 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (rects) => {
          const blockers = new Uint8Array(grid.w * grid.h);
          const before = Uint8Array.from(blockers);

          for (const r of rects) stampRect(blockers, grid, r, 1);
          for (const r of rects) stampRect(blockers, grid, r, -1);

          expect(blockers).toEqual(before);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('counts overlaps so removing one obstacle does not clear another', () => {
    const room = makeRectangularRoom(4000, 3000);
    const grid = makeGrid(room, 50);
    const blockers = new Uint8Array(grid.w * grid.h);
    const a: Rect = { x: 0, y: 0, w: 1000, d: 1000 };
    const b: Rect = { x: 500, y: 500, w: 1000, d: 1000 };

    stampRect(blockers, grid, a, 1);
    stampRect(blockers, grid, b, 1);
    stampRect(blockers, grid, a, -1);

    /* A cell covered only by b must still be blocked. */
    const { x0, y0 } = cellRange(grid, { x: 900, y: 900, w: 10, d: 10 });
    expect(blockers[y0 * grid.w + x0]).toBeGreaterThan(0);
  });
});

// ── The distance transform ────────────────────────────────────────────────

describe('edt2d', () => {
  it('agrees exactly with brute force on random masks', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 400, maxLength: 400 }), (bits) => {
        const seeds = Uint8Array.from(bits, (b) => (b ? 1 : 0));
        expect(Array.from(edt2d(seeds, 20, 20))).toEqual(Array.from(edt2dBrute(seeds, 20, 20)));
      }),
      { numRuns: 60 },
    );
  });

  it('is zero at the seeds and grows as the square of the distance', () => {
    const seeds = new Uint8Array(25);
    seeds[12] = 1; // centre of a 5×5
    const d = edt2d(seeds, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[11]).toBe(1);
    expect(d[7]).toBe(1);
    expect(d[6]).toBe(2); // diagonal
    expect(d[0]).toBe(8); // (−2, −2)
  });

  it('handles an all-empty mask without inventing a finite distance', () => {
    const d = edt2d(new Uint8Array(25), 5, 5);
    for (const v of d) expect(v).toBeGreaterThan(1e6);
  });
});

/** Room area minus footprints — the definition that cannot tell layouts apart. */
function naiveFreeArea(roomMm2: number, footprints: number[]): number {
  return roomMm2 - footprints.reduce((a, b) => a + b, 0);
}

// ── The metric ────────────────────────────────────────────────────────────

describe('the walkable metric', () => {
  /* If this comes out as area − perimeter·r, the dilate-back is missing and
     every corridor in every room is being undercounted by about 78%. */
  it('reports very nearly the whole floor for an empty room', () => {
    const result = walkable();
    expect(result.infeasible).toBeNull();
    expect(mm2ToM2(result.walkableMm2)).toBeGreaterThan(11.4);
    expect(mm2ToM2(result.walkableMm2)).toBeLessThanOrEqual(12.01);
  });

  it('says so rather than guessing when there is no door', () => {
    const result = walkable(undefined, [], [], []);
    expect(result.infeasible?.code).toBe('no-door');
    expect(result.walkableMm2).toBe(0);
    /* But the raw open floor is still reported, so the panel has something
       honest to show. */
    expect(result.rawOpenMm2).toBeGreaterThan(0);
  });

  /* A real person squeezes through a real door. Without an unconditional seed,
     a 700 mm door with a 350 mm body radius reports the entire room
     unreachable — a spectacular way to be wrong. */
  it('gets through a door narrower than the body diameter', () => {
    for (const width of [600, 700, 750]) {
      const result = walkable(undefined, [], [], [door(width, 'w2', 1600)]);
      expect(result.infeasible).toBeNull();
      expect(result.walkableMm2).toBeGreaterThan(0);
    }
  });

  it('reports the erosion and the opening as different sizes', () => {
    const result = walkable();
    const erodedArea = result.eroded.reduce<number>((n, v) => n + v, 0);
    const walkableArea = result.walkable.reduce<number>((n, v) => n + v, 0);
    /* The opening is strictly bigger than the erosion it grew from. */
    expect(walkableArea).toBeGreaterThan(erodedArea);
  });

  /* Exercises erosion and dilation on both boundary polarities at once: the
     room's outer boundary and an obstacle's inner one. An inverted dilate-back
     comes out drastically low here. */
  it('handles an obstacle in the middle of the room', () => {
    const room = makeRectangularRoom(5000, 5000);
    const item = boxItem('b', 1000, 1000);
    const result = walkable(room, [item], [at('b', 2000, 2000)], [door(800, 'w2', 2100)]);

    const expected = mm2ToM2(roomArea(room)) - 1.0;
    expect(mm2ToM2(result.walkableMm2)).toBeGreaterThan(expected - 0.8);
    expect(mm2ToM2(result.walkableMm2)).toBeLessThanOrEqual(expected + 0.05);
  });

  /* THE decision this codebase makes about connectivity. Eight-connectivity
     passes this incorrectly, letting a walker slip diagonally between two
     obstacles that merely touch at a corner. */
  it('will not squeeze diagonally between two obstacles touching at a corner', () => {
    const room = makeRectangularRoom(4000, 4000);
    /* Two blocks meeting exactly at (2000, 2000), sealing the room's far
       corner off from the door except through that single point. */
    const a = boxItem('a', 2000, 2000);
    const b = boxItem('b', 2000, 2000);
    const result = walkable(
      room,
      [a, b],
      [at('a', 0, 0), at('b', 2000, 2000)],
      [door(800, 'w2', 400)],
    );

    /* The pocket beyond the pinch point must not be counted. */
    expect(result.strandedMm2).toBeGreaterThan(0);
  });

  /* If this fails, the objective is a noisy step function and the optimizer's
     annealing will trap on grid artefacts rather than on real geometry. */
  it('barely changes when the whole scene shifts by a non-multiple of the cell', () => {
    const build = (shift: number) => {
      const room = makeRoom([
        { x: shift, y: shift },
        { x: 4000 + shift, y: shift },
        { x: 4000 + shift, y: 3000 + shift },
        { x: shift, y: 3000 + shift },
      ]);
      const item = boxItem('b', 1400, 900);
      return computeWalkable({
        room,
        items: [item],
        layout: layoutOf([at('b', 800 + shift, 700 + shift)]),
        features: [door(800, 'w2', 1600)],
        wallIds: WALL_IDS,
        radius: BODY_RADII.comfort,
        cell: 50,
      });
    };

    const base = mm2ToM2(build(0).walkableMm2);
    const shifted = mm2ToM2(build(137).walkableMm2);
    expect(Math.abs(shifted - base) / base).toBeLessThan(0.02);
  });

  /* THE thesis. Naive free area is identical for both layouts — it contains no
     position term at all — while the walkable figure differs by a lot. If this
     ever fails, someone has "simplified" the metric back into uselessness. */
  it('separates two layouts that naive free area cannot tell apart', () => {
    const room = makeRectangularRoom(4000, 5000);
    const bed = boxItem('bed', 1400, 2000);
    const wardrobe = boxItem('wd', 1000, 600, 2000);
    const features = [door(800, 'w2', 1600)];

    /* A: both floating in the middle of the room. */
    const floating = walkable(
      room,
      [bed, wardrobe],
      [at('bed', 1300, 1500), at('wd', 1500, 3800)],
      features,
    );
    /* B: both tucked against walls. */
    const tucked = walkable(room, [bed, wardrobe], [at('bed', 0, 0), at('wd', 3000, 0)], features);

    /* The whole point: this expression has no position term in it at all. */
    expect(naiveFreeArea(floating.roomMm2, [1400 * 2000, 1000 * 600])).toBe(
      naiveFreeArea(tucked.roomMm2, [1400 * 2000, 1000 * 600]),
    );

    expect(mm2ToM2(tucked.walkableMm2) - mm2ToM2(floating.walkableMm2)).toBeGreaterThan(1.0);
  });

  /* Worth being precise about when this is true. In a generously sized room a
     centred bed leaves 1.3 m on every side and costs almost nothing — the two
     layouts really are near-equal, and asserting otherwise would be asserting
     a falsehood. The claim bites in a room that is actually tight: here the
     bed spans 1400 of a 2600 mm room, so centring leaves 600 mm strips on both
     sides. Those are the only routes between the top and bottom of the room,
     and at 600 mm nobody fits through either — so half the floor is stranded. */
  it('scores a bed in the corner above the same bed centred, in a tight room', () => {
    const room = makeRectangularRoom(2600, 3600);
    const bed = boxItem('bed', 1400, 2000);
    const features = [door(800, 'w2', 800)];

    const centred = walkable(room, [bed], [at('bed', 600, 800)], features);
    const cornered = walkable(room, [bed], [at('bed', 0, 0)], features);

    expect(cornered.walkableMm2).toBeGreaterThan(centred.walkableMm2);
    expect(mm2ToM2(cornered.walkableMm2 - centred.walkableMm2)).toBeGreaterThan(2.0);
    /* And the stranding is visible as such, not merely absent from the total. */
    expect(centred.strandedMm2).toBeGreaterThan(0);
  });

  /* A rug is floor. Its position must not be able to move the number at all —
     otherwise the optimizer would spend its search budget shuffling a rug. */
  it('is completely unmoved by a rug', () => {
    const room = makeRectangularRoom(4000, 3000);
    const rug = itemFromPreset('rug', 'rug');
    const features = [door(800, 'w2', 1600)];

    const without = walkable(room, [], [], features);
    const near = walkable(room, [rug], [at('rug', 200, 200)], features);
    const far = walkable(room, [rug], [at('rug', 1800, 1200)], features);

    expect(near.walkableMm2).toBe(without.walkableMm2);
    expect(far.walkableMm2).toBe(without.walkableMm2);
  });

  it('excludes a rug from the walking obstacles entirely', () => {
    const rug = itemFromPreset('rug', 'rug');
    const bed = boxItem('bed', 1400, 2000);
    const obstacles = walkingObstacles(
      makeRectangularRoom(4000, 3000),
      [rug, bed],
      layoutOf([at('rug', 0, 0), at('bed', 2000, 0)]),
      [],
      WALL_IDS,
    );
    expect(obstacles.length).toBe(1);
  });

  /* Clearance zones constrain where FURNITURE goes, never where a person
     walks. Folding them into the obstacle set roughly halves the figure. */
  it('does not treat clearance zones as obstacles', () => {
    const room = makeRectangularRoom(4000, 3000);
    const withZones = itemFromPreset('bed', 'bed'); // carries 750/750/600 clearances
    const withoutZones = { ...withZones, clearances: [] };
    const features = [door(800, 'w2', 1600)];

    const a = walkable(room, [withZones], [at('bed', 0, 0)], features);
    const b = walkable(room, [withoutZones], [at('bed', 0, 0)], features);
    expect(a.walkableMm2).toBe(b.walkableMm2);
  });

  it('does not treat a door swing as a walking obstacle', () => {
    const room = makeRectangularRoom(4000, 3000);
    const swinging = walkable(room, [], [], [door(800, 'w2', 1600)]);
    const sliding = walkable(
      room,
      [],
      [],
      [
        {
          ...door(800, 'w2', 1600),
          door: { hinge: 'start', swing: 'slide', leafWidth: 800, isPrimary: true },
        },
      ],
    );
    expect(swinging.walkableMm2).toBe(sliding.walkableMm2);
  });

  /* The analytic clearance field makes the erosion threshold exact in the
     radius, so the verdict cannot depend on the grid. A binary distance
     transform quantizes clearance to whole cells and would fail this. */
  it('gives the same feasibility verdict at 50 mm and 25 mm cells', () => {
    const room = makeRectangularRoom(4000, 3000);
    const item = boxItem('b', 1400, 900);

    for (const radius of Object.values(BODY_RADII)) {
      const coarse = walkable(room, [item], [at('b', 800, 700)], undefined, radius, 50);
      const fine = walkable(room, [item], [at('b', 800, 700)], undefined, radius, 25);
      expect(coarse.infeasible === null).toBe(fine.infeasible === null);
    }
  });

  it('agrees closely on area across cell sizes', () => {
    const room = makeRectangularRoom(4000, 3000);
    const item = boxItem('b', 1400, 900);
    const coarse = walkable(room, [item], [at('b', 800, 700)], undefined, BODY_RADII.comfort, 50);
    const fine = walkable(room, [item], [at('b', 800, 700)], undefined, BODY_RADII.comfort, 25);

    const a = mm2ToM2(coarse.walkableMm2);
    const b = mm2ToM2(fine.walkableMm2);
    expect(Math.abs(a - b) / b).toBeLessThan(0.05);
  });

  it('shrinks as the body gets wider', () => {
    const room = makeRectangularRoom(4000, 3000);
    const item = boxItem('b', 1400, 900);
    const place = [at('b', 900, 800)];

    const tight = walkable(room, [item], place, undefined, BODY_RADII.tight);
    const comfort = walkable(room, [item], place, undefined, BODY_RADII.comfort);
    const wide = walkable(room, [item], place, undefined, BODY_RADII.accessible);

    expect(tight.walkableMm2).toBeGreaterThanOrEqual(comfort.walkableMm2);
    expect(comfort.walkableMm2).toBeGreaterThanOrEqual(wide.walkableMm2);
  });
});

// ── Invariants ────────────────────────────────────────────────────────────

describe('invariants', () => {
  it('keeps walkable ⊆ standable ⊆ free ⊆ room', () => {
    const room = makeRectangularRoom(4000, 3000);
    const desk = itemFromPreset('desk', 'desk');
    const result = walkable(room, [desk], [at('desk', 500, 400)]);

    for (let i = 0; i < result.inside.length; i++) {
      if (result.walkable[i] !== 0) expect(result.standable[i]).not.toBe(0);
      if (result.standable[i] !== 0) expect(result.free[i]).not.toBe(0);
      if (result.free[i] !== 0) expect(result.inside[i]).not.toBe(0);
    }
  });

  it('never reports more walkable floor than the room has', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2500 }), fc.integer({ min: 0, max: 1500 }), (x, y) => {
        const room = makeRectangularRoom(4000, 3000);
        const item = boxItem('b', 1400, 900);
        const result = walkable(room, [item], [at('b', x, y)]);
        expect(result.walkableMm2).toBeLessThanOrEqual(result.roomMm2);
        expect(result.walkableMm2).toBeLessThanOrEqual(result.rawOpenMm2 + 1);
      }),
      { numRuns: 30 },
    );
  });

  it('never grows when an obstacle is added', () => {
    const room = makeRectangularRoom(4000, 3000);
    const item = boxItem('b', 1000, 800);
    const bare = walkable(room);
    const furnished = walkable(room, [item], [at('b', 1200, 900)]);
    expect(furnished.walkableMm2).toBeLessThanOrEqual(bare.walkableMm2);
  });

  it('picks a cell size that keeps a big room affordable', () => {
    expect(chooseCell(makeRectangularRoom(3400, 4200))).toBeGreaterThanOrEqual(50);
    expect(chooseCell(makeRectangularRoom(7000, 9000))).toBeGreaterThan(
      chooseCell(makeRectangularRoom(3400, 4200)),
    );
    expect(chooseCell(makeRectangularRoom(20000, 20000))).toBeLessThanOrEqual(100);
  });
});

// ── The clearance field ───────────────────────────────────────────────────

describe('the clearance field', () => {
  it('measures distance to the nearest wall in an empty room', () => {
    const room = makeRectangularRoom(4000, 3000);
    const grid = makeGrid(room, 50);
    const inside = rasterizeRoom(room, grid);
    const field = computeClearance(room, grid, [], inside);

    /* The centre of a 4×3 m room is 1500 mm from the nearest wall. */
    const cx = Math.floor(grid.w / 2);
    const cy = Math.floor(grid.h / 2);
    const d = Math.sqrt(field.distSq[cy * grid.w + cx] ?? 0);
    expect(d).toBeGreaterThan(1400);
    expect(d).toBeLessThanOrEqual(1500);
  });

  /* Exact in the radius, at any cell size — the property that makes the two
     tiers agree by construction rather than by a shared rounding rule. */
  it('erodes by an exact radius rather than a multiple of the cell', () => {
    const room = makeRectangularRoom(4000, 3000);

    for (const cell of [50, 25]) {
      const grid = makeGrid(room, cell);
      const inside = rasterizeRoom(room, grid);
      const field = computeClearance(room, grid, [], inside);

      /* A cell survives erosion iff its centre really is ≥ r from a wall. */
      for (const r of [275, 350, 460]) {
        const eroded = erode(field, inside, r);
        for (let i = 0; i < eroded.length; i++) {
          if (inside[i] === 0) continue;
          const exact = Math.sqrt(field.distSq[i] ?? 0);
          expect(eroded[i] !== 0).toBe(exact >= r);
        }
      }
    }
  });
});
