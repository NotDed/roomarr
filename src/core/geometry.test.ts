import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Pose,
  type Rect,
  type Rot,
  type Size,
  ROTATIONS,
  boundingRect,
  boundingRectOfPoints,
  distSq,
  inflateRect,
  isRot,
  normalizeRot,
  pointToRectDistSq,
  poseCenter,
  poseRect,
  posesEqual,
  rectArea,
  rectContainsPoint,
  rectContainsRect,
  rectOverlapArea,
  rectsOverlap,
  rotateAbout,
  rotatedSize,
  swapsAxes,
  translatePose,
} from '@/core/geometry';
import { isMm } from '@/core/units';

const arbRot = fc.constantFrom<Rot>(0, 1, 2, 3);
const arbMm = fc.integer({ min: -20_000, max: 20_000 });
const arbDim = fc.integer({ min: 1, max: 5_000 });
const arbSize: fc.Arbitrary<Size> = fc.record({ w: arbDim, d: arbDim });
const arbPose: fc.Arbitrary<Pose> = fc.record({ x: arbMm, y: arbMm, rot: arbRot });
const arbRect: fc.Arbitrary<Rect> = fc.record({ x: arbMm, y: arbMm, w: arbDim, d: arbDim });

describe('rotation', () => {
  it('recognises only quarter turns', () => {
    expect(ROTATIONS.every(isRot)).toBe(true);
    expect(isRot(4)).toBe(false);
    expect(isRot(90)).toBe(false);
    expect(isRot(-1)).toBe(false);
    expect(isRot(1.5)).toBe(false);
  });

  it('normalises negatives and multiples into 0..3', () => {
    expect(normalizeRot(-1)).toBe(3);
    expect(normalizeRot(-5)).toBe(3);
    expect(normalizeRot(4)).toBe(0);
    expect(normalizeRot(7)).toBe(3);
    expect(normalizeRot(0)).toBe(0);
  });

  it('always lands in range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
        expect(isRot(normalizeRot(n))).toBe(true);
      }),
    );
  });

  it('exchanges width and depth on the odd quarter turns', () => {
    expect(swapsAxes(0)).toBe(false);
    expect(swapsAxes(1)).toBe(true);
    expect(swapsAxes(2)).toBe(false);
    expect(swapsAxes(3)).toBe(true);

    expect(rotatedSize({ w: 1400, d: 600 }, 0)).toEqual({ w: 1400, d: 600 });
    expect(rotatedSize({ w: 1400, d: 600 }, 1)).toEqual({ w: 600, d: 1400 });
    expect(rotatedSize({ w: 1400, d: 600 }, 2)).toEqual({ w: 1400, d: 600 });
    expect(rotatedSize({ w: 1400, d: 600 }, 3)).toEqual({ w: 600, d: 1400 });
  });

  it('preserves footprint area through every rotation', () => {
    fc.assert(
      fc.property(arbSize, arbRot, (size, rot) => {
        const r = rotatedSize(size, rot);
        expect(r.w * r.d).toBe(size.w * size.d);
      }),
    );
  });
});

describe('poses', () => {
  it('places the rotated box at the pose corner', () => {
    const bed: Size = { w: 1400, d: 2000 };
    expect(poseRect({ x: 100, y: 200, rot: 0 }, bed)).toEqual({ x: 100, y: 200, w: 1400, d: 2000 });
    expect(poseRect({ x: 100, y: 200, rot: 1 }, bed)).toEqual({ x: 100, y: 200, w: 2000, d: 1400 });
  });

  it('translates', () => {
    expect(translatePose({ x: 100, y: 200, rot: 2 }, 50, -30)).toEqual({
      x: 150,
      y: 170,
      rot: 2,
    });
  });

  it('compares by value', () => {
    expect(posesEqual({ x: 1, y: 2, rot: 3 }, { x: 1, y: 2, rot: 3 })).toBe(true);
    expect(posesEqual({ x: 1, y: 2, rot: 3 }, { x: 1, y: 2, rot: 0 })).toBe(false);
  });

  /* The whole reason poses store a corner instead of a centre: an odd
     dimension flush against a wall would put the centre on a half millimetre,
     and from there the rasterizer's cell-centre test stops being exact. */
  it('stays on exact millimetres for odd dimensions, where a centre would not', () => {
    const odd: Size = { w: 1401, d: 603 };
    const pose: Pose = { x: 0, y: 0, rot: 0 };
    const rect = poseRect(pose, odd);
    expect(isMm(rect.x)).toBe(true);
    expect(isMm(rect.y)).toBe(true);
    expect(poseCenter(pose, odd).x).toBe(700.5); // ← the value we refuse to store
  });

  it('every reachable pose has integral coordinates', () => {
    fc.assert(
      fc.property(arbPose, arbSize, fc.integer({ min: -8, max: 8 }), (pose, size, turns) => {
        const rotated = rotateAbout(pose, size, turns);
        expect(isMm(rotated.x)).toBe(true);
        expect(isMm(rotated.y)).toBe(true);
        expect(isRot(rotated.rot)).toBe(true);
      }),
    );
  });
});

