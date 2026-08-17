import { describe, expect, it } from 'vitest';
import {
  type CandidateContext,
  MAX_CANDIDATES,
  generateCandidates,
  nearestCandidate,
} from '@/core/candidates';
import { itemFromPreset } from '@/core/catalog';
import { checkLayout, hardViolations, rectIntersectsSector } from '@/core/constraints';
import type { Feature } from '@/core/features';
import { type Rot, rectsOverlap } from '@/core/geometry';
import { autoArrange } from '@/core/greedy';
import { type Item, type Layout, type Placement, itemRect } from '@/core/items';
import { featureZones } from '@/core/openings';
import { makeRectangularRoom, roomWalls } from '@/core/room';
import { makeRng, shuffled } from '@/core/rng';
import { DEFAULT_WEIGHTS, explainWeights, scoreLayout } from '@/core/score';
import { mm2ToM2 } from '@/core/units';

const WALL_IDS = ['w0', 'w1', 'w2', 'w3'];

function door(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'door',
    kind: 'door',
    wallId: 'w2',
    offset: 1400,
    width: 800,
    blocksFloor: false,
    door: { hinge: 'start', swing: 'in', leafWidth: 800, isPrimary: true },
    ...overrides,
  };
}

function at(itemId: string, x: number, y: number, rot: Rot = 0, locked = false): Placement {
  return { itemId, pose: { x, y, rot }, locked };
}

function layoutOf(placements: Placement[]): Layout {
  return { id: 'l', name: 'now', kind: 'baseline', placements };
}

const room = makeRectangularRoom(3400, 4200);

function ctxFor(features: Feature[] = [door()]): CandidateContext {
  return { room, features, wallIds: WALL_IDS, roomIsSleeping: true, fixed: [] };
}

// ── The seeded generator ──────────────────────────────────────────────────

describe('rng', () => {
  /* Core bans Math.random, so this is required rather than preferred — and it
     means a layout someone disagrees with can be reproduced exactly rather
     than argued about from memory. */
  it('gives the same sequence for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('gives different sequences for different seeds', () => {
    const a = Array.from({ length: 10 }, () => makeRng(1).next());
    const b = Array.from({ length: 10 }, () => makeRng(2).next());
    expect(a).not.toEqual(b);
  });

  it('stays inside [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shuffles without mutating the input', () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    const out = shuffled(original, makeRng(3));
    expect(original).toEqual(copy);
    expect(out.toSorted()).toEqual(copy);
  });
});

// ── Candidates ────────────────────────────────────────────────────────────

