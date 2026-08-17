import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rectContainsPoint, rectsOverlap } from '@/core/geometry';
import {
  type Feature,
  type HingeSide,
  featureGaps,
  featureRect,
  featureSpan,
  isEgressWindow,
  primaryDoor,
  primaryDoorWallIndex,
  wallsById,
} from '@/core/features';
import {
  doorLandingZone,
  doorSwingZone,
  egressZone,
  featureZones,
  fixtureFootprint,
  radiatorZone,
  sectorContains,
  slideTrackZone,
  windowOperateZone,
} from '@/core/openings';
import { makeRectangularRoom, roomContains, roomWalls } from '@/core/room';

const room = makeRectangularRoom(3400, 4200);
const walls = roomWalls(room);
// 0 = top (inward +y), 1 = right (inward −x), 2 = bottom (inward −y), 3 = left (inward +x)

function door(overrides: Partial<Feature> = {}, hinge: HingeSide = 'start'): Feature {
  return {
    id: 'd1',
    kind: 'door',
    wallId: 'w0',
    offset: 1000,
    width: 800,
    blocksFloor: false,
    door: { hinge, swing: 'in', leafWidth: 800, isPrimary: true },
    ...overrides,
  };
}

function aWindow(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'win1',
    kind: 'window',
    wallId: 'w0',
    offset: 1000,
    width: 1200,
    sillHeight: 900,
    headHeight: 2100,
    blocksFloor: false,
    ...overrides,
  };
}

describe('featureSpan and featureRect', () => {
  it('places a feature along its wall from the start vertex', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const span = featureSpan(wall, door());
    expect(span.start).toEqual({ x: 1000, y: 0 });
    expect(span.end).toEqual({ x: 1800, y: 0 });
    expect(span.mid).toEqual({ x: 1400, y: 0 });
  });

  it('projects into the room, never out of it', () => {
    for (const wall of walls) {
      const rect = featureRect(wall, { ...door(), offset: 500 }, 900);
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 };
      expect(roomContains(room, centre)).toBe(true);
    }
  });

  it('produces integer, axis-aligned rectangles on every wall', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 1000 }),
        (i, offset) => {
          const wall = walls[i];
          if (wall === undefined) return;
          const rect = featureRect(wall, { ...door(), offset }, 900);
          for (const v of [rect.x, rect.y, rect.w, rect.d]) expect(Number.isInteger(v)).toBe(true);
          expect(rect.w).toBeGreaterThan(0);
          expect(rect.d).toBeGreaterThan(0);
        },
      ),
    );
  });

  /* Two numbers that must add up with the width. That redundancy is the point:
     someone measuring 1200 from one corner and 900 from the other on a 3400
     wall with an 800 door has made an arithmetic error the form can catch. */
  it('reports both gaps, which sum to the wall with the feature', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const gaps = featureGaps(wall, door());
    expect(gaps).toEqual({ fromStart: 1000, fromEnd: 1600, fits: true });
    expect(gaps.fromStart + 800 + gaps.fromEnd).toBe(wall.length);
  });

  it('flags a feature that runs off the end of its wall', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(featureGaps(wall, door({ offset: 3000 })).fits).toBe(false);
  });
});