describe('rotateAbout', () => {
  it('pivots about the footprint centre', () => {
    /* 1400×600 at (1000, 1000) covers x 1000..2400, y 1000..1600; centre
       (1700, 1300). After a quarter turn it is 600×1400 about the same centre,
       so it covers x 1400..2000, y 600..2000. */
    expect(rotateAbout({ x: 1000, y: 1000, rot: 0 }, { w: 1400, d: 600 }, 1)).toEqual({
      x: 1400,
      y: 600,
      rot: 1,
    });
  });

  /* Exactly, for every size including odd ones. Rounding the resulting
     coordinate instead of the shift makes the tie-break direction depend on
     which side of the origin the item is on, so four turns drift a couple of
     millimetres — which shows up in the editor as an item walking across the
     room every time you press R. */
  it('four quarter turns return to exactly the start', () => {
    fc.assert(
      fc.property(arbPose, arbSize, (pose, size) => {
        let p = pose;
        for (let i = 0; i < 4; i++) p = rotateAbout(p, size, 1);
        expect(p).toEqual(pose);
      }),
    );
  });

  it('is exactly reversible: turning back undoes any turn', () => {
    fc.assert(
      fc.property(arbPose, arbSize, fc.integer({ min: -8, max: 8 }), (pose, size, turns) => {
        const there = rotateAbout(pose, size, turns);
        expect(rotateAbout(there, size, -turns)).toEqual(pose);
      }),
    );
  });

  it('does not depend on which side of the origin the item sits', () => {
    const odd: Size = { w: 1401, d: 603 };
    const near = rotateAbout({ x: 10_000, y: 10_000, rot: 0 }, odd, 1);
    const far = rotateAbout({ x: -10_000, y: -10_000, rot: 0 }, odd, 1);
    expect(near.x - 10_000).toBe(far.x + 10_000);
    expect(near.y - 10_000).toBe(far.y + 10_000);
  });

  it('moves the centre by at most half a millimetre in each axis', () => {
    fc.assert(
      fc.property(arbPose, arbSize, fc.integer({ min: -4, max: 4 }), (pose, size, turns) => {
        const before = poseCenter(pose, size);
        const after = poseCenter(rotateAbout(pose, size, turns), size);
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
      }),
    );
  });

  it('is exact for even dimensions', () => {
    fc.assert(
      fc.property(
        arbPose,
        fc.record({
          w: fc.integer({ min: 1, max: 2500 }).map((n) => n * 2),
          d: fc.integer({ min: 1, max: 2500 }).map((n) => n * 2),
        }),
        fc.integer({ min: -4, max: 4 }),
        (pose, size, turns) => {
          const before = poseCenter(pose, size);
          const after = poseCenter(rotateAbout(pose, size, turns), size);
          expect(after).toEqual(before);
        },
      ),
    );
  });
});

describe('rectangle overlap', () => {
  /* Two wardrobes side by side at exactly the same x is a legal and very common
     arrangement. Treating a shared edge as a collision would make the optimizer
     refuse most tidy layouts. */
  it('treats a shared edge as not overlapping', () => {
    const a: Rect = { x: 0, y: 0, w: 1000, d: 1000 };
    const touchingRight: Rect = { x: 1000, y: 0, w: 1000, d: 1000 };
    const touchingCorner: Rect = { x: 1000, y: 1000, w: 1000, d: 1000 };

    expect(rectsOverlap(a, touchingRight)).toBe(false);
    expect(rectsOverlap(a, touchingCorner)).toBe(false);
    expect(rectOverlapArea(a, touchingRight)).toBe(0);
  });

  it('detects a real overlap and measures it', () => {
    const a: Rect = { x: 0, y: 0, w: 1000, d: 1000 };
    const b: Rect = { x: 900, y: 900, w: 1000, d: 1000 };
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectOverlapArea(a, b)).toBe(100 * 100);
  });

  it('overlap is symmetric, and positive area agrees with the boolean', () => {
    fc.assert(
      fc.property(arbRect, arbRect, (a, b) => {
        expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
        expect(rectOverlapArea(a, b)).toBe(rectOverlapArea(b, a));
        expect(rectOverlapArea(a, b) > 0).toBe(rectsOverlap(a, b));
      }),
    );
  });

  it('overlap never exceeds either rectangle', () => {
    fc.assert(
      fc.property(arbRect, arbRect, (a, b) => {
        const shared = rectOverlapArea(a, b);
        expect(shared).toBeLessThanOrEqual(rectArea(a));
        expect(shared).toBeLessThanOrEqual(rectArea(b));
      }),
    );
  });

  it('a rectangle fully overlaps itself', () => {
    fc.assert(
      fc.property(arbRect, (r) => {
        expect(rectOverlapArea(r, r)).toBe(rectArea(r));
        expect(rectContainsRect(r, r)).toBe(true);
      }),
    );
  });
});

