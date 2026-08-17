import type { ClearanceRule, Item, ItemType, MoveClass } from '@/core/items';
import type { Mm } from '@/core/units';

/**
 * Starting points, not constraints.
 *
 * Every number below is a prefill. Sizes are editable because furniture is not
 * standard, and **clearances are editable too** — "my wardrobe has sliding
 * doors, 60 cm in front is plenty" has to be something a person can say, or the
 * tool will confidently tell them their room doesn't work when it does.
 *
 * The clearance defaults come from residential circulation practice rather than
 * from accessibility code. ADA's 915 mm corridor is the right number for a
 * public building and the wrong one here: a 3.4 × 4.2 m bedroom with a double
 * bed and a wardrobe fails it almost everywhere, so an ADA-default tool reports
 * "0 m² walkable" and is useless. Accessibility is a mode, not the default.
 */

const rule = (
  id: string,
  side: ClearanceRule['side'],
  depth: Mm,
  reason: string,
  extra: Partial<ClearanceRule> = {},
): ClearanceRule => ({
  id,
  side,
  depth,
  kind: 'access',
  share: 'shareable',
  minHeight: 0,
  reason,
  ...extra,
});

export interface Preset {
  type: ItemType;
  label: string;
  /** Sub-variants, e.g. bed sizes. The first is the default. */
  variants: {
    label: string;
    footprint: { w: Mm; d: Mm };
    height: Mm;
  }[];
  moveClass: MoveClass;
  mustTouchWall: boolean;
  prefersWall: boolean;
  allowFloat: boolean;
  overlappable: boolean;
  overhangFloor: boolean;
  clearHeightUnder?: Mm;
  needsUnloading: boolean;
  needsPower: boolean;
  occupants?: 1 | 2;
  clearances: (footprint: { w: Mm; d: Mm }) => ClearanceRule[];
}

