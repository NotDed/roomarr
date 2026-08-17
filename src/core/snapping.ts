import { type Rect, rectBottom, rectRight } from '@/core/geometry';
import { type Item, type Placement, itemById, itemRect, itemZones } from '@/core/items';
import { type Room, roomBounds, roomWalls } from '@/core/room';
import { type Mm, roundMm } from '@/core/units';

/**
 * Magnetic snapping.
 *
 * A 10 mm grid is not snapping. It makes every position a round number and
 * none of them meaningful: an item lands 10 mm off a wall and looks flush at
 * 1:50 while leaving a gap you cannot clean and the metric counts as nothing.
 * What people mean by "it snaps" is that the thing they are dragging finds the
 * relationships that matter — flush to a wall, aligned with the wardrobe,
 * centred under the window, clear of the bed's access strip.
 *
 * ## Snaps resolve per axis, independently
 *
 * The tempting model is a set of candidate *poses*, scored, best one wins. It
 * feels wrong immediately, and the reason is worth stating: relationships in a
 * room are one-dimensional. Being flush to the north wall constrains y and says
 * nothing about x. If a single winner takes both axes, then sliding along a
 * wall keeps re-deciding which snap owns the pose, and the item pops off the
 * wall to align with something else.
 *
 * So each axis is solved on its own. You can be flush to a wall in y while
 * centred on the window in x, and sliding along that wall does not disturb the
 * wall snap at all — the y target simply keeps winning. That is the difference
 * between snapping that helps and snapping people turn off.
 *
 * ## Sources and targets
 *
 * The moving item offers three *sources* per axis — its low edge, its centre,
 * its high edge. The room offers *targets*: lines at coordinates worth landing
 * on. A snap pairs a source with a target on the same axis, which makes both
 * "flush against the wardrobe" and "aligned with the wardrobe" fall out of the
 * same rule rather than needing separate cases — each item contributes both of
 * its edges as targets, and the mover brings both of its edges as sources.
 *
 * Targets declare which sources they accept. A wall face accepts an edge, never
 * a centre: aligning an item's centre line to the face of a wall means nothing
 * and would fight the flush snap two millimetres away.
 */

export type SnapAxis = 'x' | 'y';

/** Which line of the moving item is doing the aligning. */
export type SnapSource = 'min' | 'mid' | 'max';

export type SnapKind = 'edge' | 'center' | 'clearance' | 'gap';

/** Each kind is independently toggleable, because they suit different work. */
export interface SnapToggles {
  /** Walls and the edges of other items. */
  edge: boolean;
  /** Centre lines, item to item and against the room. */
  center: boolean;
  /** The outer edges of clearance zones — park just clear of the bed. */
  clearance: boolean;
  /** Centred between two things, and repeating a gap that already exists. */
  gap: boolean;
}

export const ALL_SNAPS: SnapToggles = { edge: true, center: true, clearance: true, gap: true };
export const NO_SNAPS: SnapToggles = { edge: false, center: false, clearance: false, gap: false };

/**
 * One line worth landing on.
 *
 * `span` is the extent of whatever generated it along the *other* axis. It has
 * no effect on the arithmetic; it is how the guide gets drawn from the thing
 * you aligned to rather than across the whole room, which is the difference
 * between a guide that explains itself and a line that just appears.
 */
export interface SnapTarget {
  axis: SnapAxis;
  kind: SnapKind;
  at: Mm;
  accepts: readonly SnapSource[];
  span: { from: Mm; to: Mm };
  /** Already a phrase, for the same reason violations are already sentences. */
  label: string;
  /** On `gap` targets only: the distance being matched, for the guide's label. */
  gap?: Mm;
}

export interface SnapHit {
  axis: SnapAxis;
  source: SnapSource;
  target: SnapTarget;
  /** The coordinate the item's min corner ends up at on this axis. */
  value: Mm;
  distance: Mm;
}