describe('door swing', () => {
  /* The failure this guards against is a leaf swept outside the room, which
     looks fine on a plan and silently frees up the one bit of floor that is
     actually unusable. Every wall, both hinge sides. */
  it('sweeps into the room on every wall and both hinges', () => {
    for (const wall of walls) {
      for (const hinge of ['start', 'end'] as HingeSide[]) {
        const zone = doorSwingZone(wall, door({ offset: 1200 }, hinge));
        expect(zone).not.toBeNull();
        if (zone === null || zone.sector === undefined) continue;

        /* Sample the arc's midpoint; it must be inside the room. */
        const mid = (zone.sector.fromDeg + zone.sector.toDeg) / 2;
        const rad = (mid * Math.PI) / 180;
        const probe = {
          x: zone.sector.center.x + zone.sector.radius * 0.6 * Math.cos(rad),
          y: zone.sector.center.y + zone.sector.radius * 0.6 * Math.sin(rad),
        };
        expect(roomContains(room, probe)).toBe(true);
      }
    }
  });

  it('hinges at the end of the opening the user picked', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(doorSwingZone(wall, door({}, 'start'))?.sector?.center).toEqual({ x: 1000, y: 0 });
    expect(doorSwingZone(wall, door({}, 'end'))?.sector?.center).toEqual({ x: 1800, y: 0 });
  });

  /* Doors open past square. A dresser at 91° of the leaf's travel is still in
     the way, and a 90° sweep would call that layout legal. */
  it('sweeps past 90 degrees', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const zone = doorSwingZone(wall, door());
    expect(zone?.sector).toBeDefined();
    if (zone?.sector === undefined) return;
    expect(Math.abs(zone.sector.toDeg - zone.sector.fromDeg)).toBe(95);
  });

  it('gives the leaf slack beyond its own width', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(doorSwingZone(wall, door())?.sector?.radius).toBe(820);
  });

  /* An outward door's leaf is outside the room, a pocket door disappears into
     the wall, and sliding doors get a track instead. None of them sweep. */
  it('produces no sector for swings that do not sweep', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    for (const swing of ['out', 'slide', 'bifold', 'pocket', 'none'] as const) {
      const f = door();
      expect(doorSwingZone(wall, { ...f, door: { ...f.door!, swing } })).toBeNull();
    }
  });

  it('bounds the sector by its arc, not just its endpoints', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const zone = doorSwingZone(wall, door());
    if (zone?.sector === undefined) throw new Error('missing sector');

    /* Every point of the sector must be inside the reported bounds. */
    for (let deg = zone.sector.fromDeg; deg <= zone.sector.toDeg; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const p = {
        x: zone.sector.center.x + zone.sector.radius * Math.cos(rad),
        y: zone.sector.center.y + zone.sector.radius * Math.sin(rad),
      };
      expect(p.x).toBeGreaterThanOrEqual(zone.bounds.x - 1);
      expect(p.x).toBeLessThanOrEqual(zone.bounds.x + zone.bounds.w + 1);
      expect(p.y).toBeGreaterThanOrEqual(zone.bounds.y - 1);
      expect(p.y).toBeLessThanOrEqual(zone.bounds.y + zone.bounds.d + 1);
    }
  });

  it('recognises points inside and outside the swept sector', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const zone = doorSwingZone(wall, door());
    if (zone?.sector === undefined) throw new Error('missing sector');

    /* Just inside the room, right in front of the hinge. */
    expect(sectorContains(zone.sector, { x: 1200, y: 300 })).toBe(true);
    /* Far away. */
    expect(sectorContains(zone.sector, { x: 3000, y: 3000 })).toBe(false);
    /* Behind the wall, outside the room. */
    expect(sectorContains(zone.sector, { x: 1200, y: -300 })).toBe(false);
  });
});

describe('door landing', () => {
  it('sits inside the room whichever way the door swings', () => {
    for (const wall of walls) {
      for (const swing of ['in', 'out', 'slide', 'pocket'] as const) {
        const f = door({ offset: 1200 });
        const zone = doorLandingZone(wall, { ...f, door: { ...f.door!, swing } });
        expect(zone).not.toBeNull();
        if (zone === null) continue;
        const centre = {
          x: zone.bounds.x + zone.bounds.w / 2,
          y: zone.bounds.y + zone.bounds.d / 2,
        };
        expect(roomContains(room, centre)).toBe(true);
      }
    }
  });

  it('is wider than the opening and 900 deep', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const zone = doorLandingZone(wall, door());
    expect(zone?.bounds.w).toBe(800 + 300);
    expect(zone?.bounds.d).toBe(900);
  });
});

describe('sliding doors', () => {
  /* Nothing else stops a wardrobe sitting exactly where the leaf slides — a
     layout that looks perfectly legal on the plan and cannot be used. */
  it('reserves the wall the leaf travels across', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const f = door();
    const slider = { ...f, door: { ...f.door!, swing: 'slide' as const } };

    const zone = slideTrackZone(wall, slider);
    expect(zone).not.toBeNull();
    if (zone === null) return;

    /* Hinged at the start, so the track runs back toward the wall start. */
    expect(zone.bounds.x).toBe(200);
    expect(zone.bounds.w).toBe(800);
    expect(zone.bounds.d).toBe(100);
  });

  it('puts the track on the other side for an end-hinged leaf', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const f = door({}, 'end');
    const slider = { ...f, door: { ...f.door!, swing: 'slide' as const } };
    expect(slideTrackZone(wall, slider)?.bounds.x).toBe(1800);
  });

  it('does not apply to hinged doors', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(slideTrackZone(wall, door())).toBeNull();
  });
});

describe('windows', () => {
  /* The single most valuable line in this file. If minHeight were 0, every
     window would forbid furniture beneath it, and the tool would write off the
     wall people most want to put a desk against. */
  it('lets a low item sit under the window and keeps a tall one out', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const zone = windowOperateZone(wall, aWindow({ sillHeight: 850 }));
    expect(zone?.minHeight).toBe(800);

    const desk = 750;
    const wardrobe = 2000;
    expect(desk).toBeLessThan(zone?.minHeight ?? 0);
    expect(wardrobe).toBeGreaterThan(zone?.minHeight ?? 0);
  });

  it('never asks for a negative height', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(windowOperateZone(wall, aWindow({ sillHeight: 0 }))?.minHeight).toBe(0);
  });

  it('reserves reaching room in front', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(windowOperateZone(wall, aWindow())?.bounds.d).toBe(600);
  });
});

