import type { Feature } from '@/core/features';
import { itemFromPreset } from '@/core/catalog';
import type { Item, ItemType, Layout, Placement } from '@/core/items';
import { type Room, makeRectangularRoom, makeRoom } from '@/core/room';

/**
 * Rooms to measure the search against.
 *
 * The point is not to prove the search is good — no fixed set of rooms can do
 * that. The point is that a change to the weights or the scoring can be seen
 * rather than guessed at. Without something like this, every future tweak is
 * argued about from a single anecdote.
 *
 * Chosen to disagree with each other: a generous room and a cramped one, a
 * rectangle and an L, a bedroom and a living room. A change that helps every
 * one of these is a real improvement; one that helps the roomy fixtures and
 * hurts the tight ones is a trade, and the bench is what makes that visible.
 */

export interface Fixture {
  name: string;
  room: Room;
  items: Item[];
  layout: Layout;
  features: Feature[];
  wallIds: string[];
  roomIsSleeping: boolean;
}

const RECT_WALLS = ['w0', 'w1', 'w2', 'w3'];

function doorAt(wallId: string, offset: number, width = 800): Feature {
  return {
    id: `door-${wallId}-${offset}`,
    kind: 'door',
    wallId,
    offset,
    width,
    blocksFloor: false,
    door: { hinge: 'start', swing: 'in', leafWidth: width, isPrimary: true },
  };
}

function windowAt(wallId: string, offset: number, width = 1200, sillHeight = 900): Feature {
  return {
    id: `win-${wallId}-${offset}`,
    kind: 'window',
    wallId,
    offset,
    width,
    sillHeight,
    blocksFloor: false,
  };
}

/** Everything piled toward one corner — roughly how a real room starts out. */
function scattered(items: readonly Item[]): Placement[] {
  return items.map((item, i) => ({
    itemId: item.id,
    pose: { x: 300 + (i % 3) * 600, y: 400 + Math.floor(i / 3) * 800, rot: 0 as const },
    locked: false,
  }));
}

function build(
  name: string,
  room: Room,
  types: readonly ItemType[],
  features: Feature[],
  wallIds: string[] = RECT_WALLS,
  roomIsSleeping = true,
): Fixture {
  const items = types.map((type, i) => itemFromPreset(`i${i}`, type));
  return {
    name,
    room,
    items,
    layout: { id: 'now', name: 'As it is now', kind: 'baseline', placements: scattered(items) },
    features,
    wallIds,
    roomIsSleeping,
  };
}

export const FIXTURES: readonly Fixture[] = [
  build(
    'bedroom 3.4 × 4.2',
    makeRectangularRoom(3400, 4200),
    ['bed', 'wardrobe', 'desk', 'nightstand', 'dresser'],
    [doorAt('w2', 1400), windowAt('w0', 1000)],
  ),

  /* Tight enough that most arrangements do not work at all. This is the one
     that catches a change making the search too eager to fill space. */
  build(
    'small bedroom 2.7 × 3.1',
    makeRectangularRoom(2700, 3100),
    ['bed', 'wardrobe', 'nightstand'],
    [doorAt('w2', 900)],
  ),

  build(
    'bedroom with two nightstands 3.0 × 3.4',
    makeRectangularRoom(3000, 3400),
    ['bed', 'nightstand', 'nightstand', 'wardrobe'],
    [doorAt('w2', 1100), windowAt('w0', 900)],
  ),

  build(
    'living room 4.5 × 5.5',
    makeRectangularRoom(4500, 5500),
    ['sofa', 'armchair', 'coffee-table', 'tv-stand', 'bookcase', 'rug'],
    [doorAt('w2', 1800), windowAt('w0', 1600, 1800)],
    RECT_WALLS,
    false,
  ),

  /* An L catches anything that quietly assumes the room is its bounding box. */
  build(
    'L-shaped 4.0 × 5.0',
    makeRoom([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2200 },
      { x: 2200, y: 2200 },
      { x: 2200, y: 5000 },
      { x: 0, y: 5000 },
    ]),
    ['bed', 'wardrobe', 'desk', 'nightstand'],
    [doorAt('w0', 600)],
    ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'],
  ),

  /* Big enough that the adaptive grid coarsens, which is where a performance
     assumption tuned on a bedroom quietly stops holding. */
  build(
    'large room 7.0 × 9.0',
    makeRectangularRoom(7000, 9000),
    ['bed', 'wardrobe', 'desk', 'sofa', 'bookcase', 'dining-table', 'dresser'],
    [doorAt('w2', 3000), windowAt('w0', 2500, 2000)],
    RECT_WALLS,
    false,
  ),
];