export interface SnapResult {
  x: Mm;
  y: Mm;
  /** At most one per axis, so at most two. Empty when nothing was near. */
  hits: readonly SnapHit[];
}

/**
 * Ties go to the more fundamental relationship.
 *
 * Two targets a millimetre apart is common — an item's edge and the outer edge
 * of a zero-depth clearance coincide exactly. Without a stated order the winner
 * depends on array order, and the guide flickers between two labels while the
 * pose does not move at all.
 */
const RANK: Record<SnapKind, number> = { edge: 0, center: 1, clearance: 2, gap: 3 };

function sourceValue(rect: Rect, axis: SnapAxis, source: SnapSource): number {
  const lo = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.w : rect.d;
  if (source === 'min') return lo;
  if (source === 'max') return lo + size;
  return lo + size / 2;
}

/** Where the min corner lands so that `source` sits on `at`. */
function poseFor(rect: Rect, axis: SnapAxis, source: SnapSource, at: number): Mm {
  const size = axis === 'x' ? rect.w : rect.d;
  if (source === 'min') return roundMm(at);
  if (source === 'max') return roundMm(at - size);
  return roundMm(at - size / 2);
}

/**
 * Resolve one axis.
 *
 * Nearest wins, ties broken by kind and then by coordinate, so the same drag
 * always produces the same snap. `null` means nothing was within tolerance and
 * the caller should keep whatever the pointer asked for.
 */
function resolveAxis(
  rect: Rect,
  axis: SnapAxis,
  targets: readonly SnapTarget[],
  tolerance: Mm,
): SnapHit | null {
  let best: SnapHit | null = null;

  for (const target of targets) {
    if (target.axis !== axis) continue;

    for (const source of target.accepts) {
      const distance = Math.abs(sourceValue(rect, axis, source) - target.at);
      if (distance > tolerance) continue;

      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance &&
          (RANK[target.kind] < RANK[best.target.kind] ||
            (RANK[target.kind] === RANK[best.target.kind] && target.at < best.target.at)))
      ) {
        best = { axis, source, target, value: poseFor(rect, axis, source, target.at), distance };
      }
    }
  }

  return best;
}

/**
 * Snap a rectangle to the nearest target on each axis.
 *
 * `rect` is where the pointer is asking for the item to be. The result is where
 * it should actually go, plus what it landed on.
 */
export function snapRect(rect: Rect, targets: readonly SnapTarget[], tolerance: Mm): SnapResult {
  const x = resolveAxis(rect, 'x', targets, tolerance);
  const y = resolveAxis(rect, 'y', targets, tolerance);

  return {
    x: x === null ? rect.x : x.value,
    y: y === null ? rect.y : y.value,
    hits: [x, y].filter((hit): hit is SnapHit => hit !== null),
  };
}

// ── Collecting targets ────────────────────────────────────────────────────

export interface TargetInput {
  room: Room;
  items: readonly Item[];
  placements: readonly Placement[];
  /** The item being dragged. It never snaps to itself. */
  movingId: string;
  /** Where the drag currently wants it — used to filter irrelevant gaps. */
  movingRect: Rect;
  toggles: SnapToggles;
}

const EDGE_SOURCES: readonly SnapSource[] = ['min', 'max'];
const MID_SOURCE: readonly SnapSource[] = ['mid'];

function edgeTarget(
  axis: SnapAxis,
  at: Mm,
  span: { from: Mm; to: Mm },
  label: string,
  kind: SnapKind = 'edge',
): SnapTarget {
  return { axis, kind, at, accepts: EDGE_SOURCES, span, label };
}

/**
 * Every line worth snapping to, given what is in the room.
 *
 * Order does not matter to the result — `resolveAxis` breaks ties explicitly —
 * but it is grouped by kind here so the toggles read as what they turn off.
 */
