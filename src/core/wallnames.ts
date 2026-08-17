import type { Wall } from '@/core/room';

/**
 * Names for walls and corners.
 *
 * Nobody can act on "x = 1200". A blueprint has to say *"from the corner where
 * the Left Wall meets the Far Wall, 300 mm"*, because that is a thing a person
 * can find while holding a tape measure.
 *
 * The frame of reference is standing in the primary doorway looking into the
 * room, which is the one orientation every occupant shares and can reproduce
 * without thinking. Compass directions are deliberately never the primary name:
 * plenty of people cannot say which way north is in their own bedroom, and a
 * plan that opens by demanding it has already lost them. North appears only as
 * a parenthetical, and only when it is known.
 *
 * A user-supplied label always wins over anything derived here.
 */

export interface WallName {
  index: number;
  /** What to print. */
  label: string;
  /** True when the user named it rather than it being derived. */
  custom: boolean;
}

export interface CornerName {
  /** Index of the outline vertex, which is also the wall that starts here. */
  index: number;
  /** Short handle used on drawings: `C1`, `C2`, … */
  tag: string;
  /** Printed in full at least once per sheet: `C2 (Left Wall × Far Wall)`. */
  label: string;
  /** The two walls meeting here, in clockwise order. */
  wallIndices: [number, number];
}

export interface WallNaming {
  walls: WallName[];
  corners: CornerName[];
}

export interface NamingOptions {
  /** Which wall holds the primary door. Naming is much better with one. */
  doorWallIndex?: number | undefined;
  /** User overrides, keyed by wall index. These always win. */
  labels?: Readonly<Record<number, string>> | undefined;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Derived names for a four-wall room, relative to the door.
 *
 * Standing in the doorway facing into the room, the wall **after** the door
 * wall in clockwise order is on your left. That is not obvious and is worth
 * checking rather than trusting: with the door in the south wall you face
 * north, so west is on your left — and clockwise from south is west. The same
 * relationship holds on all four walls, which is what makes this a lookup
 * rather than a per-wall geometry test.
 */
const RELATIVE_TO_DOOR = ['Door Wall', 'Left Wall', 'Far Wall', 'Right Wall'] as const;

/**
 * Name every wall and corner.
 *
 * Rooms with more than four walls get letters rather than a strained attempt at
 * "Left Wall" for six walls, which would be actively misleading. Letters still
 * start at the door wall and run clockwise, so the sequence matches the order
 * someone walking the room would meet them.
 */
export function nameWalls(walls: readonly Wall[], options: NamingOptions = {}): WallNaming {
  const n = walls.length;
  const labels = options.labels ?? {};
  const doorIndex =
    options.doorWallIndex !== undefined && options.doorWallIndex >= 0 && options.doorWallIndex < n
      ? options.doorWallIndex
      : null;

  /* Position clockwise from the door wall; without a door, from wall 0. */
  const origin = doorIndex ?? 0;
  const clockwiseOffset = (index: number): number => (index - origin + n) % n;

  const named: WallName[] = walls.map((wall) => {
    const custom = labels[wall.index];
    if (custom !== undefined && custom.trim() !== '') {
      return { index: wall.index, label: custom.trim(), custom: true };
    }

    const offset = clockwiseOffset(wall.index);

    if (n === 4 && doorIndex !== null) {
      return { index: wall.index, label: RELATIVE_TO_DOOR[offset] ?? 'Wall', custom: false };
    }

    const letter = LETTERS[offset % LETTERS.length] ?? '?';
    const suffix = offset >= LETTERS.length ? String(Math.floor(offset / LETTERS.length) + 1) : '';
    const base = `Wall ${letter}${suffix}`;

    /* Even in a room with many walls, the one you walk in through is worth
       naming rather than lettering — it is the only wall everyone can find. */
    return {
      index: wall.index,
      label: doorIndex === wall.index ? `${base} (door wall)` : base,
      custom: false,
    };
  });

  const labelOf = (index: number): string => named[index]?.label ?? `Wall ${index}`;

  const corners: CornerName[] = walls.map((wall) => {
    const previous = (wall.index - 1 + n) % n;
    const tag = `C${clockwiseOffset(wall.index) + 1}`;
    return {
      index: wall.index,
      tag,
      label: `${tag} (${labelOf(previous)} × ${labelOf(wall.index)})`,
      wallIndices: [previous, wall.index],
    };
  });

  return { walls: named, corners };
}

/** The name of one wall, or a stable fallback if the index is out of range. */
export function wallLabel(naming: WallNaming, index: number): string {
  return naming.walls.find((w) => w.index === index)?.label ?? `Wall ${index}`;
}

/** The corner at outline vertex `index` — where the previous wall meets it. */
export function cornerLabel(naming: WallNaming, index: number): string {
  return naming.corners.find((c) => c.index === index)?.label ?? `Corner ${index}`;
}
