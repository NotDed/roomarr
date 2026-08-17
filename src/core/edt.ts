/**
 * Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
 *
 * Two linear passes — down the columns, then across the rows — each computing
 * the lower envelope of a set of parabolas. Exact, and O(n) in the number of
 * cells regardless of how far anything is from anything else.
 *
 * ── What this is for, and what it is deliberately not for ─────────────────
 *
 * This is used for the **dilate-back** step only: growing the reachable set
 * back out by the body radius, where the thing being measured from is a set of
 * *cells* rather than a set of rectangles, so there is no closed form to use
 * instead.
 *
 * Erosion does **not** go through here. See `clearance.ts` — measuring distance
 * to the nearest blocked *cell* quantizes clearance to multiples of the cell
 * size, which is ±50 mm of error on a hard "is this corridor 700 mm" verdict.
 * Dilation is the forgiving direction: an error there softens the boundary of a
 * reported region by a cell, it cannot flip a feasibility verdict.
 *
 * A chamfer or 3-4-5 approximation would be cheaper and is rejected for the
 * same reason: its 2–4% anisotropy is direction-dependent, so a corridor would
 * measure differently depending on which way it ran.
 */

/** Larger than any real squared distance, and small enough to square safely. */
const FAR = 1e12;

/**
 * One-dimensional squared distance transform of a sampled function.
 *
 * `f[i]` is the cost at position i; the result is
 * `min over j of (f[j] + (i − j)²)`. The lower envelope is built by tracking
 * the parabolas that are visible from below and the boundaries between them.
 */
export function edt1d(f: Float64Array, out: Float64Array, n: number): void {
  /* v[k] — the location of the k-th parabola in the envelope.
     z[k] — the boundary between parabola k−1 and k. */
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;

  for (let q = 1; q < n; q++) {
    const fq = f[q] ?? FAR;
    let s = 0;

    for (;;) {
      const vk = v[k] ?? 0;
      const fv = f[vk] ?? FAR;
      s = (fq + q * q - (fv + vk * vk)) / (2 * q - 2 * vk);
      if (s > (z[k] ?? -FAR)) break;
      k--;
      if (k < 0) {
        k = 0;
        break;
      }
    }

    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? FAR) < q) k++;
    const vk = v[k] ?? 0;
    const d = q - vk;
    out[q] = d * d + (f[vk] ?? FAR);
  }
}

/**
 * Squared distance, in **cell units**, from every cell to the nearest set cell
 * of `seeds`.
 *
 * Cells that are themselves seeds get 0. If there are no seeds at all, every
 * cell gets `FAR` rather than a wrong finite value.
 */
export function edt2d(seeds: Uint8Array, w: number, h: number): Float64Array {
  const f = new Float64Array(Math.max(w, h));
  const t = new Float64Array(Math.max(w, h));
  const result = new Float64Array(w * h);

  /* Columns first. */
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = seeds[y * w + x] !== 0 ? 0 : FAR;
    edt1d(f, t, h);
    for (let y = 0; y < h; y++) result[y * w + x] = t[y] ?? FAR;
  }

  /* Then rows, over the column result. */
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = result[row + x] ?? FAR;
    edt1d(f, t, w);
    for (let x = 0; x < w; x++) result[row + x] = t[x] ?? FAR;
  }

  return result;
}

/**
 * Brute-force reference, for tests only.
 *
 * O(n²) and unusable in anger, but it is the thing that makes the fast version
 * trustworthy: the property test asserts they agree exactly on random masks,
 * which is a far stronger statement than any hand-written expectation about the
 * lower-envelope arithmetic could be.
 */
export function edt2dBrute(seeds: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = FAR;
      for (let sy = 0; sy < h; sy++) {
        for (let sx = 0; sx < w; sx++) {
          if (seeds[sy * w + sx] === 0) continue;
          const dx = x - sx;
          const dy = y - sy;
          const d = dx * dx + dy * dy;
          if (d < best) best = d;
        }
      }
      out[y * w + x] = best;
    }
  }

  return out;
}

export const EDT_FAR = FAR;
