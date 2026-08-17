import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertMm,
  clampMm,
  cmToMm,
  formatAreaM2,
  formatLength,
  formatLengthWithUnit,
  isMm,
  mToMm,
  mm2ToM2,
  parseLength,
  roundMm,
  snapMm,
  type DisplayUnit,
} from '@/core/units';

const UNITS: DisplayUnit[] = ['mm', 'cm', 'm'];

describe('isMm / assertMm', () => {
  it('accepts integers and rejects everything else', () => {
    expect(isMm(0)).toBe(true);
    expect(isMm(-3400)).toBe(true);
    expect(isMm(3400.5)).toBe(false);
    expect(isMm(Number.NaN)).toBe(false);
    expect(isMm(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isMm('3400')).toBe(false);
    expect(isMm(1e12)).toBe(false);
  });

  it('names the offending value when it throws', () => {
    expect(() => assertMm(0.5, 'wall length')).toThrow(/wall length/);
    expect(() => assertMm(3400)).not.toThrow();
  });
});

describe('roundMm', () => {
  /* Math.round breaks ties toward +Infinity, so a shape mirrored across an axis
     would round differently on each side. The metric's mirror-invariance
     property depends on this being symmetric about zero. */
  it('breaks ties away from zero, symmetrically', () => {
    expect(roundMm(0.5)).toBe(1);
    expect(roundMm(-0.5)).toBe(-1);
    expect(roundMm(1.5)).toBe(2);
    expect(roundMm(-1.5)).toBe(-2);
    expect(roundMm(2.5)).toBe(3);
    expect(roundMm(-2.5)).toBe(-3);
  });

  /* Odd everywhere except at zero, where normalising -0 to 0 deliberately
     wins: `roundMm(-0.2)` is `0`, not `-0`. See the negative-zero test below
     for why that trade is the right way round. */
  it('is odd: round(-x) === -round(x), up to the sign of zero', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        expect(roundMm(-x)).toBe(-roundMm(x) === 0 ? 0 : -roundMm(x));
      }),
    );
  });

  it('always produces a valid millimetre value', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        expect(isMm(roundMm(x))).toBe(true);
      }),
    );
  });

  /* -0 compares equal under === but not under Object.is, so it lands in a
     different slot of the layout dedup hash than 0 and the optimizer would see
     two identical layouts as distinct. It also survives arithmetic but not a
     JSON round trip, which would break byte-identical export/import. */
  it('never produces negative zero', () => {
    expect(Object.is(roundMm(-0.2), 0)).toBe(true);
    expect(Object.is(roundMm(-0), 0)).toBe(true);
    fc.assert(
      fc.property(fc.double({ min: -0.5, max: 0.5, noNaN: true }), (x) => {
        expect(Object.is(roundMm(x), -0)).toBe(false);
      }),
    );
  });
});

describe('snapMm', () => {
  it('snaps to the nearest multiple', () => {
    expect(snapMm(1234, 50)).toBe(1250);
    expect(snapMm(1224, 50)).toBe(1200);
    expect(snapMm(-1234, 50)).toBe(-1250);
    expect(snapMm(0, 50)).toBe(0);
  });

  it('rejects a non-positive step rather than looping or dividing by zero', () => {
    expect(() => snapMm(100, 0)).toThrow(RangeError);
    expect(() => snapMm(100, -50)).toThrow(RangeError);
  });

  it('lands exactly on a multiple of the step, and never moves further than half a step', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.constantFrom(1, 5, 10, 25, 50, 100),
        (value, step) => {
          const snapped = snapMm(value, step);
          expect(Object.is(snapped % step, -0) ? 0 : snapped % step).toBe(0);
          expect(Object.is(snapped, -0)).toBe(false);
          expect(Math.abs(snapped - value)).toBeLessThanOrEqual(step / 2);
        },
      ),
    );
  });
});

describe('clampMm', () => {
  it('clamps into range', () => {
    expect(clampMm(50, 100, 200)).toBe(100);
    expect(clampMm(250, 100, 200)).toBe(200);
    expect(clampMm(150, 100, 200)).toBe(150);
  });

  it('rejects an inverted range instead of silently returning nonsense', () => {
    expect(() => clampMm(150, 200, 100)).toThrow(RangeError);
  });
});

