/**
 * A seeded pseudo-random number generator.
 *
 * Core is a deterministic library and `tests/core-boundary.test.ts` bans
 * `Math.random` outright, so this is required rather than preferred. The
 * consequence is worth having on its own: every search result is replayable
 * from its seed, which means a layout someone disagrees with can be
 * reproduced exactly rather than argued about from memory.
 *
 * mulberry32 — small, fast, and good enough for choosing between furniture
 * positions. This is not cryptography and does not pretend to be.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). Returns 0 when `max` is not positive. */
  int(max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** A random element, or undefined when the list is empty. */
  pick<T>(list: readonly T[]): T | undefined;
}

export function makeRng(seed: number): Rng {
  /* Force to a 32-bit integer so a fractional or huge seed still behaves. */
  let state = Math.trunc(seed) | 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (max) => (max > 0 ? Math.floor(next() * max) : 0),
    chance: (p) => next() < p,
    pick: (list) => (list.length === 0 ? undefined : list[Math.floor(next() * list.length)]),
  };
}

/**
 * Fisher–Yates, returning a new array.
 *
 * Copies rather than shuffling in place: the caller's array is usually a
 * document the store owns, and quietly reordering it would be a mutation
 * nobody asked for.
 */
export function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
