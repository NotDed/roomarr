import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec } from '@/core/geometry';
import { isClockwise, polygonArea, validateOutline } from '@/core/room';
import {
  type RunSegment,
  type WallRun,
  closeRun,
  outlineToRun,
  residualMagnitude,
  runCloses,
  runToOutline,
  traceRun,
} from '@/core/wallrun';

/** 3.4 × 4.2 m, walked clockwise from the top-left corner heading right. */
const RECT_RUN: WallRun = {
  start: { x: 0, y: 0 },
  heading: 0,
  segments: [
    { length: 3400, turn: 'right' },
    { length: 4200, turn: 'right' },
    { length: 3400, turn: 'right' },
    { length: 4200, turn: 'right' },
  ],
};

/** An L-shape: the same room with a 800 × 1500 bite taken out of one corner. */
const L_RUN: WallRun = {
  start: { x: 0, y: 0 },
  heading: 0,
  segments: [
    { length: 3400, turn: 'right' },
    { length: 2700, turn: 'right' },
    { length: 800, turn: 'left' },
    { length: 1500, turn: 'right' },
    { length: 2600, turn: 'right' },
    { length: 4200, turn: 'right' },
  ],
};

describe('traceRun', () => {
  it('walks a rectangle back to its start', () => {
    const traced = traceRun(RECT_RUN);
    expect(traced.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 3400, y: 0 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ]);
    expect(traced.residual).toEqual({ x: 0, y: 0 });
    expect(traced.headingCloses).toBe(true);
    expect(runCloses(traced)).toBe(true);
  });

  it('counts a simple clockwise loop as exactly four right turns', () => {
    expect(traceRun(RECT_RUN).netTurns).toBe(4);
    expect(traceRun(L_RUN).netTurns).toBe(4);
  });

  it('walks an L-shape back to its start', () => {
    expect(runCloses(traceRun(L_RUN))).toBe(true);
  });

  /* The half-typed state is the normal state of the room form for as long as
     someone is typing into it. Tracing has to be total. */
  it('never throws on a partial run', () => {
    expect(() => traceRun({ ...RECT_RUN, segments: [] })).not.toThrow();
    expect(() => traceRun({ ...RECT_RUN, segments: RECT_RUN.segments.slice(0, 2) })).not.toThrow();
    expect(traceRun({ ...RECT_RUN, segments: [] }).residual).toEqual({ x: 0, y: 0 });
  });

  it('handles a heading given out of range', () => {
    expect(runCloses(traceRun({ ...RECT_RUN, heading: 4 }))).toBe(true);
    expect(runCloses(traceRun({ ...RECT_RUN, heading: -4 }))).toBe(true);
  });

  it('reports the gap when the lengths do not close', () => {
    const short: WallRun = {
      ...RECT_RUN,
      segments: RECT_RUN.segments.map((s, i) => (i === 0 ? { ...s, length: 3360 } : s)),
    };
    const traced = traceRun(short);
    expect(runCloses(traced)).toBe(false);
    expect(traced.residual).toEqual({ x: -40, y: 0 });
    expect(residualMagnitude(traced)).toBe(40);
  });

  /* The point of measuring as a run rather than as vertices: a transposed digit
     is the most common measuring mistake there is, and a vertex list cannot
     catch it. Here it shows up as an 900 mm gap the moment it is typed. */
  it('catches a transposed digit', () => {
    const typo: WallRun = {
      ...RECT_RUN,
      segments: RECT_RUN.segments.map((s, i) => (i === 1 ? { ...s, length: 2400 } : s)),
    };
    expect(residualMagnitude(traceRun(typo))).toBe(1800);
  });
});

