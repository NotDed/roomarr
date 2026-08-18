import { type Pose, type Rot, poseCenter } from '@/core/geometry';
import { type Item, type Layout, itemById } from '@/core/items';
import { type Mm, roundMm } from '@/core/units';

/**
 * What changed between two arrangements.
 *
 * The comparison view needs this, and so does the printed move plan two
 * milestones from now — which is the reason it lives in core as a function over
 * two layouts rather than inside whichever screen happened to need it first.
 * A move list the app shows and a move list the app prints must be the same
 * list, or one of them is wrong and there is no way to tell which.
 *
 * ## Rotation is reported, not folded into distance
 *
 * "The wardrobe moves 1.2 m" and "the wardrobe turns to face the other way" are
 * different physical acts with different difficulties, and a single scalar that
 * mixes them helps with neither. A quarter turn in place is often the whole
 * suggestion, and it would otherwise read as a move of zero.
 */

export interface Move {
  itemId: string;
  name: string;
  from: Pose;
  to: Pose;
  /**
   * How far the item's centre travels.
   *
   * Centre rather than corner, because a pure rotation moves the corner of a
   * non-square item while leaving it in the same place — reporting that as
   * "moves 470 mm" would be a lie about a piece of furniture that stayed put.
   */
  distance: Mm;
  /** Quarter turns, signed and reduced to −1, 0, 1 or 2. */
  turns: -1 | 0 | 1 | 2;
}

export interface LayoutDiff {
  moves: Move[];
  /** Items in both layouts that did not change at all. */
  unchanged: string[];
  /** Items placed in only one of the two, which should not normally happen. */
  onlyInFrom: string[];
  onlyInTo: string[];
}

/**
 * Signed quarter turns from `a` to `b`, taking the short way round.
 *
 * Three turns clockwise is one turn anticlockwise, and telling somebody to
 * rotate a wardrobe 270° when they could turn it 90° the other way is the kind
 * of instruction that gets a tool ignored. Two turns has no short way and stays
 * positive.
 */
export function turnsBetween(a: Rot, b: Rot): -1 | 0 | 1 | 2 {
  const delta = (((b - a) % 4) + 4) % 4;
  return delta === 3 ? -1 : (delta as 0 | 1 | 2);
}

export function diffLayouts(items: readonly Item[], from: Layout, to: Layout): LayoutDiff {
  const moves: Move[] = [];
  const unchanged: string[] = [];
  const onlyInTo: string[] = [];

  const before = new Map(from.placements.map((p) => [p.itemId, p]));

  for (const after of to.placements) {
    const was = before.get(after.itemId);
    if (was === undefined) {
      onlyInTo.push(after.itemId);
      continue;
    }

    if (
      was.pose.x === after.pose.x &&
      was.pose.y === after.pose.y &&
      was.pose.rot === after.pose.rot
    ) {
      unchanged.push(after.itemId);
      continue;
    }

    const item = itemById(items, after.itemId);
    if (item === undefined) continue;

    /* The unrotated footprint: `poseCenter` applies the rotation itself.
       Handing it a pre-rotated size rotates twice, which reads as a 389 mm
       move for a bed that turned in place without going anywhere. */
    const a = poseCenter(was.pose, item.footprint);
    const b = poseCenter(after.pose, item.footprint);

    moves.push({
      itemId: after.itemId,
      name: item.name,
      from: was.pose,
      to: after.pose,
      distance: roundMm(Math.hypot(b.x - a.x, b.y - a.y)),
      turns: turnsBetween(was.pose.rot, after.pose.rot),
    });
  }

  /* Sorted by how much work each one is. Someone reading a move list wants to
     know what they are in for, and the heavy item crossing the room is the
     thing that decides whether the whole plan is worth doing. */
  moves.sort((x, y) => y.distance - x.distance || x.name.localeCompare(y.name));

  const seen = new Set(to.placements.map((p) => p.itemId));
  const onlyInFrom = from.placements.map((p) => p.itemId).filter((id) => !seen.has(id));

  return { moves, unchanged, onlyInFrom, onlyInTo };
}

/**
 * "Nothing moves" / "1 thing moves" / "3 things move, one of them turns".
 *
 * A sentence rather than a count, because the count alone leaves the reader to
 * work out whether that is a lot. Rotations are called out separately for the
 * same reason they are stored separately: turning a wardrobe in place and
 * carrying it across the room are not the same job.
 */
export function describeDiff(diff: LayoutDiff): string {
  const { moves } = diff;
  if (moves.length === 0) return 'Nothing moves';

  const turned = moves.filter((m) => m.turns !== 0).length;
  const shifted = moves.filter((m) => m.distance > 0).length;

  const head =
    shifted === 0
      ? turned === 1
        ? '1 thing turns'
        : `${turned} things turn`
      : shifted === 1
        ? '1 thing moves'
        : `${shifted} things move`;

  if (shifted === 0 || turned === 0) return head;
  return `${head}, ${turned === 1 ? 'one of them turns' : `${turned} of them turn`}`;
}
