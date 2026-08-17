import { describe, expect, it } from 'vitest';
import { selectDiverse } from '@/core/archive';
import { hardViolations } from '@/core/constraints';
import { FIXTURES } from './fixtures';
import { autoArrange } from '@/core/greedy';
import { refineLayout } from '@/core/refine';
import { roomBounds } from '@/core/room';
import { scoreLayout } from '@/core/score';
import { mm2ToM2 } from '@/core/units';

/**
 * The bench.
 *
 * Runs the whole search over every fixture room and asserts the properties that
 * must hold on all of them. It is deliberately a test rather than a script: a
 * benchmark nobody runs tells you nothing, and these are exactly the guarantees
 * that would otherwise be quietly broken by a weight change six months from now.
 *
 * It prints a table too, so a change that keeps every property but makes the
 * results worse is visible rather than silent.
 */

describe('the search, across every fixture room', () => {
  const rows: string[] = [];

  it.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const base = {
      room: fixture.room,
      items: fixture.items,
      features: fixture.features,
      wallIds: fixture.wallIds,
      roomIsSleeping: fixture.roomIsSleeping,
    };
    const measure = (layout: typeof fixture.layout) => scoreLayout({ ...base, layout });

    const started = Date.now();
    const greedy = autoArrange({ ...base, layout: fixture.layout, seed: 1 });
    const refined = refineLayout({
      ...base,
      layout: fixture.layout,
      seed: 1,
      seeds: [greedy.layout],
      attempts: 5,
      samplePerItem: 56,
      sweeps: 4,
    });
    const ms = Date.now() - started;

    const baseline = measure(fixture.layout);
    const bounds = roomBounds(fixture.room);
    const picks = selectDiverse(refined.results, {
      items: fixture.items,
      roomDiagonal: Math.hypot(bounds.w, bounds.d),
      want: 3,
    });

    /* Every result must be a layout somebody could actually live with. This is
       the property most worth protecting: a suggestion that breaks a rule is
       worse than no suggestion. */
    for (const candidate of refined.results) {
      const problems = hardViolations(measure(candidate.layout).violations);
      expect(problems.map((v) => v.message)).toEqual([]);
    }

    /* Every item survives. Losing someone's furniture is never an acceptable
       answer to "I could not place this". */
    for (const candidate of refined.results) {
      expect(candidate.layout.placements.map((p) => p.itemId).toSorted()).toEqual(
        fixture.items.map((i) => i.id).toSorted(),
      );
    }

    const best = refined.results[0];
    const bestScore = best === undefined ? null : measure(best.layout);

    /* Greedy is handed to the refiner as a seed, so the refiner can only ever
       come out at least as good. If this fails, the seeding has broken. */
    if (bestScore !== null) {
      expect(bestScore.total).toBeGreaterThanOrEqual(measure(greedy.layout).total - 1e-9);
    }

    /* A starting layout that already works must never come back worse. */
    if (baseline.feasible && bestScore !== null) {
      expect(bestScore.total).toBeGreaterThanOrEqual(baseline.total - 1e-9);
    }

    rows.push(
      [
        fixture.name.padEnd(34),
        `${String(ms).padStart(5)}ms`,
        `base ${mm2ToM2(baseline.walkableMm2).toFixed(1)}`.padEnd(10),
        `best ${bestScore === null ? '  —' : mm2ToM2(bestScore.walkableMm2).toFixed(1)}`.padEnd(10),
        `probs ${hardViolations(baseline.violations).length}→${bestScore === null ? '—' : hardViolations(bestScore.violations).length}`.padEnd(
          11,
        ),
        `opts ${picks.length}`,
        `evals ${refined.evals}`,
      ].join('  '),
    );

    /* Loose on purpose. A hard time limit here would fail on a busy CI machine
       for reasons that have nothing to do with this code; this only catches an
       order-of-magnitude regression. */
    expect(ms).toBeLessThan(15_000);
  });

  it('summary', () => {
    console.log(`\n${rows.join('\n')}\n`);
    expect(rows.length).toBe(FIXTURES.length);
  });
});
