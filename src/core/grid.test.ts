import { describe, expect, it } from 'vitest';
import { CELL, PLAYER_RADIUS, WALL_THICKNESS } from './constants';
import { buildColliders, isPathBlocked, resolveCircle } from './collision';
import { addPartitionLine, autoHang, createExhibitionFromTemplate, createFloor, fillRect, TEMPLATES } from './factory';
import { computeWallEdges, edgeKey, facePose, hasWall, invalidWallItemIds, isFaceValid, mergeWallRuns, nearestFace, orderedFaces, resolveSpawn } from './grid';
import type { Artwork } from './types';

function room(cols = 4, rows = 3) {
  const f = createFloor('1F', cols + 2, rows + 2);
  fillRect(f, 1, 1, cols, rows);
  return f;
}

describe('walls', () => {
  it('creates boundary walls around a filled rectangle', () => {
    const f = room(4, 3);
    const edges = computeWallEdges(f);
    // 둘레 = 2*(4+3) = 14 개 모서리
    expect(edges.length).toBe(14);
    expect(edges.every((e) => e.boundary)).toBe(true);
    const runs = mergeWallRuns(edges);
    expect(runs.length).toBe(4);
  });

  it('only counts partitions between two filled cells', () => {
    const f = room(4, 3);
    addPartitionLine(f, 'v', 3, 1, 3); // 방 가운데 세로벽
    addPartitionLine(f, 'h', 0, 0, 2); // 바닥 밖 → 무시
    const inner = computeWallEdges(f).filter((e) => !e.boundary);
    expect(inner.length).toBe(3);
    expect(hasWall(f, edgeKey('v', 3, 2))).toBe(true);
    expect(hasWall(f, edgeKey('h', 1, 0))).toBe(false);
  });

  it('validates wall faces by facing side', () => {
    const f = room(2, 2);
    // 위쪽 경계벽(h:1:1)은 +z 방향(방 안쪽)으로만 유효
    expect(isFaceValid(f, { edge: edgeKey('h', 1, 1), side: 1 })).toBe(true);
    expect(isFaceValid(f, { edge: edgeKey('h', 1, 1), side: -1 })).toBe(false);
  });
});

describe('face pose', () => {
  it('places the face on the wall surface and points the normal into the room', () => {
    const p = facePose({ edge: edgeKey('h', 1, 1), side: 1 });
    expect(p.z).toBeCloseTo(CELL + WALL_THICKNESS / 2);
    expect(p.x).toBeCloseTo(1.5 * CELL);
    expect([p.nx, p.nz]).toEqual([0, 1]);
    expect(p.rotY).toBeCloseTo(0);
    const q = facePose({ edge: edgeKey('v', 3, 1), side: -1 }, 0.5);
    expect(q.nx).toBe(-1);
    // 벽을 바라볼 때 오른쪽 = +z 방향 (법선 -x)
    expect(q.rz).toBeCloseTo(1);
    expect(q.z).toBeCloseTo(1.5 * CELL + 0.5);
  });

  it('finds the nearest valid face from a point', () => {
    const f = room(3, 3);
    const hit = nearestFace(f, 1.5 * CELL, 1.15 * CELL)!;
    expect(hit.edge).toBe(edgeKey('h', 1, 1));
    expect(hit.side).toBe(1);
  });
});

describe('collision', () => {
  it('keeps the player inside the room', () => {
    const f = room(3, 3);
    const col = buildColliders(f);
    const [x, z] = resolveCircle(1.5 * CELL, CELL + 0.05, PLAYER_RADIUS, col);
    expect(z).toBeGreaterThanOrEqual(CELL + WALL_THICKNESS / 2 + PLAYER_RADIUS - 1e-6);
    expect(x).toBeCloseTo(1.5 * CELL);
  });

  it('pushes out of rotated props', () => {
    const f = room(3, 3);
    f.props.push({ id: 'b', type: 'bench', x: 4, z: 4, rotation: Math.PI / 2 });
    const col = buildColliders(f);
    // 90° 회전한 벤치는 z 방향으로 길다 → (4, 4.6) 은 벤치 안쪽
    const [x, z] = resolveCircle(4, 4.6, PLAYER_RADIUS, col);
    expect(Math.abs(x - 4)).toBeGreaterThan(0.25 + PLAYER_RADIUS - 0.01);
    expect(z).toBeCloseTo(4.6);
  });

  it('detects blocked line of sight', () => {
    const f = room(4, 2);
    addPartitionLine(f, 'v', 3, 1, 2);
    const col = buildColliders(f);
    expect(isPathBlocked(1.5 * CELL, 1.5 * CELL, 3.5 * CELL, 1.5 * CELL, col)).toBe(true);
    expect(isPathBlocked(1.5 * CELL, 1.5 * CELL, 2.5 * CELL, 1.5 * CELL, col)).toBe(false);
  });
});

describe('templates & auto hang', () => {
  it('all templates produce valid floors', () => {
    for (const t of TEMPLATES) {
      const ex = createExhibitionFromTemplate(t.id, t.name);
      for (const f of ex.floors) {
        expect(f.cells.length).toBe(f.cols * f.rows);
        expect(invalidWallItemIds(f).size).toBe(0);
        const s = resolveSpawn(f);
        if (f.cells.some((c) => c === 1)) expect(f.cells[Math.floor(s.z / CELL) * f.cols + Math.floor(s.x / CELL)]).toBe(1);
      }
    }
  });

  it('hangs artworks on distinct valid faces', () => {
    const f = room(3, 3);
    const arts: Artwork[] = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, source: { kind: 'sample', index: i }, width: 4, height: 3, title: '', artist: '', year: '', description: '' }));
    const n = autoHang(f, arts);
    expect(n).toBe(orderedFaces(f).length);
    expect(n).toBe(12);
    const faces = new Set(f.wallItems.map((w) => `${w.edge}|${w.side}`));
    expect(faces.size).toBe(n);
    expect(invalidWallItemIds(f).size).toBe(0);
  });
});