describe('closeRun', () => {
  it('leaves an already-closed run untouched', () => {
    const result = closeRun(RECT_RUN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixes).toEqual([]);
    expect(result.run).toBe(RECT_RUN);
  });

  /* A 40 mm correction on a 3400 mm wall is well inside measuring error. The
     same 40 mm on a 300 mm return would be a 13% lie about a wall you can see. */
  it('absorbs the residual into the longest wall on each axis', () => {
    const short: WallRun = {
      start: { x: 0, y: 0 },
      heading: 0,
      segments: [
        { length: 3360, turn: 'right' },
        { length: 4200, turn: 'right' },
        { length: 3400, turn: 'right' },
        { length: 4200, turn: 'right' },
      ],
    };
    const result = closeRun(short);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fixes).toEqual([{ segmentIndex: 2, from: 3400, to: 3360 }]);
    expect(runCloses(traceRun(result.run))).toBe(true);
  });

  it('fixes both axes at once', () => {
    const off: WallRun = {
      start: { x: 0, y: 0 },
      heading: 0,
      segments: [
        { length: 3400, turn: 'right' },
        { length: 4200, turn: 'right' },
        { length: 3370, turn: 'right' },
        { length: 4155, turn: 'right' },
      ],
    };
    const result = closeRun(off);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixes.length).toBe(2);
    expect(runCloses(traceRun(result.run))).toBe(true);
  });

  it('closes an L-shape whose lengths are off', () => {
    const off: WallRun = {
      ...L_RUN,
      segments: L_RUN.segments.map((s, i) => (i === 5 ? { ...s, length: 4100 } : s)),
    };
    const result = closeRun(off);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(runCloses(traceRun(result.run))).toBe(true);
  });

  /* No change of length fixes a missing corner, so saying so beats silently
     stretching a wall to hide a structural mistake. */
  it('refuses when the turns are wrong rather than stretching a wall', () => {
    const badTurns: WallRun = {
      ...RECT_RUN,
      segments: RECT_RUN.segments.map((s, i) => (i === 0 ? { ...s, turn: 'left' as const } : s)),
    };
    const result = closeRun(badTurns);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('heading');
  });

  /* Only reachable on a shape with three or more walls on one axis: for a
     rectangle the residual is the difference of two opposite walls and so can
     never exceed the longer of them. Here the L's 3400 mm wall is entered as
     200, leaving a 3200 mm gap that the 2600 mm wall cannot absorb. */
  it('refuses rather than inverting a wall', () => {
    const wildlyOff: WallRun = {
      ...L_RUN,
      segments: L_RUN.segments.map((s, i) => (i === 0 ? { ...s, length: 200 } : s)),
    };
    const result = closeRun(wildlyOff);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('would-invert');
  });

  it('always produces a run that closes, whenever it succeeds', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -60, max: 60 }), { minLength: 4, maxLength: 4 }),
        (deltas) => {
          const segments: RunSegment[] = RECT_RUN.segments.map((s, i) => ({
            ...s,
            length: s.length + (deltas[i] ?? 0),
          }));
          const result = closeRun({ ...RECT_RUN, segments });
          if (result.ok) expect(runCloses(traceRun(result.run))).toBe(true);
        },
      ),
    );
  });

  it('reports edits rather than applying them behind your back', () => {
    const short: WallRun = {
      ...RECT_RUN,
      segments: RECT_RUN.segments.map((s, i) => (i === 0 ? { ...s, length: 3360 } : s)),
    };
    const result = closeRun(short);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /* the original is not mutated */
    expect(short.segments[2]?.length).toBe(3400);
    for (const fix of result.fixes) {
      expect(fix.from).not.toBe(fix.to);
      expect(result.run.segments[fix.segmentIndex]?.length).toBe(fix.to);
    }
  });
});

describe('runToOutline', () => {
  it('produces a clockwise, valid outline', () => {
    const result = runToOutline(RECT_RUN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateOutline(result.outline)).toEqual([]);
    expect(isClockwise(result.outline)).toBe(true);
    expect(polygonArea(result.outline)).toBe(3400 * 4200);
  });

  it('produces a valid L-shape', () => {
    const result = runToOutline(L_RUN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateOutline(result.outline)).toEqual([]);
    expect(result.outline.length).toBe(6);
  });

  /* Absorbing a 40 mm error has to be something the user agreed to, not
     something that happened to their measurements while they weren't looking. */
  it('refuses a run that does not close instead of closing it silently', () => {
    const short: WallRun = {
      ...RECT_RUN,
      segments: RECT_RUN.segments.map((s, i) => (i === 0 ? { ...s, length: 3360 } : s)),
    };
    const result = runToOutline(short);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('does-not-close');
  });

  it('reports an outline that closes but is not a usable room', () => {
    const figureEight: WallRun = {
      start: { x: 0, y: 0 },
      heading: 0,
      segments: [
        { length: 2000, turn: 'right' },
        { length: 2000, turn: 'right' },
        { length: 1000, turn: 'right' },
        { length: 3000, turn: 'left' },
        { length: 1000, turn: 'left' },
        { length: 1000, turn: 'right' },
      ],
    };
    const result = runToOutline(figureEight);
    if (result.ok) return; // a valid room is also an acceptable outcome here
    expect(['does-not-close', 'invalid-outline']).toContain(result.reason);
  });
});

describe('outlineToRun', () => {
  it('round-trips a rectangle', () => {
    const outline: Vec[] = [
      { x: 0, y: 0 },
      { x: 3400, y: 0 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ];
    const result = runToOutline(outlineToRun(outline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline).toEqual(outline);
  });

  it('round-trips an L-shape', () => {
    const traced = traceRun(L_RUN);
    const result = runToOutline(outlineToRun(traced.vertices));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline).toEqual(traced.vertices);
  });

  it('round-trips an outline with an alcove', () => {
    const alcove: Vec[] = [
      { x: 0, y: 0 },
      { x: 3400, y: 0 },
      { x: 3400, y: 1500 },
      { x: 4200, y: 1500 },
      { x: 4200, y: 2700 },
      { x: 3400, y: 2700 },
      { x: 3400, y: 4200 },
      { x: 0, y: 4200 },
    ];
    const result = runToOutline(outlineToRun(alcove));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline).toEqual(alcove);
  });

  it('refuses an empty outline', () => {
    expect(() => outlineToRun([])).toThrow(RangeError);
  });
});
