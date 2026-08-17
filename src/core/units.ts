/**
 * Every length in roomarr is an integer number of millimetres.
 *
 * Millimetres because that is the unit tape measures and furniture spec sheets
 * already use, so no conversion happens between what someone reads off a wall
 * and what gets stored. Integers because the grid arithmetic downstream
 * (25 mm and 50 mm cells) has to be exact — the rasterizer's guarantee that "a
 * cell is inside iff its centre is inside" is only true if centres land on
 * exact values, and a float creeping in turns a deterministic metric into one
 * that disagrees with itself between runs.
 *
 * `Mm` is a plain alias rather than a branded type. Branding would force a cast
 * at every arithmetic site to catch a bug class the golden tests already catch
 * directly, and the friction shows up in the geometry code that most needs to
 * stay readable.
 */
export type Mm = number;

/** Square millimetres. Areas get big — a 4×3 m room is 12,000,000 — but stay
 *  far inside the safe integer range, so no scaling is needed. */
export type Mm2 = number;

export const MM_PER_CM = 10;
export const MM_PER_M = 1000;
export const MM2_PER_M2 = 1_000_000;

/** How a length is shown. Storage is always mm regardless of this. */
export type DisplayUnit = 'mm' | 'cm' | 'm';

// ── Guards ────────────────────────────────────────────────────────────────

/**
 * True for values that are safe to use as a length: finite, integral, and
 * within a range where `mm²` products cannot lose precision.
 *
 * The bound is deliberately far below `Number.MAX_SAFE_INTEGER`. Squared
 * distances are compared as `distSqCells * cell * cell >= rMm * rMm`, so the
 * real constraint is that intermediate products stay exact, not that the length
 * itself fits. 100 km of wall is not a room.
 */
export const MAX_MM = 100_000_000;

export function isMm(value: unknown): value is Mm {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_MM;
}

/**
 * Throws unless `value` is a usable millimetre length.
 *
 * Used at the boundaries where numbers enter core — parsing user input, loading
 * a saved document — rather than sprinkled through the hot paths. A fractional
 * millimetre that gets past here does not crash; it silently shifts a rasterized
 * cell boundary and the resulting blueprint is wrong by a cell, which is exactly
 * the kind of failure nobody notices until they have moved a wardrobe.
 */
export function assertMm(value: unknown, what = 'length'): asserts value is Mm {
  if (!isMm(value)) {
    throw new TypeError(
      `${what} must be an integer number of millimetres within ±${MAX_MM}, got ${String(value)}`,
    );
  }
}

// ── Rounding ──────────────────────────────────────────────────────────────

/**
 * Round to the nearest integer millimetre, breaking ties away from zero.
 *
 * `Math.round` breaks ties toward +Infinity, which is not symmetric about the
 * origin: a shape mirrored across an axis would round differently on each side
 * and the two halves would disagree by a millimetre. The metric's
 * rotation/mirror invariance property test depends on this being symmetric.
 *
 * Negative zero is normalised away, and that is not pedantry. `-0` compares
 * equal under `===` but not under `Object.is`, so it lands in a different slot
 * of the layout dedup hash than `0` and the optimizer would treat two identical
 * layouts as distinct. It also survives arithmetic but *not* a JSON round trip,
 * which would break the guarantee that exporting and re-importing a document
 * gives back exactly what was saved.
 */
export function roundMm(value: number): Mm {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** Round to the nearest multiple of `step`, ties away from zero. */
export function snapMm(value: number, step: Mm): Mm {
  if (step <= 0) throw new RangeError(`snap step must be positive, got ${step}`);
  return roundMm(value / step) * step;
}

/** Clamp into `[min, max]`. */
export function clampMm(value: Mm, min: Mm, max: Mm): Mm {
  if (min > max) throw new RangeError(`clamp range is inverted: [${min}, ${max}]`);
  return value < min ? min : value > max ? max : value;
}

// ── Conversion ────────────────────────────────────────────────────────────

export function cmToMm(cm: number): Mm {
  return roundMm(cm * MM_PER_CM);
}

export function mToMm(m: number): Mm {
  return roundMm(m * MM_PER_M);
}

export function mmToCm(mm: Mm): number {
  return mm / MM_PER_CM;
}

export function mmToM(mm: Mm): number {
  return mm / MM_PER_M;
}

export function mm2ToM2(mm2: Mm2): number {
  return mm2 / MM2_PER_M2;
}

// ── Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a length a person typed, in the unit they are currently working in.
 *
 * Accepts an explicit unit suffix regardless of `unit`, so someone working in
 * centimetres can type `3.4m` for a wall and get 3400 rather than 34. That is
 * not a nicety: room dimensions are naturally spoken in metres while furniture
 * is spoken in centimetres, and forcing one unit on both is how a wall ends up
 * entered two orders of magnitude wrong.
 *
 * Returns `null` for anything unparseable — callers surface that as a field
 * error rather than substituting a guess.
 */
export function parseLength(input: string, unit: DisplayUnit): Mm | null {
  const text = input.trim().toLowerCase().replace(',', '.');
  if (text === '') return null;

  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)?$/.exec(text);
  if (!match) return null;

  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;

  const effective = (match[2] as DisplayUnit | undefined) ?? unit;
  const mm =
    effective === 'mm'
      ? magnitude
      : effective === 'cm'
        ? magnitude * MM_PER_CM
        : magnitude * MM_PER_M;

  const rounded = roundMm(mm);
  return isMm(rounded) ? rounded : null;
}

// ── Formatting ────────────────────────────────────────────────────────────

/** Drop trailing zeros from a fixed-decimal string: `3.40` → `3.4`, `3.00` → `3`. */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * Format a length for display, without a unit suffix. Pair with `unitLabel`.
 *
 * Precision is fixed per unit rather than adaptive so that a column of numbers
 * lines up: mm whole, cm to one decimal, m to two. A room measured with a tape
 * does not support more than that, and showing more implies a confidence the
 * input cannot back.
 */
export function formatLength(mm: Mm, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm':
      return String(roundMm(mm));
    case 'cm':
      return trimZeros(mmToCm(mm).toFixed(1));
    case 'm':
      return trimZeros(mmToM(mm).toFixed(2));
  }
}

export function unitLabel(unit: DisplayUnit): string {
  return unit;
}

/** Format with its unit: `formatLengthWithUnit(3400, 'm')` → `"3.4 m"`. */
export function formatLengthWithUnit(mm: Mm, unit: DisplayUnit): string {
  return `${formatLength(mm, unit)} ${unitLabel(unit)}`;
}

/**
 * Format an area in m², to one decimal place.
 *
 * One decimal, always — see `README.md`. A walkable figure derived from wall
 * measurements taken with a tape carries something like ±0.2 m² of real
 * uncertainty, so "6.42 m²" claims a precision the input cannot support and
 * quietly invites the user to trust a difference that is inside the noise.
 */
export function formatAreaM2(mm2: Mm2): string {
  return mm2ToM2(mm2).toFixed(1);
}