export function collectTargets(input: TargetInput): SnapTarget[] {
  const { room, items, placements, movingId, movingRect, toggles } = input;
  const targets: SnapTarget[] = [];
  const bounds = roomBounds(room);

  const others: { item: Item; placement: Placement }[] = [];
  for (const placement of placements) {
    if (placement.itemId === movingId) continue;
    const item = itemById(items, placement.itemId);
    if (item !== undefined) others.push({ item, placement });
  }

  if (toggles.edge) {
    /* Wall faces. The outline is the inner face, so these are exactly the lines
       an item sits flush against — no thickness correction, which is the kind
       of off-by-a-wall error that only shows up on the printed blueprint. */
    for (const wall of roomWalls(room)) {
      const span =
        wall.axis === 'vertical'
          ? { from: Math.min(wall.start.y, wall.end.y), to: Math.max(wall.start.y, wall.end.y) }
          : { from: Math.min(wall.start.x, wall.end.x), to: Math.max(wall.start.x, wall.end.x) };

      targets.push(
        wall.axis === 'vertical'
          ? edgeTarget('x', wall.start.x, span, 'wall')
          : edgeTarget('y', wall.start.y, span, 'wall'),
      );
    }

    for (const { item, placement } of others) {
      const r = itemRect(item, placement);
      targets.push(
        edgeTarget('x', r.x, { from: r.y, to: rectBottom(r) }, item.name),
        edgeTarget('x', rectRight(r), { from: r.y, to: rectBottom(r) }, item.name),
        edgeTarget('y', r.y, { from: r.x, to: rectRight(r) }, item.name),
        edgeTarget('y', rectBottom(r), { from: r.x, to: rectRight(r) }, item.name),
      );
    }
  }

  if (toggles.center) {
    targets.push(
      {
        axis: 'x',
        kind: 'center',
        at: roundMm(bounds.x + bounds.w / 2),
        accepts: MID_SOURCE,
        span: { from: bounds.y, to: bounds.y + bounds.d },
        label: 'centre of the room',
      },
      {
        axis: 'y',
        kind: 'center',
        at: roundMm(bounds.y + bounds.d / 2),
        accepts: MID_SOURCE,
        span: { from: bounds.x, to: bounds.x + bounds.w },
        label: 'centre of the room',
      },
    );

    for (const { item, placement } of others) {
      const r = itemRect(item, placement);
      targets.push(
        {
          axis: 'x',
          kind: 'center',
          at: roundMm(r.x + r.w / 2),
          accepts: MID_SOURCE,
          span: { from: r.y, to: rectBottom(r) },
          label: `centred on the ${item.name.toLowerCase()}`,
        },
        {
          axis: 'y',
          kind: 'center',
          at: roundMm(r.y + r.d / 2),
          accepts: MID_SOURCE,
          span: { from: r.x, to: rectRight(r) },
          label: `centred on the ${item.name.toLowerCase()}`,
        },
      );
    }
  }

  if (toggles.clearance) {
    /* The *outer* edge only. The inner edge is the item's own edge, which the
       edge kind already offers and offers better — a duplicate there would mean
       turning off "edges" silently left the same line behind under another
       name. */
    for (const { item, placement } of others) {
      const base = itemRect(item, placement);

      for (const { rule, rect } of itemZones(item, placement)) {
        if (rule.depth <= 0) continue;
        const label = `clear of the ${item.name.toLowerCase()}`;

        if (rect.x + rect.w <= base.x) {
          targets.push(
            edgeTarget('x', rect.x, { from: rect.y, to: rectBottom(rect) }, label, 'clearance'),
          );
        } else if (rect.x >= base.x + base.w) {
          targets.push(
            edgeTarget(
              'x',
              rectRight(rect),
              { from: rect.y, to: rectBottom(rect) },
              label,
              'clearance',
            ),
          );
        } else if (rect.y + rect.d <= base.y) {
          targets.push(
            edgeTarget('y', rect.y, { from: rect.x, to: rectRight(rect) }, label, 'clearance'),
          );
        } else {
          targets.push(
            edgeTarget(
              'y',
              rectBottom(rect),
              { from: rect.x, to: rectRight(rect) },
              label,
              'clearance',
            ),
          );
        }
      }
    }
  }

  if (toggles.gap) {
    targets.push(
      ...gapTargets('x', movingRect, bounds, others),
      ...gapTargets('y', movingRect, bounds, others),
    );
  }

  return targets;
}

