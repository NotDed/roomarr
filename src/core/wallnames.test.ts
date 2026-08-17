import { describe, expect, it } from 'vitest';
import type { Vec } from '@/core/geometry';
import { deriveWalls, makeRectangularRoom, roomWalls } from '@/core/room';
import { cornerLabel, nameWalls, wallLabel } from '@/core/wallnames';

const room = makeRectangularRoom(3400, 4200);
const walls = roomWalls(room);
// walls: 0 = top, 1 = right, 2 = bottom, 3 = left

const L_SHAPE: Vec[] = [
  { x: 0, y: 0 },
  { x: 3400, y: 0 },
  { x: 3400, y: 2700 },
  { x: 2600, y: 2700 },
  { x: 2600, y: 4200 },
  { x: 0, y: 4200 },
];

describe('nameWalls with a door', () => {
  /* Standing in the doorway looking in, the wall AFTER the door wall clockwise
     is on your left. Worth asserting rather than trusting: with the door in the
     south wall you face north, so west is on your left — and clockwise from
     south is west. If this is inverted, every printed instruction sends the
     user to the opposite side of the room. */
  it('names the four walls relative to the door', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2 }); // door in the bottom wall
    expect(naming.walls.map((w) => w.label)).toEqual([
      'Far Wall', // top — opposite the door
      'Right Wall', // right
      'Door Wall', // bottom
      'Left Wall', // left
    ]);
  });

  it('rotates the names with the door, on every wall', () => {
    expect(nameWalls(walls, { doorWallIndex: 0 }).walls.map((w) => w.label)).toEqual([
      'Door Wall',
      'Left Wall',
      'Far Wall',
      'Right Wall',
    ]);
    expect(nameWalls(walls, { doorWallIndex: 1 }).walls.map((w) => w.label)).toEqual([
      'Right Wall',
      'Door Wall',
      'Left Wall',
      'Far Wall',
    ]);
    expect(nameWalls(walls, { doorWallIndex: 3 }).walls.map((w) => w.label)).toEqual([
      'Left Wall',
      'Far Wall',
      'Right Wall',
      'Door Wall',
    ]);
  });

  it('always produces exactly one of each name', () => {
    for (const doorWallIndex of [0, 1, 2, 3]) {
      const labels = nameWalls(walls, { doorWallIndex }).walls.map((w) => w.label);
      expect(new Set(labels).size).toBe(4);
      expect(labels).toContain('Door Wall');
      expect(labels).toContain('Far Wall');
      expect(labels).toContain('Left Wall');
      expect(labels).toContain('Right Wall');
    }
  });
});

describe('nameWalls without a door', () => {
  /* Honest lettering beats a confident guess. Without a door there is no shared
     frame of reference, and inventing "Left Wall" would send half of users to
     the wrong side of the room. */
  it('falls back to letters', () => {
    expect(nameWalls(walls).walls.map((w) => w.label)).toEqual([
      'Wall A',
      'Wall B',
      'Wall C',
      'Wall D',
    ]);
  });

  it('ignores a door index that is out of range', () => {
    expect(nameWalls(walls, { doorWallIndex: 9 }).walls[0]?.label).toBe('Wall A');
    expect(nameWalls(walls, { doorWallIndex: -1 }).walls[0]?.label).toBe('Wall A');
  });
});

describe('nameWalls on more than four walls', () => {
  const lWalls = deriveWalls(L_SHAPE);

  /* "Left Wall" is meaningless in a six-walled room and would be worse than a
     letter, because it sounds authoritative. */
  it('uses letters, starting at the door and running clockwise', () => {
    const naming = nameWalls(lWalls, { doorWallIndex: 4 });
    expect(naming.walls.map((w) => w.label)).toEqual([
      'Wall C',
      'Wall D',
      'Wall E',
      'Wall F',
      'Wall A (door wall)',
      'Wall B',
    ]);
  });

  it('gives every wall a distinct name', () => {
    const labels = nameWalls(lWalls, { doorWallIndex: 0 }).walls.map((w) => w.label);
    expect(new Set(labels).size).toBe(lWalls.length);
  });
});

describe('user labels', () => {
  it('always win over a derived name', () => {
    const naming = nameWalls(walls, {
      doorWallIndex: 2,
      labels: { 0: 'The window wall' },
    });
    expect(naming.walls[0]).toEqual({ index: 0, label: 'The window wall', custom: true });
    expect(naming.walls[1]?.custom).toBe(false);
  });

  it('ignores a blank label rather than printing an empty name', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2, labels: { 0: '   ' } });
    expect(naming.walls[0]?.label).toBe('Far Wall');
    expect(naming.walls[0]?.custom).toBe(false);
  });

  it('trims a label', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2, labels: { 0: '  Window wall  ' } });
    expect(naming.walls[0]?.label).toBe('Window wall');
  });
});

describe('corners', () => {
  /* A corner is how a tape measure is anchored, so it has to be identifiable
     by the two walls that meet there — not by a vertex number that is an
     artifact of the polygon's winding. */
  it('names each corner by the two walls meeting there', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2 });
    expect(naming.corners.map((c) => c.label)).toEqual([
      'C3 (Left Wall × Far Wall)', // vertex 0: wall 3 meets wall 0
      'C4 (Far Wall × Right Wall)', // vertex 1
      'C1 (Right Wall × Door Wall)', // vertex 2: start of the door wall
      'C2 (Door Wall × Left Wall)', // vertex 3
    ]);
  });

  it('numbers corners clockwise from the door wall start', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2 });
    expect(naming.corners.find((c) => c.index === 2)?.tag).toBe('C1');
    expect(naming.corners.map((c) => c.tag).toSorted()).toEqual(['C1', 'C2', 'C3', 'C4']);
  });

  it('records the wall pair so a drawing can highlight both', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2 });
    expect(naming.corners.find((c) => c.index === 0)?.wallIndices).toEqual([3, 0]);
  });

  it('picks up custom wall names', () => {
    const naming = nameWalls(walls, { doorWallIndex: 2, labels: { 0: 'Window wall' } });
    expect(naming.corners.find((c) => c.index === 0)?.label).toBe('C3 (Left Wall × Window wall)');
  });
});

describe('lookups', () => {
  const naming = nameWalls(walls, { doorWallIndex: 2 });

  it('finds a wall or a corner by index', () => {
    expect(wallLabel(naming, 0)).toBe('Far Wall');
    expect(cornerLabel(naming, 2)).toBe('C1 (Right Wall × Door Wall)');
  });

  it('falls back rather than throwing on an unknown index', () => {
    expect(wallLabel(naming, 99)).toBe('Wall 99');
    expect(cornerLabel(naming, 99)).toBe('Corner 99');
  });
});
