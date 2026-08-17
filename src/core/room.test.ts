import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec } from '@/core/geometry';
import {
  deriveWalls,
  isClockwise,
  makeRectangularRoom,
  makeRoom,
  pointAlongWall,
  polygonArea,
  roomArea,
  roomBounds,
  roomContains,
  roomWalls,
  signedArea2,
  toClockwise,
  validateOutline,
} from '@/core/room';

/** 3.4 × 4.2 m — the fixture bedroom used throughout the tests. */
const RECT: Vec[] = [
  { x: 0, y: 0 },
  { x: 3400, y: 0 },
  { x: 3400, y: 4200 },
  { x: 0, y: 4200 },
];

/** The same room with a 1200 × 800 alcove pushed out of the right-hand wall. */
const WITH_ALCOVE: Vec[] = [
  { x: 0, y: 0 },
  { x: 3400, y: 0 },
  { x: 3400, y: 1500 },
  { x: 4200, y: 1500 },
  { x: 4200, y: 2700 },
  { x: 3400, y: 2700 },
  { x: 3400, y: 4200 },
  { x: 0, y: 4200 },
];

describe('winding', () => {
  /* In y-down coordinates a polygon that reads clockwise on screen has a
     POSITIVE shoelace area — the opposite of the y-up convention most
     references assume. Getting this backwards flips every inward wall normal. */
  it('treats screen-clockwise as positive in y-down coordinates', () => {
    expect(signedArea2(RECT)).toBeGreaterThan(0);
    expect(isClockwise(RECT)).toBe(true);
    expect(isClockwise(RECT.toReversed())).toBe(false);
  });

  it('reports area regardless of winding', () => {
    expect(polygonArea(RECT)).toBe(3400 * 4200);
    expect(polygonArea(RECT.toReversed())).toBe(3400 * 4200);
  });

  it('computes the area of a non-convex outline', () => {
    expect(polygonArea(WITH_ALCOVE)).toBe(3400 * 4200 + 800 * 1200);
  });

  it('normalises to clockwise, leaving an already-clockwise outline alone', () => {
    expect(toClockwise(RECT)).toEqual(RECT);
    expect(isClockwise(toClockwise(RECT.toReversed()))).toBe(true);
    expect(isClockwise(toClockwise(WITH_ALCOVE))).toBe(true);
    expect(isClockwise(toClockwise(WITH_ALCOVE.toReversed()))).toBe(true);
  });
});

