import type { Vec } from '@/core/geometry';
import { type OutlineProblem, validateOutline } from '@/core/room';
import type { Mm } from '@/core/units';

/**
 * A room described the way a person standing in it with a tape measure would
 * describe it: "starting at the door, going clockwise — 3400, turn right, 1200,
 * turn left, 800, …".
 *
 * This is the primary room-entry model, not a convenience wrapper over vertex
 * editing. Someone measuring an L-shaped room has an ordered list of wall
 * lengths and turns. They do *not* have a decomposition of their room into a
 * base rectangle minus a notch, and asking them to produce one is where room
 * entry gets abandoned. Alcove and bay templates exist as shortcuts on top of
 * this, never instead of it.
 *
 * The other reason this shape matters: a wall run is over-determined for a
 * closed room, so the arithmetic can be checked against itself. If the lengths
 * do not bring you back to where you started, something was mistyped — and a
 * transposed digit (3400 entered as 4300) is the most common measuring error
 * there is. A vertex list cannot catch that; a wall run catches it for free.
 */

/** Which way you turn at the end of a segment. */
export type Turn = 'left' | 'right';

export interface RunSegment {
  length: Mm;
  /** The turn taken at the END of this segment, before the next one. */
  turn: Turn;
}

export interface WallRun {
  /** Where the first segment starts. Usually a door corner. */
  start: Vec;
  /**
   * Heading of the first segment as a quarter-turn index:
   * 0 = +x (right), 1 = +y (down), 2 = -x (left), 3 = -y (up).
   */
  heading: number;
  segments: RunSegment[];
}

/** Unit step for each heading index, in y-down screen coordinates. */
const STEPS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function step(heading: number): Vec {
  return STEPS[((heading % 4) + 4) % 4] ?? { x: 1, y: 0 };
}

/** Turning right advances the heading clockwise, which is +1 in y-down. */
function applyTurn(heading: number, turn: Turn): number {
  return (((heading + (turn === 'right' ? 1 : -1)) % 4) + 4) % 4;
}

// ── Tracing ───────────────────────────────────────────────────────────────

export interface TracedRun {
  /** One vertex per segment start, in order. Never closed for you. */
  vertices: Vec[];
  /**
   * How far the last segment's end misses the start point. `{x:0, y:0}` means
   * the run closes exactly.
   */
  residual: Vec;
  /** True when the final heading matches the starting one. */
  headingCloses: boolean;
  /** Net quarter turns. A simple closed rectilinear loop is exactly ±4. */
  netTurns: number;
}

/**
 * Walk a run and report where it ends up, without trying to fix anything.
 *
 * Deliberately total: it never throws and never rejects. A half-typed room is
 * the normal state of the room form for as long as someone is typing into it,
 * and the residual is the live feedback that makes the form worth using.
 */
export function traceRun(run: WallRun): TracedRun {
  const vertices: Vec[] = [];
  let at: Vec = { x: run.start.x, y: run.start.y };
  let heading = ((run.heading % 4) + 4) % 4;
  let netTurns = 0;

  for (const segment of run.segments) {
    vertices.push({ x: at.x, y: at.y });
    const dir = step(heading);
    at = { x: at.x + dir.x * segment.length, y: at.y + dir.y * segment.length };
    heading = applyTurn(heading, segment.turn);
    netTurns += segment.turn === 'right' ? 1 : -1;
  }

  return {
    vertices,
    residual: { x: at.x - run.start.x, y: at.y - run.start.y },
    headingCloses: heading === ((run.heading % 4) + 4) % 4,
    netTurns,
  };
}

export function runCloses(traced: TracedRun): boolean {
  return traced.residual.x === 0 && traced.residual.y === 0 && traced.headingCloses;
}

/** Straight-line size of the closure gap, for display. */
export function residualMagnitude(traced: TracedRun): Mm {
  return Math.round(Math.hypot(traced.residual.x, traced.residual.y));
}

// ── Closing the gap ───────────────────────────────────────────────────────