describe('conversion', () => {
  it('converts the units a person actually types', () => {
    expect(cmToMm(340)).toBe(3400);
    expect(mToMm(3.4)).toBe(3400);
    expect(mToMm(2.75)).toBe(2750);
  });

  it('converts area to m²', () => {
    expect(mm2ToM2(12_000_000)).toBe(12);
  });
});

describe('parseLength', () => {
  it('uses the working unit when no suffix is given', () => {
    expect(parseLength('340', 'cm')).toBe(3400);
    expect(parseLength('3.4', 'm')).toBe(3400);
    expect(parseLength('3400', 'mm')).toBe(3400);
  });

  /* Rooms are naturally spoken in metres and furniture in centimetres. Forcing
     one unit on both is how a wall gets entered two orders of magnitude wrong. */
  it('honours an explicit suffix over the working unit', () => {
    expect(parseLength('3.4m', 'cm')).toBe(3400);
    expect(parseLength('340cm', 'm')).toBe(3400);
    expect(parseLength('3400 mm', 'm')).toBe(3400);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseLength('3,4', 'm')).toBe(3400);
  });

  it('tolerates surrounding whitespace and case', () => {
    expect(parseLength('  3.4 M ', 'cm')).toBe(3400);
  });

  it('accepts the shapes people actually type', () => {
    expect(parseLength('.5', 'm')).toBe(500);
    expect(parseLength('2.', 'm')).toBe(2000);
    expect(parseLength('-40', 'cm')).toBe(-400);
  });

  it('returns null rather than guessing', () => {
    for (const bad of ['', '   ', 'abc', '3.4.5', '3ft', '12"', '1/2', '3 4', 'NaN', '1e3']) {
      expect(parseLength(bad, 'cm')).toBeNull();
    }
  });

  it('round-trips every formatted value back to itself', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.constantFrom(...UNITS),
        (mm, unit) => {
          /* mm formats whole and cm to 0.1 cm = 1 mm, so both are lossless. m
             formats to 0.01 m = 10 mm, so only multiples of 10 round-trip. */
          const value = unit === 'm' ? snapMm(mm, 10) : mm;
          expect(parseLength(formatLength(value, unit), unit)).toBe(value);
        },
      ),
    );
  });
});

describe('formatting', () => {
  it('formats at a fixed precision per unit so columns line up', () => {
    expect(formatLength(3400, 'mm')).toBe('3400');
    expect(formatLength(3400, 'cm')).toBe('340');
    expect(formatLength(3400, 'm')).toBe('3.4');
    expect(formatLength(3450, 'm')).toBe('3.45');
    expect(formatLength(3405, 'cm')).toBe('340.5');
  });

  it('drops trailing zeros', () => {
    expect(formatLength(3000, 'm')).toBe('3');
    expect(formatLength(2500, 'm')).toBe('2.5');
    expect(formatLength(1000, 'cm')).toBe('100');
  });

  it('appends the unit label', () => {
    expect(formatLengthWithUnit(3400, 'm')).toBe('3.4 m');
    expect(formatLengthWithUnit(600, 'mm')).toBe('600 mm');
  });

  /* One decimal, always. A walkable figure derived from tape measurements
     carries roughly ±0.2 m² of real uncertainty, so a second decimal claims
     precision the input cannot support and invites trusting a difference that
     is inside the noise. */
  it('formats areas to exactly one decimal', () => {
    expect(formatAreaM2(12_000_000)).toBe('12.0');
    expect(formatAreaM2(6_424_000)).toBe('6.4');
    expect(formatAreaM2(7_806_000)).toBe('7.8');
    expect(formatAreaM2(0)).toBe('0.0');
  });

  it('never emits scientific notation or a bare dot', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.constantFrom(...UNITS),
        (mm, unit) => {
          const text = formatLength(mm, unit);
          expect(text).not.toMatch(/e/i);
          expect(text).not.toMatch(/\.$/);
        },
      ),
    );
  });
});