export const PRESETS: readonly Preset[] = [
  {
    type: 'bed',
    label: 'Bed',
    variants: [
      { label: 'Double (135)', footprint: { w: 1350, d: 1900 }, height: 600 },
      { label: 'Single (90)', footprint: { w: 900, d: 1900 }, height: 600 },
      { label: 'Small double (120)', footprint: { w: 1200, d: 1900 }, height: 600 },
      { label: 'King (150)', footprint: { w: 1500, d: 2000 }, height: 600 },
      { label: 'Super king (180)', footprint: { w: 1800, d: 2000 }, height: 600 },
    ],
    moveClass: 'heavy',
    mustTouchWall: false,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    occupants: 2,
    /* The headboard is the `back` side, so it is the one with no clearance —
       that is what makes "headboard against a wall" the natural arrangement
       rather than something that has to be asserted separately.

       Both long sides carry access, grouped: with one sleeper, satisfying
       either is enough. A nightstand may nest in either, provided 400 mm of
       the width stays clear to walk through. */
    clearances: () => [
      rule('bed-left', 'left', 750, 'You need to get into the bed and make it.', {
        preferred: 900,
        anyOfGroup: 'bed-access',
        nestsWith: ['nightstand'],
        minCirculation: 400,
      }),
      rule('bed-right', 'right', 750, 'You need to get into the bed and make it.', {
        preferred: 900,
        anyOfGroup: 'bed-access',
        nestsWith: ['nightstand'],
        minCirculation: 400,
      }),
      rule('bed-foot', 'front', 600, 'Room to walk past the foot of the bed.', {
        preferred: 900,
      }),
    ],
  },
  {
    type: 'wardrobe',
    label: 'Wardrobe',
    variants: [
      { label: 'Double, hinged', footprint: { w: 1000, d: 600 }, height: 2000 },
      { label: 'Triple, hinged', footprint: { w: 1500, d: 600 }, height: 2000 },
      { label: 'Sliding', footprint: { w: 1500, d: 650 }, height: 2000 },
      { label: 'Single', footprint: { w: 600, d: 600 }, height: 2000 },
    ],
    moveClass: 'heavy',
    mustTouchWall: true,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: true,
    needsPower: false,
    /* 900 covers the leaf sweep plus somewhere to stand while you use it.
       Switch it to 600 if the doors slide — which is exactly the edit the
       clearance fields exist to allow. */
    clearances: () => [
      rule(
        'wardrobe-front',
        'front',
        900,
        'The doors need room to open and you need to stand there.',
        {
          preferred: 1000,
          kind: 'operate',
        },
      ),
    ],
  },
  {
    type: 'dresser',
    label: 'Chest of drawers',
    variants: [
      { label: 'Standard', footprint: { w: 800, d: 450 }, height: 800 },
      { label: 'Wide', footprint: { w: 1200, d: 450 }, height: 800 },
      { label: 'Tallboy', footprint: { w: 600, d: 450 }, height: 1200 },
    ],
    moveClass: 'heavy',
    mustTouchWall: true,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: true,
    needsPower: false,
    /* A drawer pulls out nearly its own depth, and then someone has to stand
       in front of the open drawer. */
    clearances: (f) => [
      rule(
        'dresser-front',
        'front',
        Math.max(f.d - 50, 0) + 300,
        'A drawer has to pull all the way out.',
        {
          preferred: Math.max(f.d - 50, 0) + 400,
          kind: 'operate',
        },
      ),
    ],
  },
  {
    type: 'nightstand',
    label: 'Nightstand',
    variants: [
      { label: 'Standard', footprint: { w: 450, d: 400 }, height: 550 },
      { label: 'Small', footprint: { w: 350, d: 350 }, height: 500 },
    ],
    moveClass: 'lift',
    mustTouchWall: false,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: true,
    clearances: () => [
      rule('nightstand-front', 'front', 300, 'Reach the drawer and whatever is on top.'),
    ],
  },
  {
    type: 'desk',
    label: 'Desk',
    variants: [
      { label: 'Standard', footprint: { w: 1200, d: 600 }, height: 750 },
      { label: 'Large', footprint: { w: 1600, d: 750 }, height: 750 },
      { label: 'Compact', footprint: { w: 1000, d: 500 }, height: 750 },
    ],
    moveClass: 'slide',
    mustTouchWall: false,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: true,
    clearHeightUnder: 650,
    needsUnloading: true,
    needsPower: true,
    /* The chair pulls out and someone sits in it. `activity` rather than
       `access` because two people cannot both be seated and walking past. */
    clearances: () => [
      rule('desk-chair', 'front', 760, 'The chair pulls out and someone sits in it.', {
        preferred: 1000,
        kind: 'activity',
        nestsWith: ['chair'],
        minCirculation: 0,
      }),
    ],
  },
  {
    type: 'chair',
    label: 'Chair',
    variants: [
      { label: 'Desk chair', footprint: { w: 550, d: 550 }, height: 950 },
      { label: 'Dining chair', footprint: { w: 450, d: 500 }, height: 900 },
    ],
    moveClass: 'lift',
    mustTouchWall: false,
    prefersWall: false,
    allowFloat: true,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    clearances: () => [],
  },
  {
    type: 'sofa',
    label: 'Sofa',
    variants: [
      { label: 'Two-seat', footprint: { w: 1700, d: 900 }, height: 850 },
      { label: 'Three-seat', footprint: { w: 2100, d: 900 }, height: 850 },
      { label: 'Corner', footprint: { w: 2400, d: 1600 }, height: 850 },
    ],
    moveClass: 'heavy',
    mustTouchWall: false,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    clearances: () => [
      rule('sofa-front', 'front', 450, 'Legroom, and space for a coffee table.', {
        preferred: 600,
      }),
    ],
  },
  {
    type: 'armchair',
    label: 'Armchair',
    variants: [{ label: 'Standard', footprint: { w: 850, d: 850 }, height: 850 }],
    moveClass: 'slide',
    mustTouchWall: false,
    prefersWall: false,
    allowFloat: true,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    clearances: () => [rule('armchair-front', 'front', 450, 'Legroom.')],
  },
  {
    type: 'coffee-table',
    label: 'Coffee table',
    variants: [{ label: 'Standard', footprint: { w: 1100, d: 600 }, height: 420 }],
    moveClass: 'lift',
    mustTouchWall: false,
    prefersWall: false,
    allowFloat: true,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    clearances: () => [],
  },
  {
    type: 'dining-table',
    label: 'Dining table',
    variants: [
      { label: 'Four-seat', footprint: { w: 1200, d: 800 }, height: 750 },
      { label: 'Six-seat', footprint: { w: 1600, d: 900 }, height: 750 },
    ],
    moveClass: 'heavy',
    mustTouchWall: false,
    prefersWall: false,
    allowFloat: true,
    overlappable: false,
    overhangFloor: true,
    clearHeightUnder: 700,
    needsUnloading: false,
    needsPower: false,
    /* Chairs pull out on every side that gets used. */
    clearances: () => [
      rule('table-front', 'front', 900, 'A chair has to pull out and someone sit in it.', {
        kind: 'activity',
        nestsWith: ['chair'],
        minCirculation: 0,
      }),
      rule('table-back', 'back', 900, 'A chair has to pull out and someone sit in it.', {
        kind: 'activity',
        nestsWith: ['chair'],
        minCirculation: 0,
      }),
    ],
  },
  {
    type: 'bookcase',
    label: 'Bookcase',
    variants: [
      { label: 'Tall', footprint: { w: 800, d: 300 }, height: 1800 },
      { label: 'Low', footprint: { w: 800, d: 300 }, height: 900 },
    ],
    moveClass: 'heavy',
    mustTouchWall: true,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: true,
    needsPower: false,
    clearances: () => [
      rule('bookcase-front', 'front', 700, 'Stand back far enough to read the spines.'),
    ],
  },
  {
    type: 'tv-stand',
    label: 'TV stand',
    variants: [{ label: 'Standard', footprint: { w: 1200, d: 400 }, height: 500 }],
    moveClass: 'slide',
    mustTouchWall: true,
    prefersWall: true,
    allowFloat: false,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: true,
    needsPower: true,
    clearances: () => [],
  },
  {
    type: 'rug',
    label: 'Rug',
    variants: [
      { label: 'Medium', footprint: { w: 1700, d: 1200 }, height: 10 },
      { label: 'Large', footprint: { w: 2400, d: 1700 }, height: 10 },
    ],
    moveClass: 'lift',
    mustTouchWall: false,
    prefersWall: false,
    allowFloat: true,
    /* A rug is floor. It is excluded from the walking-obstacle set entirely,
       so its position cannot change the walkable figure — asserted as a test
       rather than left as an assumption. */
    overlappable: true,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    clearances: () => [],
  },
  {
    type: 'other',
    label: 'Something else',
    variants: [{ label: 'Custom', footprint: { w: 600, d: 600 }, height: 800 }],
    moveClass: 'slide',
    mustTouchWall: false,
    prefersWall: false,
    allowFloat: true,
    overlappable: false,
    overhangFloor: false,
    needsUnloading: false,
    needsPower: false,
    clearances: () => [],
  },
];

