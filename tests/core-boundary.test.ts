import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `src/core` is a zero-dependency, DOM-free, React-free, deterministic library.
 * Everything that can produce a wrong blueprint lives there, so it has to stay
 * testable in isolation and reproducible run to run.
 *
 * This is a test rather than a lint rule on purpose. A lint rule is one
 * `// eslint-disable-next-line` or one config edit away from being off, and the
 * damage from breaking this boundary (a metric that depends on wall-clock time,
 * or an optimizer that cannot be replayed from a seed) shows up as flaky
 * numbers rather than as an error.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = join(ROOT, 'src/core');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

function importsOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec !== undefined) found.push(spec);
  }
  return found;
}

/**
 * Globals that make core non-portable or non-deterministic.
 *
 * Each host global is matched as an actual *reference*: not preceded by a dot
 * (which would make it someone else's property) and not followed by a colon
 * (which would make it an object key or a type annotation). Without those two
 * guards, a feature whose `kind` is `'window'` and whose defaults table has a
 * `window:` entry trips a DOM check — and a guard that cries wolf is a guard
 * someone eventually deletes.
 */
const ref = (name: string) => new RegExp(String.raw`(?<![.\w$])${name}\b(?!\s*:)`);

const FORBIDDEN_GLOBALS: ReadonlyArray<readonly [pattern: RegExp, why: string]> = [
  [ref('document'), 'core must not touch the DOM — it has to run in a worker and in node'],
  [ref('window'), 'core must not touch the DOM — it has to run in a worker and in node'],
  [ref('localStorage'), 'persistence belongs in src/state, not in core'],
  [ref('navigator'), 'core must not branch on the host environment'],
  [/\bfetch\s*\(/, 'core is offline and synchronous by design'],
  [
    /\bMath\s*\.\s*random\s*\(/,
    'every random draw in core must come from the seeded rng, or the optimizer cannot be replayed',
  ],
  [
    /\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(/,
    'core must not read the clock — timestamps are passed in, so a solve is reproducible',
  ],
  [
    /\bperformance\s*\.\s*now\s*\(/,
    'time budgets belong to the worker; core computes, the caller decides when to stop',
  ],
];

describe('src/core boundary', () => {
  const files = sourceFiles(CORE);

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(ROOT, f), f] as const))(
    '%s imports nothing outside core',
    (rel, full) => {
      for (const spec of importsOf(readFileSync(full, 'utf8'))) {
        const isRelative = spec.startsWith('.');
        const isCoreAlias = spec.startsWith('@/core/');
        expect(
          isRelative || isCoreAlias,
          `${rel} imports "${spec}". core is zero-dependency and self-contained: no npm packages, ` +
            `no node builtins, and nothing from src/ui, src/render, src/state or src/workers.`,
        ).toBe(true);
      }
    },
  );

  it.each(files.map((f) => [relative(ROOT, f), f] as const))(
    '%s uses no host globals and no ambient nondeterminism',
    (rel, full) => {
      const code = stripCommentsAndStrings(readFileSync(full, 'utf8'));

      for (const [pattern, why] of FORBIDDEN_GLOBALS) {
        expect(pattern.test(code), `${rel}: ${why}`).toBe(false);
      }
    },
  );
});

/**
 * Remove comments and string literals before looking for global references.
 *
 * Both exclusions are load-bearing rather than tidying. Comments explaining
 * *why* `Math.random` is banned would otherwise trip the check that bans it.
 * And a reference to a global can never live inside a string, so scanning
 * string contents only produces false positives — `kind: 'window'` on a feature
 * is not the DOM's `window`, and a guard that cries wolf about it gets switched
 * off, which costs far more than the imprecision it was protecting against.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/\/\/[^\n]*/g, ' ')
    .replaceAll(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replaceAll(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, '``');
}
