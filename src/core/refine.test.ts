import { describe, expect, it } from 'vitest';
import { distance, labelOptions, selectDiverse } from '@/core/archive';
import { itemFromPreset } from '@/core/catalog';
import { hardViolations } from '@/core/constraints';
import type { Feature } from '@/core/features';
import type { Rot } from '@/core/geometry';
import { autoArrange } from '@/core/greedy';
import type { Item, Layout, Placement } from '@/core/items';
import { type RefineCandidate, refineLayout } from '@/core/refine';
import { makeRectangularRoom, roomBounds } from '@/core/room';
import { scoreLayout } from '@/core/score';

const WALL_IDS = ['w0', 'w1', 'w2', 'w3'];
const room = makeRectangularRoom(3400, 4200);
const bounds = roomBounds(room);
const diagonal = Math.hypot(bounds.w, bounds.d);

function door(): Feature {
  return {
    id: 'door',
    kind: 'door',
    wallId: 'w2',
    offset: 1400,
    width: 800,
    blocksFloor: false,
    door: { hinge: 'start', swing: 'in', leafWidth: 800, isPrimary: true },
  };
}

function at(itemId: string, x: number, y: number, rot: Rot = 0, locked = false): Placement {
  return { itemId, pose: { x, y, rot }, locked };
}

function layoutOf(placements: Placement[]): Layout {
  return { id: 'l', name: 'now', kind: 'baseline', placements };
}

const FURNISHED = ['bed', 'wardrobe', 'desk', 'nightstand', 'dresser'] as const;
const items: Item[] = FURNISHED.map((t, i) => itemFromPreset(`i${i}`, t));

/** Everything dumped in the middle — the state a real room is often in. */
const messy = layoutOf(
  items.map((item, i) => at(item.id, 400 + (i % 3) * 500, 500 + Math.floor(i / 3) * 900)),
);

const base = {
  room,
  items,
  features: [door()],
  wallIds: WALL_IDS,
  roomIsSleeping: true,
  seed: 1,
};

const run = (layout: Layout, overrides: Partial<Parameters<typeof refineLayout>[0]> = {}) =>
  refineLayout({ ...base, layout, ...overrides });

/** Score a layout the way the app displays it, not the way the search does. */
const displayed = (layout: Layout) => scoreLayout({ ...base, layout });