export function presetFor(type: ItemType): Preset {
  return PRESETS.find((p) => p.type === type) ?? PRESETS[PRESETS.length - 1]!;
}

/**
 * Build an item from a preset.
 *
 * Everything it produces is immediately editable — this only decides where the
 * fields start, and a user who changes any of them is not fighting the tool.
 */
export function itemFromPreset(
  id: string,
  type: ItemType,
  variantIndex = 0,
  overrides: Partial<Item> = {},
): Item {
  const preset = presetFor(type);
  const variant = preset.variants[variantIndex] ?? preset.variants[0]!;

  return {
    id,
    name: preset.variants.length > 1 ? `${preset.label} (${variant.label})` : preset.label,
    type,
    footprint: { ...variant.footprint },
    height: variant.height,
    clearances: preset.clearances(variant.footprint),
    mustTouchWall: preset.mustTouchWall,
    prefersWall: preset.prefersWall,
    allowFloat: preset.allowFloat,
    overlappable: preset.overlappable,
    overhangFloor: preset.overhangFloor,
    ...(preset.clearHeightUnder === undefined ? {} : { clearHeightUnder: preset.clearHeightUnder }),
    moveClass: preset.moveClass,
    needsUnloading: preset.needsUnloading,
    needsPower: preset.needsPower,
    ...(preset.occupants === undefined ? {} : { occupants: preset.occupants }),
    ...overrides,
  };
}