describe('validateOutline', () => {
  it('accepts a rectangle and an alcove', () => {
    expect(validateOutline(RECT)).toEqual([]);
    expect(validateOutline(WITH_ALCOVE)).toEqual([]);
  });

  it('accepts either winding', () => {
    expect(validateOutline(RECT.toReversed())).toEqual([]);
  });

  it('rejects too few vertices', () => {
    expect(validateOutline([{ x: 0, y: 0 }])[0]).toEqual({ code: 'too-few-vertices', count: 1 });
    expect(validateOutline(RECT.slice(0, 3))[0]?.code).toBe('too-few-vertices');
  });

  it('rejects a diagonal edge, naming which one', () => {
    const skew: Vec[] = [
      { x: 0, y: 0 },
      { x: 3400, y: 100 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ];
    expect(validateOutline(skew)).toContainEqual({ code: 'not-rectilinear', index: 0 });
  });

  it('rejects a repeated vertex', () => {
    const dup: Vec[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 3400, y: 0 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ];
    expect(dup.length).toBe(5);
    expect(validateOutline(dup).some((p) => p.code === 'zero-length-edge')).toBe(true);
  });

  /* A vertex where both edges run the same way draws fine but is not a corner
     anyone would point at, and it desynchronises wall indices from the walls a
     person sees — which matters because every door and window is stored as an
     offset along a wall index. */
  it('rejects a corner that is not really a corner', () => {
    const collinear: Vec[] = [
      { x: 0, y: 0 },
      { x: 1700, y: 0 },
      { x: 3400, y: 0 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ];
    expect(validateOutline(collinear)).toContainEqual({ code: 'collinear-corner', index: 1 });
  });

  it('rejects a figure-eight', () => {
    const crossed: Vec[] = [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 2000 },
      { x: 1000, y: 2000 },
      { x: 1000, y: -1000 },
      { x: 0, y: -1000 },
    ];
    expect(validateOutline(crossed).some((p) => p.code === 'self-intersecting')).toBe(true);
  });

  it('reports every problem at once rather than only the first', () => {
    const bad: Vec[] = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(validateOutline(bad).filter((p) => p.code === 'not-rectilinear').length).toBe(2);
  });
});

describe('makeRoom', () => {
  it('normalises winding to clockwise', () => {
    expect(isClockwise(makeRoom(RECT.toReversed()).outline)).toBe(true);
  });

  it('refuses an invalid outline rather than producing a plausible wrong number', () => {
    expect(() => makeRoom(RECT.slice(0, 3))).toThrow(RangeError);
  });

  it('builds a rectangle from width and depth', () => {
    const room = makeRectangularRoom(3400, 4200);
    expect(room.outline).toEqual(RECT);
    expect(roomArea(room)).toBe(14_280_000);
    expect(roomBounds(room)).toEqual({ x: 0, y: 0, w: 3400, d: 4200 });
  });

  it('takes wall thickness and ceiling height, with sane defaults', () => {
    expect(makeRectangularRoom(3400, 4200).ceilingHeight).toBe(2400);
    expect(makeRectangularRoom(3400, 4200, { ceilingHeight: 2700 }).ceilingHeight).toBe(2700);
  });
});

describe('walls', () => {
  it('produces one wall per edge, in outline order', () => {
    const walls = deriveWalls(RECT);
    expect(walls.length).toBe(4);
    expect(walls.map((w) => w.length)).toEqual([3400, 4200, 3400, 4200]);
    expect(walls.map((w) => w.axis)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  });

  /* For a clockwise-wound polygon in y-down, the inward normal of edge (dx,dy)
     is (-dy,dx) on every edge — no per-edge sign test and no point-in-polygon
     probe. If this is inverted, every clearance zone is generated outside the
     room and the whole constraint system silently inverts. */
  it('points every normal into the room', () => {
    const walls = deriveWalls(RECT);
    expect(walls[0]?.inward).toEqual({ x: 0, y: 1 }); // top wall → down
    expect(walls[1]?.inward).toEqual({ x: -1, y: 0 }); // right wall → left
    expect(walls[2]?.inward).toEqual({ x: 0, y: -1 }); // bottom wall → up
    expect(walls[3]?.inward).toEqual({ x: 1, y: 0 }); // left wall → right
  });

  it('points normals inward on a non-convex outline too', () => {
    const room = makeRoom(WITH_ALCOVE);
    for (const wall of roomWalls(room)) {
      const mid = pointAlongWall(wall, wall.length / 2);
      const justInside = { x: mid.x + wall.inward.x, y: mid.y + wall.inward.y };
      expect(roomContains(room, justInside)).toBe(true);
    }
  });

  it('locates a point along a wall from its start vertex', () => {
    const wall = deriveWalls(RECT)[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(pointAlongWall(wall, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlongWall(wall, 900)).toEqual({ x: 900, y: 0 });
    expect(pointAlongWall(wall, 3400)).toEqual({ x: 3400, y: 0 });
  });

  /* Every door and window position goes through pointAlongWall. Interpolating
     by offset/length gives 0.9999999999999999 for a 3400 mm wall, and half a
     millimetre of drift here is a doorway that does not line up with the wall
     it is cut into. */
  it('is exact on every wall of every outline, for every integer offset', () => {
    for (const outline of [RECT, WITH_ALCOVE, WITH_ALCOVE.toReversed()]) {
      for (const wall of deriveWalls(outline)) {
        fc.assert(
          fc.property(fc.integer({ min: 0, max: wall.length }), (offset) => {
            const p = pointAlongWall(wall, offset);
            expect(Number.isInteger(p.x)).toBe(true);
            expect(Number.isInteger(p.y)).toBe(true);
          }),
        );
        expect(pointAlongWall(wall, 0)).toEqual(wall.start);
        expect(pointAlongWall(wall, wall.length)).toEqual(wall.end);
      }
    }
  });

  it('has exact unit direction and inward vectors, never a float approximation', () => {
    for (const outline of [RECT, WITH_ALCOVE]) {
      for (const wall of deriveWalls(outline)) {
        for (const v of [wall.direction, wall.inward]) {
          expect([-1, 0, 1]).toContain(v.x);
          expect([-1, 0, 1]).toContain(v.y);
          expect(Object.is(v.x, -0)).toBe(false);
          expect(Object.is(v.y, -0)).toBe(false);
          expect(Math.abs(v.x) + Math.abs(v.y)).toBe(1);
        }
        /* inward is the clockwise quarter turn of direction: (dx,dy) → (-dy,dx) */
        expect(wall.inward.x).toBe(wall.direction.y === 0 ? 0 : -wall.direction.y);
        expect(wall.inward.y).toBe(wall.direction.x);
      }
    }
  });

  it('wall lengths sum to the perimeter', () => {
    expect(deriveWalls(WITH_ALCOVE).reduce((sum, w) => sum + w.length, 0)).toBe(
      3400 + 1500 + 800 + 1200 + 800 + 1500 + 3400 + 4200,
    );
  });
});

describe('roomContains', () => {
  const room = makeRoom(WITH_ALCOVE);

  it('includes the interior and excludes the outside', () => {
    expect(roomContains(room, { x: 1700, y: 2100 })).toBe(true);
    expect(roomContains(room, { x: 3800, y: 2100 })).toBe(true); // inside the alcove
    expect(roomContains(room, { x: 3800, y: 500 })).toBe(false); // beside the alcove
    expect(roomContains(room, { x: -100, y: 2100 })).toBe(false);
    expect(roomContains(room, { x: 5000, y: 2100 })).toBe(false);
  });

  it('does not depend on winding', () => {
    const reversed = { ...room, outline: room.outline.toReversed() };
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 4700 }),
        fc.integer({ min: -500, max: 4700 }),
        (x, y) => {
          expect(roomContains(reversed, { x, y })).toBe(roomContains(room, { x, y }));
        },
      ),
    );
  });

  it('never reports a point outside the bounding box as inside', () => {
    const bounds = roomBounds(room);
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 8000 }),
        fc.integer({ min: -2000, max: 8000 }),
        (x, y) => {
          const outsideBox =
            x < bounds.x || y < bounds.y || x > bounds.x + bounds.w || y > bounds.y + bounds.d;
          if (outsideBox) expect(roomContains(room, { x, y })).toBe(false);
        },
      ),
    );
  });
});