export interface ClosureFix {
  /** Index of the segment to adjust. */
  segmentIndex: number;
  /** Its current length. */
  from: Mm;
  /** What it becomes. */
  to: Mm;
}

export type ClosureResult =
  | { ok: true; run: WallRun; fixes: ClosureFix[] }
  | { ok: false; reason: 'heading' | 'no-horizontal' | 'no-vertical' | 'would-invert' };

/**
 * Absorb a closure residual by adjusting one horizontal and one vertical
 * segment, so the run closes exactly.
 *
 * The residual's x component can only be taken up by segments running along x,
 * and likewise for y — so this is two independent one-dimensional fixes, not a
 * search. The longest segment on each axis is chosen because a 40 mm correction
 * spread onto a 3400 mm wall is well inside measuring error, while the same
 * 40 mm on a 300 mm return would be a 13% lie about a wall someone can see.
 *
 * This never silently rewrites anything: it returns the specific edits so the
 * form can say "your walls miss closing by 40 mm — take it off the 3400 mm
 * wall?" and let the person confirm or go re-measure.
 */
export function closeRun(run: WallRun): ClosureResult {
  const traced = traceRun(run);

  /* A residual can be absorbed by stretching walls. A heading that does not
     come back around means the *turns* are wrong — a missing or spurious
     corner — and no change of length will fix that. */
  if (!traced.headingCloses) return { ok: false, reason: 'heading' };
  if (runCloses(traced)) return { ok: true, run, fixes: [] };

  let heading = ((run.heading % 4) + 4) % 4;
  let longestH = -1;
  let longestV = -1;
  const signOf: number[] = [];

  for (const [i, segment] of run.segments.entries()) {
    const dir = step(heading);
    const axis = dir.x === 0 ? 'y' : 'x';
    signOf.push(axis === 'x' ? dir.x : dir.y);

    if (axis === 'x') {
      const best = longestH < 0 ? -1 : (run.segments[longestH]?.length ?? -1);
      if (segment.length > best) longestH = i;
    } else {
      const best = longestV < 0 ? -1 : (run.segments[longestV]?.length ?? -1);
      if (segment.length > best) longestV = i;
    }

    heading = applyTurn(heading, segment.turn);
  }

  if (traced.residual.x !== 0 && longestH < 0) return { ok: false, reason: 'no-horizontal' };
  if (traced.residual.y !== 0 && longestV < 0) return { ok: false, reason: 'no-vertical' };

  const segments = run.segments.map((s) => ({ ...s }));
  const fixes: ClosureFix[] = [];

  for (const [index, residual] of [
    [longestH, traced.residual.x],
    [longestV, traced.residual.y],
  ] as const) {
    if (index < 0 || residual === 0) continue;

    const segment = segments[index];
    const sign = signOf[index];
    if (segment === undefined || sign === undefined) continue;

    /* The segment points along `sign`; removing `residual` from the endpoint
       means shortening by `residual * sign`. */
    const to = segment.length - residual * sign;
    if (to <= 0) return { ok: false, reason: 'would-invert' };

    fixes.push({ segmentIndex: index, from: segment.length, to });
    segment.length = to;
  }

  return { ok: true, run: { ...run, segments }, fixes };
}

// ── Alcoves, bays and notches ─────────────────────────────────────────────

/**
 * Which way the recess goes, seen from inside the room.
 *
 * `out` pushes the wall away and gains floor — an alcove, a bay window, the
 * space beside a chimney breast. `in` eats into the room — a boxed-in soil
 * pipe, a chimney breast itself, a bulkhead.
 */
export type RecessDirection = 'out' | 'in';

export type RecessResult =
  | { ok: true; run: WallRun }
  | {
      ok: false;
      reason: 'no-such-wall' | 'not-positive' | 'too-wide' | 'needs-margin';
      /** How much wall is available on the chosen segment. */
      wallLength?: Mm;
    };

