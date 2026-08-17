import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rect } from '@/core/geometry';
import {
  fitProjector,
  geometryTransform,
  makeProjector,
  sw,
  toModel,
  toPaper,
  toPaperLength,
} from '@/render/projector';

const ROOM: Rect = { x: 0, y: 0, w: 3400, d: 4200 };

describe('fitProjector', () => {
  it('fits content into the viewport with a uniform scale', () => {
    const p = fitProjector(ROOM, { width: 800, height: 600 }, 0);
    /* Depth-limited: 600 / 4200 is smaller than 800 / 3400. */
    expect(p.k).toBeCloseTo(600 / 4200, 12);
  });

  it('centres the content', () => {
    const p = fitProjector(ROOM, { width: 800, height: 600 }, 0);
    const topLeft = toPaper(p, { x: 0, y: 0 });
    const bottomRight = toPaper(p, { x: 3400, y: 4200 });
    expect(topLeft.x + bottomRight.x).toBeCloseTo(800, 6);
    expect(topLeft.y + bottomRight.y).toBeCloseTo(600, 6);
  });

  it('keeps the content inside the margin', () => {
    const p = fitProjector(ROOM, { width: 800, height: 600 }, 40);
    const topLeft = toPaper(p, { x: 0, y: 0 });
    const bottomRight = toPaper(p, { x: 3400, y: 4200 });
    expect(topLeft.x).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(topLeft.y).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(bottomRight.x).toBeLessThanOrEqual(760 + 1e-9);
    expect(bottomRight.y).toBeLessThanOrEqual(560 + 1e-9);
  });

  it('honours a content rectangle that does not start at the origin', () => {
    const offset: Rect = { x: -1000, y: 500, w: 3400, d: 4200 };
    const p = fitProjector(offset, { width: 800, height: 600 }, 20);
    const topLeft = toPaper(p, { x: -1000, y: 500 });
    expect(topLeft.x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(topLeft.y).toBeCloseTo(20, 6);
  });

  it('survives a degenerate viewport rather than producing NaN', () => {
    for (const viewport of [
      { width: 0, height: 0 },
      { width: 10, height: 0 },
      { width: -5, height: 100 },
    ]) {
      const p = fitProjector(ROOM, viewport, 40);
      expect(Number.isFinite(p.k)).toBe(true);
      expect(Number.isFinite(p.ox)).toBe(true);
      expect(Number.isFinite(p.oy)).toBe(true);
    }
  });

  it('survives a degenerate content rectangle', () => {
    const p = fitProjector({ x: 0, y: 0, w: 0, d: 0 }, { width: 800, height: 600 });
    expect(Number.isFinite(p.k)).toBe(true);
  });
});

describe('toPaper / toModel', () => {
  it('round-trips', () => {
    const p = fitProjector(ROOM, { width: 800, height: 600 }, 40);
    fc.assert(
      fc.property(
        fc.integer({ min: -5000, max: 9000 }),
        fc.integer({ min: -5000, max: 9000 }),
        (x, y) => {
          const back = toModel(p, toPaper(p, { x, y }));
          expect(back.x).toBeCloseTo(x, 6);
          expect(back.y).toBeCloseTo(y, 6);
        },
      ),
    );
  });

  it('round-trips at every scale on the printed ladder', () => {
    for (const denominator of [20, 25, 50, 100]) {
      const p = makeProjector(1 / denominator, 12, 18);
      const back = toModel(p, toPaper(p, { x: 3400, y: 4200 }));
      expect(back.x).toBeCloseTo(3400, 6);
      expect(back.y).toBeCloseTo(4200, 6);
    }
  });

  it('scales lengths without applying the offset', () => {
    const p = makeProjector(0.04, 100, 200);
    expect(toPaperLength(p, 1000)).toBeCloseTo(40, 12);
    expect(toPaperLength(p, 0)).toBe(0);
  });
});

describe('sw', () => {
  /* A stroke-width of 1 inside a group scaled by 0.04 renders 0.04 units thick.
     Pre-dividing is what makes a wall look the same weight at 1:25 and 1:100. */
  it('pre-divides so the rendered stroke is the requested paper width', () => {
    const p = makeProjector(0.04, 0, 0);
    expect(sw(p, 0.6)).toBeCloseTo(15, 12);
    expect(sw(p, 0.6) * p.k).toBeCloseTo(0.6, 12);
  });

  it('renders the requested paper width at any scale', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 3, noNaN: true }),
        (k, want) => {
          expect(sw(makeProjector(k, 0, 0), want) * k).toBeCloseTo(want, 9);
        },
      ),
    );
  });

  it('does not divide by zero', () => {
    expect(Number.isFinite(sw(makeProjector(0, 0, 0), 0.6))).toBe(true);
  });
});

describe('geometryTransform', () => {
  it('emits translate-then-scale, in that order', () => {
    expect(geometryTransform(makeProjector(0.04, 12, 18))).toBe('translate(12 18) scale(0.04)');
  });
});
