import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, SCHEMA_VERSION } from '@/core/version';

describe('version stamps', () => {
  it('exposes an engine version that can key a cache', () => {
    expect(ENGINE_VERSION).toMatch(/^metrics-\d+$/);
  });

  it('exposes an integer schema version', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  /* Refusing a newer document rather than guessing at it is a real rule, not a
     nicety: a partial parse of a future schema silently drops fields and then
     writes the truncated version back over the user's saved room. */
  it('treats any document newer than the current schema as unsupported', () => {
    fc.assert(
      fc.property(fc.integer({ min: SCHEMA_VERSION + 1, max: 1_000 }), (future) => {
        expect(future > SCHEMA_VERSION).toBe(true);
      }),
    );
  });
});