/**
 * Cut a rectangular recess into one wall of a run.
 *
 * Walking a run clockwise puts the room's interior **on your right** — facing
 * east along the top wall, the room is to the south. So pushing a wall outward
 * means turning left, and biting into the room means turning right. Everything
 * else follows from that one fact.
 *
 * The four inserted turns are `left, right, right, left` (or the mirror), which
 * sum to zero: a recess never changes how many net turns the run has, so a run
 * that closed before still closes after.
 *
 * This is what makes alcoves, L-shapes and bay windows a template rather than a
 * geometry exercise. A stepped bay is just this applied twice.
 */
export function insertRecess(
  run: WallRun,
  segmentIndex: number,
  options: { offset: Mm; width: Mm; depth: Mm; direction: RecessDirection },
): RecessResult {
  const target = run.segments[segmentIndex];
  if (target === undefined) return { ok: false, reason: 'no-such-wall' };

  const { offset, width, depth, direction } = options;
  if (width <= 0 || depth <= 0 || offset < 0) return { ok: false, reason: 'not-positive' };
  if (offset + width > target.length) {
    return { ok: false, reason: 'too-wide', wallLength: target.length };
  }

  /* A recess flush against a corner would produce a zero-length wall, which is
     not a room the rest of the codebase can reason about. Rather than silently
     nudging it a millimetre, say so — the user can move it, or edit the run
     directly if the recess really does start at the corner. */
  const after = target.length - offset - width;
  if (offset === 0 || after === 0) return { ok: false, reason: 'needs-margin' };

  const away: Turn = direction === 'out' ? 'left' : 'right';
  const back: Turn = direction === 'out' ? 'right' : 'left';

  const inserted: RunSegment[] = [
    { length: offset, turn: away },
    { length: depth, turn: back },
    { length: width, turn: back },
    { length: depth, turn: away },
    { length: after, turn: target.turn },
  ];

  return {
    ok: true,
    run: {
      ...run,
      segments: [
        ...run.segments.slice(0, segmentIndex),
        ...inserted,
        ...run.segments.slice(segmentIndex + 1),
      ],
    },
  };
}

// ── Conversion ────────────────────────────────────────────────────────────

export type RunToOutlineResult =
  | { ok: true; outline: Vec[] }
  | { ok: false; reason: 'does-not-close'; traced: TracedRun }
  | { ok: false; reason: 'invalid-outline'; outline: Vec[]; problems: OutlineProblem[] };

/**
 * Turn a closed run into a room outline.
 *
 * Requires exact closure — `closeRun` is the way to get there, and it is a
 * separate step on purpose so that absorbing a 40 mm error is always something
 * the user agreed to rather than something that happened to their measurements
 * while they weren't looking.
 */
export function runToOutline(run: WallRun): RunToOutlineResult {
  const traced = traceRun(run);
  if (!runCloses(traced)) return { ok: false, reason: 'does-not-close', traced };

  const outline = traced.vertices;
  const problems = validateOutline(outline);
  if (problems.length > 0) return { ok: false, reason: 'invalid-outline', outline, problems };

  return { ok: true, outline };
}

/**
 * Describe an existing outline as a wall run, so a room built any other way
 * (a rectangle, an imported document, an alcove template) can be edited in the
 * same measurement-shaped form.
 */
export function outlineToRun(outline: readonly Vec[]): WallRun {
  const first = outline[0];
  if (first === undefined) throw new RangeError('outlineToRun needs at least one vertex');

  const headings: number[] = [];
  const lengths: Mm[] = [];

  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a === undefined || b === undefined) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    headings.push(dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3);
    lengths.push(Math.abs(dx) + Math.abs(dy));
  }

  const segments: RunSegment[] = headings.map((heading, i) => {
    const next = headings[(i + 1) % headings.length] ?? heading;
    return { length: lengths[i] ?? 0, turn: (next - heading + 4) % 4 === 1 ? 'right' : 'left' };
  });

  return { start: { x: first.x, y: first.y }, heading: headings[0] ?? 0, segments };
}