describe('candidate generation', () => {
  it('offers somewhere to put a wardrobe', () => {
    const set = generateCandidates(itemFromPreset('wd', 'wardrobe'), ctxFor());
    expect(set.candidates.length).toBeGreaterThan(10);
    expect(set.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
  });

  /* The whole point of filtering at generation time: any layout the search can
     reach is feasible by construction. Verified with the constraint checker
     itself rather than with the predicate used to generate — a check that
     agrees with itself proves nothing. */
  it('produces only poses the constraint checker also accepts', () => {
    for (const type of ['wardrobe', 'bed', 'desk', 'dresser'] as const) {
      const item = itemFromPreset('x', type);
      const set = generateCandidates(item, ctxFor());
      expect(set.candidates.length).toBeGreaterThan(0);

      for (const candidate of set.candidates) {
        const found = checkLayout({
          room,
          items: [item],
          layout: layoutOf([{ itemId: 'x', pose: candidate.pose, locked: false }]),
          features: [door()],
          wallIds: WALL_IDS,
          roomIsSleeping: true,
        });
        expect(hardViolations(found).map((v) => v.message)).toEqual([]);
      }
    }
  });

  /* A wardrobe whose doors open into masonry is not worth scoring. */
  it('turns wall-hugging items to face into the room', () => {
    const set = generateCandidates(itemFromPreset('wd', 'wardrobe'), ctxFor());
    const onWalls = set.candidates.filter((c) => c.wallIndex !== null);
    expect(onWalls.length).toBeGreaterThan(0);
    /* Wall 0 is the top, whose inward normal is +y, which is rotation 0. */
    for (const candidate of onWalls.filter((c) => c.wallIndex === 0)) {
      expect(candidate.pose.rot).toBe(0);
    }
  });

  it('keeps furniture out of the door swing and its landing', () => {
    const item = itemFromPreset('dr', 'dresser');
    const set = generateCandidates(item, ctxFor());
    const wall = roomWalls(room)[2];
    if (wall === undefined) throw new Error('missing wall');

    const zones = featureZones(wall, door(), true);
    expect(zones.length).toBeGreaterThan(0);

    /* Checked against the zones themselves rather than against a guessed
       rectangle, so the test cannot condemn a pose that is merely near the
       door but legitimately clear of it. */
    for (const candidate of set.candidates) {
      const rect = itemRect(item, { itemId: item.id, pose: candidate.pose, locked: false });
      for (const zone of zones) {
        if (item.height <= zone.minHeight) continue;
        const hits =
          zone.sector === undefined
            ? rectsOverlap(zone.bounds, rect)
            : rectIntersectsSector(rect, zone.sector);
        expect(hits).toBe(false);
      }
    }
  });

  it('offers nothing at all when an item cannot legally go anywhere', () => {
    const huge = { ...itemFromPreset('h', 'other'), footprint: { w: 9000, d: 9000 }, height: 800 };
    expect(generateCandidates(huge, ctxFor()).candidates).toEqual([]);
  });

  it('does not float things that should not float', () => {
    const wardrobe = generateCandidates(itemFromPreset('wd', 'wardrobe'), ctxFor());
    expect(wardrobe.candidates.every((c) => c.wallIndex !== null)).toBe(true);

    const rug = generateCandidates(itemFromPreset('rug', 'rug'), ctxFor());
    expect(rug.candidates.some((c) => c.wallIndex === null)).toBe(true);
  });

  it('finds the candidate nearest an existing pose', () => {
    const set = generateCandidates(itemFromPreset('wd', 'wardrobe'), ctxFor());
    const index = nearestCandidate(set, { x: 20, y: 20, rot: 0 });
    expect(index).toBeGreaterThanOrEqual(0);
    const chosen = set.candidates[index]?.pose;
    expect(Math.hypot((chosen?.x ?? 9999) - 20, (chosen?.y ?? 9999) - 20)).toBeLessThan(400);
  });

  it('respects things that cannot move', () => {
    const fixedItem = itemFromPreset('fixed', 'wardrobe');
    const ctx: CandidateContext = {
      ...ctxFor(),
      fixed: [{ item: fixedItem, rect: { x: 0, y: 0, w: 3400, d: 1000 } }],
    };
    const set = generateCandidates(itemFromPreset('dr', 'dresser'), ctx);
    for (const candidate of set.candidates) {
      expect(candidate.pose.y).toBeGreaterThanOrEqual(1000 - 1);
    }
  });
});

// ── Scoring ───────────────────────────────────────────────────────────────

describe('scoring', () => {
  const bed = itemFromPreset('bed', 'bed');

  const score = (placements: Placement[], items: Item[] = [bed]) =>
    scoreLayout({
      room,
      items,
      layout: layoutOf(placements),
      features: [door()],
      wallIds: WALL_IDS,
      roomIsSleeping: true,
    });

  it('prefers a bed in the corner to a bed in the middle', () => {
    expect(score([at('bed', 0, 0)]).total).toBeGreaterThan(score([at('bed', 1000, 1500)]).total);
  });

  it('keeps every soft term inside [0, 1]', () => {
    for (const placements of [[at('bed', 0, 0)], [at('bed', 1000, 1500)], []]) {
      for (const term of score(placements).terms) {
        expect(term.raw).toBeGreaterThanOrEqual(0);
        expect(term.raw).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reports its own breakdown, so a UI can say why', () => {
    const result = score([at('bed', 0, 0)]);
    expect(result.terms.map((t) => t.name)).toEqual([
      'walkableArea',
      'largestRect',
      'clearanceMargin',
      'functional',
    ]);
    const summed = result.terms.reduce((a, t) => a + t.weighted, 0);
    expect(result.total).toBeCloseTo(summed, 9);
  });

  it('marks an infeasible layout as such rather than merely scoring it low', () => {
    const wardrobe = itemFromPreset('wd', 'wardrobe');
    const floating = score([at('wd', 1500, 2000)], [wardrobe]);
    expect(floating.feasible).toBe(false);
  });

  /* "The headboard rule is worth 0.3 m²" is a claim someone can disagree with.
     "The functional weight is 0.12" is not. */
  it('states what each weight is worth in square metres', () => {
    const explained = explainWeights(12_000_000);
    expect(explained.map((e) => e.name)).toEqual(Object.keys(DEFAULT_WEIGHTS));
    for (const entry of explained) expect(entry.worthM2).toBeGreaterThan(0);
    expect(explained.find((e) => e.name === 'walkableArea')?.worthM2).toBeCloseTo(12, 1);
  });
});

// ── Auto-arrange ──────────────────────────────────────────────────────────

describe('autoArrange', () => {
  const bed = itemFromPreset('bed', 'bed');
  const wardrobe = itemFromPreset('wd', 'wardrobe');
  const dresser = itemFromPreset('dr', 'dresser');

  const run = (items: Item[], placements: Placement[], overrides = {}) =>
    autoArrange({
      room,
      items,
      layout: layoutOf(placements),
      features: [door()],
      wallIds: WALL_IDS,
      roomIsSleeping: true,
      seed: 1,
      ...overrides,
    });

  it('improves a deliberately bad layout', () => {
    /* Everything floating in the middle of the room. */
    const result = run(
      [bed, wardrobe, dresser],
      [at('bed', 900, 1200), at('wd', 1200, 2600), at('dr', 1000, 3400)],
    );

    expect(result.score.total).toBeGreaterThan(result.baseline.total);
    expect(mm2ToM2(result.score.walkableMm2)).toBeGreaterThan(mm2ToM2(result.baseline.walkableMm2));
  });

  /* An optimizer that only ever proposes change is a sales pitch. This one has
     to be able to say "what you have is the best I found". */
  it('leaves a good layout alone', () => {
    const good = run([bed, wardrobe], [at('bed', 20, 20), at('wd', 2380, 20)]);
    const again = run([bed, wardrobe], good.layout.placements);
    expect(again.score.total).toBeGreaterThanOrEqual(again.baseline.total - 1e-9);
  });

  it('never returns something scoring below what it started with', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = run(
        [bed, wardrobe, dresser],
        [at('bed', 900, 1200), at('wd', 1200, 2600), at('dr', 1000, 3400)],
        { seed },
      );
      expect(result.score.total).toBeGreaterThanOrEqual(result.baseline.total - 1e-9);
    }
  });

  it('never returns an infeasible layout', () => {
    const result = run(
      [bed, wardrobe, dresser],
      [at('bed', 900, 1200), at('wd', 1200, 2600), at('dr', 1000, 3400)],
    );
    expect(result.score.feasible).toBe(true);
  });

  it('is reproducible from its seed', () => {
    const a = run([bed, wardrobe], [at('bed', 900, 1200), at('wd', 1200, 2600)], { seed: 9 });
    const b = run([bed, wardrobe], [at('bed', 900, 1200), at('wd', 1200, 2600)], { seed: 9 });
    expect(a.layout.placements).toEqual(b.layout.placements);
  });

  /* The escape hatch for every case where the search is technically right and
     socially wrong. */
  it('does not move anything that is pinned', () => {
    const result = run([bed, wardrobe], [at('bed', 900, 1200, 0, true), at('wd', 1200, 2600)]);
    const after = result.layout.placements.find((p) => p.itemId === 'bed');
    expect(after?.pose).toEqual({ x: 900, y: 1200, rot: 0 });
    expect(result.moved).not.toContain('bed');
  });

  it('keeps every item it was given', () => {
    const result = run(
      [bed, wardrobe, dresser],
      [at('bed', 900, 1200), at('wd', 1200, 2600), at('dr', 1000, 3400)],
    );
    expect(result.layout.placements.map((p) => p.itemId).toSorted()).toEqual(['bed', 'dr', 'wd']);
  });

  it('says which things it moved', () => {
    const result = run([bed, wardrobe], [at('bed', 900, 1200), at('wd', 1200, 2600)]);
    if (!result.keptOriginal) expect(result.moved.length).toBeGreaterThan(0);
  });

  it('copes with an empty room', () => {
    const result = run([], []);
    expect(result.layout.placements).toEqual([]);
    expect(result.keptOriginal).toBe(true);
  });

  it('finishes fast enough to feel instant', () => {
    const started = Date.now();
    run(
      [bed, wardrobe, dresser, itemFromPreset('ns', 'nightstand')],
      [at('bed', 900, 1200), at('wd', 1200, 2600), at('dr', 1000, 3400), at('ns', 200, 200)],
    );
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