describe('refineLayout', () => {
  it('improves a layout that is a mess', () => {
    const result = run(messy);
    const best = result.results[0];
    expect(best).toBeDefined();
    if (best === undefined) return;

    expect(displayed(best.layout).total).toBeGreaterThan(displayed(messy).total);
  });

  /* The search may only ever offer arrangements that work. Verified against the
     constraint checker rather than trusting the search's own bookkeeping. */
  it('only ever returns layouts with nothing wrong with them', () => {
    for (const seed of [1, 2, 3]) {
      const result = run(messy, { seed });
      expect(result.results.length).toBeGreaterThan(0);
      for (const candidate of result.results) {
        const problems = hardViolations(displayed(candidate.layout).violations);
        expect(problems.map((v) => v.message)).toEqual([]);
      }
    }
  });

  /* A starting layout that already breaks rules is not "already the best",
     however it happens to score. The whole point is to escape it. */
  it('does not call an impossible starting layout the best it found', () => {
    const result = run(messy);
    expect(result.baselineFeasible).toBe(false);
    expect(result.keptOriginal).toBe(false);
  });

  it('leaves a good layout alone', () => {
    const good = run(messy).results[0];
    expect(good).toBeDefined();
    if (good === undefined) return;

    const again = run(good.layout);
    const best = again.results[0];
    expect(best).toBeDefined();
    if (best === undefined) return;
    expect(displayed(best.layout).total).toBeGreaterThanOrEqual(
      displayed(good.layout).total - 1e-9,
    );
  });

  /* Greedy is fast and lands somewhere good. Polishing from its answer is what
     turns "usually about as good as greedy" into "never worse than greedy". */
  it('never comes out below the seed it was given', () => {
    const greedy = autoArrange({ ...base, layout: messy });
    const result = run(messy, { seeds: [greedy.layout] });
    const best = result.results[0];
    expect(best).toBeDefined();
    if (best === undefined) return;

    expect(displayed(best.layout).total).toBeGreaterThanOrEqual(
      displayed(greedy.layout).total - 1e-9,
    );
  });

  it('is reproducible from its seed', () => {
    const a = run(messy, { seed: 7 });
    const b = run(messy, { seed: 7 });
    expect(a.results.map((r) => r.layout.placements)).toEqual(
      b.results.map((r) => r.layout.placements),
    );
  });

  /* The escape hatch for every case where the search is technically right and
     socially wrong. */
  it('never moves anything pinned', () => {
    const pinned = layoutOf([
      at('i0', 400, 500, 0, true),
      ...items.slice(1).map((item, i) => at(item.id, 900 + i * 500, 1500)),
    ]);

    for (const candidate of run(pinned).results) {
      const after = candidate.layout.placements.find((p) => p.itemId === 'i0');
      expect(after?.pose).toEqual({ x: 400, y: 500, rot: 0 });
      expect(candidate.moved).not.toContain('i0');
    }
  });

  /* A count, not a weight: the same weight means something different in a
     four-item room and a twenty-item one, so it would either pin everything or
     do nothing. */
  it('respects a cap on how many things may move', () => {
    for (const maxMoves of [1, 2, 3]) {
      const result = run(messy, { maxMoves });
      for (const candidate of result.results) {
        expect(candidate.moved.length).toBeLessThanOrEqual(maxMoves);
      }
    }
  });

  it('keeps every item it was given', () => {
    for (const candidate of run(messy).results) {
      expect(candidate.layout.placements.map((p) => p.itemId).toSorted()).toEqual(
        items.map((i) => i.id).toSorted(),
      );
    }
  });

  it('can be stopped part way', () => {
    let calls = 0;
    const result = run(messy, {
      onProgress: () => {
        calls++;
        return calls < 2;
      },
    });
    expect(calls).toBeGreaterThan(0);
    /* Stopping early must still leave something usable, not nothing. */
    expect(result.evals).toBeGreaterThan(0);
  });

  it('copes with an empty room', () => {
    const result = refineLayout({ ...base, items: [], layout: layoutOf([]) });
    expect(result.results.length).toBeGreaterThanOrEqual(0);
  });

  it('finishes quickly enough to sit behind a button', () => {
    const started = Date.now();
    run(messy);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

// ── Choosing what to show ─────────────────────────────────────────────────

describe('selectDiverse', () => {
  const fake = (id: string, score: number, x: number): RefineCandidate => ({
    layout: layoutOf(items.map((item, i) => at(item.id, x + i * 10, 500))),
    score,
    moved: [],
    signature: id,
  });

  it('always includes the best', () => {
    const picks = selectDiverse([fake('a', 1, 0), fake('b', 2, 2000)], {
      items,
      roomDiagonal: diagonal,
    });
    expect(picks[0]?.candidate.score).toBe(2);
  });

  /* Three arrangements that differ only in where a lamp ended up are one
     option shown three times. Returning fewer honestly beats padding. */
  it('returns fewer rather than showing the same idea twice', () => {
    const nearIdentical = [fake('a', 1.0, 0), fake('b', 0.99, 5), fake('c', 0.98, 10)];
    const picks = selectDiverse(nearIdentical, { items, roomDiagonal: diagonal });
    expect(picks.length).toBe(1);
  });

  it('picks genuinely different ideas when they exist', () => {
    const varied = [fake('a', 1.0, 0), fake('b', 0.95, 1600), fake('c', 0.9, 3000)];
    const picks = selectDiverse(varied, { items, roomDiagonal: diagonal, minDistance: 0.05 });
    expect(picks.length).toBeGreaterThan(1);
    for (const pick of picks.slice(1)) expect(pick.distinctness).toBeGreaterThan(0);
  });

  it('handles being given nothing', () => {
    expect(selectDiverse([], { items, roomDiagonal: diagonal })).toEqual([]);
  });

  /* Weighted by footprint, so moving the bed counts far more than moving a
     nightstand. Unweighted, the "most different" option would reliably be the
     one that jiggled the smallest thing. */
  it('weighs a moved bed above a moved nightstand', () => {
    const bed = itemFromPreset('bed', 'bed');
    const stand = itemFromPreset('ns', 'nightstand');
    const pair = [bed, stand];

    const home = {
      layout: layoutOf([at('bed', 0, 0), at('ns', 2000, 0)]),
      score: 1,
      moved: [],
      signature: 'x',
    };
    const bedMoved = { ...home, layout: layoutOf([at('bed', 1500, 0), at('ns', 2000, 0)]) };
    const standMoved = { ...home, layout: layoutOf([at('bed', 0, 0), at('ns', 500, 0)]) };

    expect(distance(home, bedMoved, pair, diagonal)).toBeGreaterThan(
      distance(home, standMoved, pair, diagonal),
    );
  });

  it('ignores a rug entirely, since its position cannot change the score', () => {
    const rug = itemFromPreset('rug', 'rug');
    const home = { layout: layoutOf([at('rug', 0, 0)]), score: 1, moved: [], signature: 'x' };
    const moved = { ...home, layout: layoutOf([at('rug', 2000, 2000)]) };
    expect(distance(home, moved, [rug], diagonal)).toBe(0);
  });
});

describe('labelOptions', () => {
  /* Labels are computed from the MEASURED figures, not from the search's
     internal scores. Those are computed on a coarser grid and can rank two
     options differently from the numbers shown beside them — which produced an
     option labelled "Most open floor" sitting above one with more floor. */
  it('names the option that actually has the most floor', () => {
    const labels = labelOptions([
      { walkableMm2: 9_400_000, moved: ['a', 'b', 'c'] },
      { walkableMm2: 9_500_000, moved: ['a', 'b', 'c'] },
    ]);
    expect(labels[1]).toBe('Most open floor');
    expect(labels[0]).not.toBe('Most open floor');
  });

  it('names the one that asks least of you', () => {
    const labels = labelOptions([
      { walkableMm2: 9_500_000, moved: ['a', 'b', 'c'] },
      { walkableMm2: 9_000_000, moved: ['a'] },
    ]);
    expect(labels[0]).toBe('Most open floor');
    expect(labels[1]).toBe('Smallest change · 1 thing moves');
  });

  it('does not claim a smallest change when the best one already is', () => {
    const labels = labelOptions([
      { walkableMm2: 9_500_000, moved: ['a'] },
      { walkableMm2: 9_000_000, moved: ['a', 'b'] },
    ]);
    expect(labels[0]).toBe('Most open floor');
    expect(labels[1]).not.toMatch(/Smallest change/);
  });

  it('gets the plural agreement right in both directions', () => {
    expect(
      labelOptions([
        { walkableMm2: 9_500_000, moved: ['a', 'b', 'c'] },
        { walkableMm2: 9_000_000, moved: ['a', 'b'] },
      ])[1],
    ).toBe('Smallest change · 2 things move');
  });

  it('handles being given nothing', () => {
    expect(labelOptions([])).toEqual([]);
  });
});