describe('egress windows', () => {
  it('treats a low window in a sleeping room as an escape route', () => {
    expect(isEgressWindow(aWindow({ sillHeight: 900 }), true)).toBe(true);
    expect(isEgressWindow(aWindow({ sillHeight: 1400 }), true)).toBe(false);
    expect(isEgressWindow(aWindow({ sillHeight: 900 }), false)).toBe(false);
  });

  it('reserves deeper, exclusive floor in front of one', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const zone = egressZone(wall, aWindow(), true);
    expect(zone?.bounds.d).toBe(900);
    expect(zone?.share).toBe('exclusive');
    /* Still height-aware — a bench under an escape window is fine. */
    expect(zone?.minHeight).toBe(850);
  });

  it('produces nothing outside a sleeping room', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(egressZone(wall, aWindow(), false)).toBeNull();
  });
});

describe('fixtures', () => {
  it('stands a radiator on the floor and a wall TV on nothing', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');

    const radiator: Feature = {
      id: 'r1',
      kind: 'radiator',
      wallId: 'w0',
      offset: 500,
      width: 1000,
      projection: 80,
      blocksFloor: true,
    };
    const tv: Feature = {
      id: 't1',
      kind: 'tv-mount',
      wallId: 'w0',
      offset: 500,
      width: 1230,
      mountHeight: 1100,
      blocksFloor: false,
      tv: { diagonalMm: 1400, remountable: false },
    };

    expect(fixtureFootprint(wall, radiator)).toEqual({ x: 500, y: 0, w: 1000, d: 80 });
    expect(fixtureFootprint(wall, tv)).toBeNull();
    expect(radiatorZone(wall, radiator)?.bounds.d).toBe(300);
    expect(radiatorZone(wall, radiator)?.share).toBe('soft');
  });
});

describe('featureZones', () => {
  it('produces a swing and a landing for a hinged door', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(featureZones(wall, door(), true).map((z) => z.kind)).toEqual(['swing', 'landing']);
  });

  it('produces a track and a landing for a sliding door', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    const f = door();
    const slider = { ...f, door: { ...f.door!, swing: 'slide' as const } };
    expect(featureZones(wall, slider, true).map((z) => z.kind)).toEqual(['landing', 'slide-track']);
  });

  it('produces an operating and an egress zone for a low bedroom window', () => {
    const wall = walls[0];
    if (wall === undefined) throw new Error('missing wall');
    expect(featureZones(wall, aWindow(), true).map((z) => z.kind)).toEqual(['operate', 'egress']);
    expect(featureZones(wall, aWindow(), false).map((z) => z.kind)).toEqual(['operate']);
  });

  /* Zones constrain furniture, so they must land on real floor. */
  it('keeps every zone overlapping the room', () => {
    const bounds = { x: 0, y: 0, w: 3400, d: 4200 };
    for (const wall of walls) {
      for (const f of [door({ offset: 1200 }), aWindow({ offset: 800 })]) {
        for (const zone of featureZones(wall, f, true)) {
          expect(rectsOverlap(zone.bounds, bounds)).toBe(true);
        }
      }
    }
  });
});

describe('lookup', () => {
  it('finds walls by id and reports orphans', () => {
    const byId = wallsById(walls, ['w0', 'w1', 'w2', 'w3']);
    expect(byId.size).toBe(4);
    expect(byId.get('w2')?.index).toBe(2);
    expect(byId.get('nope')).toBeUndefined();
  });

  it('finds the primary door and its wall', () => {
    const features = [
      aWindow(),
      door({ id: 'd2', wallId: 'w2' }),
      { ...door({ id: 'd3', wallId: 'w1' }), door: { ...door().door!, isPrimary: false } },
    ];
    expect(primaryDoor(features)?.id).toBe('d2');
    expect(primaryDoorWallIndex(features, ['w0', 'w1', 'w2', 'w3'])).toBe(2);
  });

  it('reports no primary door rather than guessing at one', () => {
    expect(primaryDoor([aWindow()])).toBeNull();
    expect(primaryDoorWallIndex([aWindow()], ['w0'])).toBeUndefined();
  });
});

describe('geometry sanity', () => {
  it('keeps a landing inside the room bounds on every wall', () => {
    const roomRect = { x: 0, y: 0, w: 3400, d: 4200 };
    for (const wall of walls) {
      const zone = doorLandingZone(wall, door({ offset: 1200 }));
      if (zone === null) continue;
      const corner = { x: zone.bounds.x + 1, y: zone.bounds.y + 1 };
      expect(rectContainsPoint(roomRect, corner)).toBe(true);
    }
  });
});