describe('containment', () => {
  it('counts a shared edge as contained', () => {
    const outer: Rect = { x: 0, y: 0, w: 1000, d: 1000 };
    expect(rectContainsRect(outer, { x: 0, y: 0, w: 1000, d: 1000 })).toBe(true);
    expect(rectContainsRect(outer, { x: 0, y: 0, w: 1001, d: 1000 })).toBe(false);
  });

  /* Half-open on the max edges so a point cannot belong to two adjacent cells,
     which is what makes the rasterizer's cell ownership unambiguous. */
  it('is half-open for points', () => {
    const r: Rect = { x: 0, y: 0, w: 100, d: 100 };
    expect(rectContainsPoint(r, { x: 0, y: 0 })).toBe(true);
    expect(rectContainsPoint(r, { x: 99, y: 99 })).toBe(true);
    expect(rectContainsPoint(r, { x: 100, y: 50 })).toBe(false);
    expect(rectContainsPoint(r, { x: 50, y: 100 })).toBe(false);
  });
});

describe('inflate', () => {
  it('grows on all four sides', () => {
    expect(inflateRect({ x: 100, y: 100, w: 200, d: 300 }, 50)).toEqual({
      x: 50,
      y: 50,
      w: 300,
      d: 400,
    });
  });

  it('inflating then deflating returns the original', () => {
    fc.assert(
      fc.property(arbRect, fc.integer({ min: 0, max: 500 }), (r, by) => {
        expect(inflateRect(inflateRect(r, by), -by)).toEqual(r);
      }),
    );
  });
});

describe('bounding boxes', () => {
  it('covers every input rectangle', () => {
    expect(
      boundingRect([
        { x: 100, y: 200, w: 100, d: 100 },
        { x: 500, y: 50, w: 100, d: 100 },
      ]),
    ).toEqual({ x: 100, y: 50, w: 500, d: 250 });
  });

  it('refuses an empty list instead of returning a degenerate box', () => {
    expect(() => boundingRect([])).toThrow(RangeError);
    expect(() => boundingRectOfPoints([])).toThrow(RangeError);
  });

  it('contains all of its inputs', () => {
    fc.assert(
      fc.property(fc.array(arbRect, { minLength: 1, maxLength: 12 }), (rects) => {
        const box = boundingRect(rects);
        for (const r of rects) expect(rectContainsRect(box, r)).toBe(true);
      }),
    );
  });

  it('bounds points', () => {
    expect(
      boundingRectOfPoints([
        { x: 0, y: 0 },
        { x: 3400, y: 0 },
        { x: 3400, y: 4200 },
        { x: 0, y: 4200 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 3400, d: 4200 });
  });
});

describe('distance', () => {
  it('is squared and exact for integers', () => {
    expect(distSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
    expect(distSq({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });

  it('is zero for a point inside a rectangle', () => {
    const r: Rect = { x: 0, y: 0, w: 1000, d: 1000 };
    expect(pointToRectDistSq({ x: 500, y: 500 }, r)).toBe(0);
    expect(pointToRectDistSq({ x: 0, y: 0 }, r)).toBe(0);
  });

  it('measures to the nearest edge or corner', () => {
    const r: Rect = { x: 0, y: 0, w: 1000, d: 1000 };
    expect(pointToRectDistSq({ x: 1300, y: 500 }, r)).toBe(300 * 300);
    expect(pointToRectDistSq({ x: -300, y: 500 }, r)).toBe(300 * 300);
    expect(pointToRectDistSq({ x: 1300, y: 1400 }, r)).toBe(300 * 300 + 400 * 400);
  });

  it('never reports a negative distance', () => {
    fc.assert(
      fc.property(fc.record({ x: arbMm, y: arbMm }), arbRect, (p, r) => {
        expect(pointToRectDistSq(p, r)).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