/**
 * Gap targets: centred between two things, and repeating a gap that exists.
 *
 * Only obstacles that overlap the moving item on the *other* axis count. A
 * bookcase at the far end of the room is not something the desk is "between",
 * and including it produces targets that are arithmetically real and visually
 * nonsense — the single biggest source of noise in this kind of feature.
 */
function gapTargets(
  axis: SnapAxis,
  moving: Rect,
  bounds: Rect,
  others: readonly { item: Item; placement: Placement }[],
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const size = axis === 'x' ? moving.w : moving.d;

  const perpLo = axis === 'x' ? moving.y : moving.x;
  const perpHi = axis === 'x' ? rectBottom(moving) : rectRight(moving);

  /* The room walls act as obstacles too, so "centred in the room" and "centred
     between the wardrobe and the wall" are the same rule rather than a special
     case for each. */
  const roomLo = axis === 'x' ? bounds.x : bounds.y;
  const roomHi = axis === 'x' ? bounds.x + bounds.w : bounds.y + bounds.d;

  /* Zero-width, so the free span between a wall and the first item is exactly
     the gap from that wall and needs no special case downstream. */
  const spans: { lo: Mm; hi: Mm; label: string }[] = [{ lo: roomLo, hi: roomLo, label: 'wall' }];

  for (const { item, placement } of others) {
    const r = itemRect(item, placement);
    const rLo = axis === 'x' ? r.y : r.x;
    const rHi = axis === 'x' ? rectBottom(r) : rectRight(r);
    if (rHi <= perpLo || rLo >= perpHi) continue;

    spans.push({
      lo: axis === 'x' ? r.x : r.y,
      hi: axis === 'x' ? rectRight(r) : rectBottom(r),
      label: item.name.toLowerCase(),
    });
  }

  spans.push({ lo: roomHi, hi: roomHi, label: 'wall' });
  spans.sort((a, b) => a.lo - b.lo || a.hi - b.hi);

  const span = { from: perpLo, to: perpHi };
  const gaps: Mm[] = [];

  for (let i = 0; i < spans.length - 1; i++) {
    const left = spans[i];
    const right = spans[i + 1];
    if (left === undefined || right === undefined) continue;

    const free = right.lo - left.hi;
    if (free <= 0) continue;

    /* Centred in the space between them, when the item actually fits there. */
    if (free >= size) {
      targets.push({
        axis,
        kind: 'gap',
        at: roundMm(left.hi + free / 2),
        accepts: MID_SOURCE,
        span,
        label: `centred between the ${left.label} and the ${right.label}`,
        gap: roundMm((free - size) / 2),
      });
    }

    /* A spacing the drag can repeat. This is the two-nightstands case: set one
       80 mm off the bed, and the second finds 80 mm on the other side by
       itself.

       Only gaps the moving item does not fit into count as spacings. A gap it
       fits into is somewhere to *go*, and is already offered as a centred
       target above; treating the same gap as both produces two targets a few
       millimetres apart that mean different things. */
    if (free < size) gaps.push(free);
  }

  for (const gap of new Set(gaps)) {
    for (const other of spans) {
      targets.push(
        {
          axis,
          kind: 'gap',
          at: roundMm(other.hi + gap),
          accepts: ['min'],
          span,
          label: `same ${gap} mm gap`,
          gap,
        },
        {
          axis,
          kind: 'gap',
          at: roundMm(other.lo - gap),
          accepts: ['max'],
          span,
          label: `same ${gap} mm gap`,
          gap,
        },
      );
    }
  }

  return targets;
}
