/**
 * Version stamps for the parts of the system whose output gets cached or
 * persisted. These are not the app version — they are cache-invalidation keys.
 */

/**
 * Bumped whenever a change to the geometry/metric pipeline could produce a
 * different `walkableMm2` for the same input. A cached `Metrics` whose
 * `engineVersion` differs from this is discarded rather than displayed.
 *
 * The cache key is this *plus* a content hash of the inputs (room outline, item
 * dimensions, placements, body radius, cell size) — this stamp alone is not
 * enough, because the body radius is a user-facing slider and moving it must
 * invalidate the number the user is looking at.
 */
export const ENGINE_VERSION = 'metrics-1';

/**
 * The on-disk / localStorage document format. A document declaring a version
 * newer than this is refused and opened read-only, never partially parsed —
 * guessing at a future schema is how you silently corrupt someone's room.
 */
export const SCHEMA_VERSION = 1;
