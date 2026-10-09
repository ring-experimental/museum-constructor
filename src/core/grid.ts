import { CELL, WALL_THICKNESS } from './constants';
import type { EdgeKey, Floor, Spawn, WallItem, WallSide } from './types';

export type EdgeDir = 'h' | 'v';

export interface EdgeRef {
  dir: EdgeDir;
  i: number;
  j: number;
}

export interface WallEdge extends EdgeRef {
  key: EdgeKey;
  boundary: boolean;
}

export interface WallRun {
  dir: EdgeDir;
  /** 세계 좌표 (m) */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface WallFace {
  edge: EdgeKey;
  side: WallSide;
}

export interface FacePose {
  /** 벽 표면 위의 기준점 (offset 반영) */
  x: number;
  z: number;
  /** 벽에서 방 쪽으로 향하는 법선 */
  nx: number;
  nz: number;
  /** 벽을 바라볼 때 오른쪽 방향 */
  rx: number;
  rz: number;
  /** +Z 를 법선으로 돌리는 Y축 회전 */
  rotY: number;
}

export const edgeKey = (dir: EdgeDir, i: number, j: number): EdgeKey => `${dir}:${i}:${j}`;

export function parseEdge(key: EdgeKey): EdgeRef {
  const [dir, i, j] = key.split(':');
  return { dir: dir as EdgeDir, i: Number(i), j: Number(j) };
}

export function inBounds(floor: Floor, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < floor.cols && j < floor.rows;
}

export function isFilled(floor: Floor, i: number, j: number): boolean {
  return inBounds(floor, i, j) && floor.cells[j * floor.cols + i] === 1;
}

/** 모서리 양쪽 칸: [음(-)쪽 칸, 양(+)쪽 칸] */
export function edgeCells(e: EdgeRef): [[number, number], [number, number]] {
  return e.dir === 'h'
    ? [
        [e.i, e.j - 1],
        [e.i, e.j],
      ]
    : [
        [e.i - 1, e.j],
        [e.i, e.j],
      ];
}

export function edgeExistsInGrid(floor: Floor, e: EdgeRef): boolean {
  if (e.dir === 'h') return e.i >= 0 && e.i < floor.cols && e.j >= 0 && e.j <= floor.rows;
  return e.i >= 0 && e.i <= floor.cols && e.j >= 0 && e.j < floor.rows;
}

export function hasWall(floor: Floor, key: EdgeKey, partitions?: Set<EdgeKey>): boolean {
  const e = parseEdge(key);
  const [[ai, aj], [bi, bj]] = edgeCells(e);
  const a = isFilled(floor, ai, aj);
  const b = isFilled(floor, bi, bj);
  if (a !== b) return true;
  if (!a) return false;
  return (partitions ?? new Set(floor.partitions)).has(key);
}

export function computeWallEdges(floor: Floor): WallEdge[] {
  const parts = new Set(floor.partitions);
  const out: WallEdge[] = [];
  for (let j = 0; j <= floor.rows; j++) {
    for (let i = 0; i < floor.cols; i++) {
      const a = isFilled(floor, i, j - 1);
      const b = isFilled(floor, i, j);
      const key = edgeKey('h', i, j);
      if (a !== b) out.push({ dir: 'h', i, j, key, boundary: true });
      else if (a && parts.has(key)) out.push({ dir: 'h', i, j, key, boundary: false });
    }
  }
  for (let i = 0; i <= floor.cols; i++) {
    for (let j = 0; j < floor.rows; j++) {
      const a = isFilled(floor, i - 1, j);
      const b = isFilled(floor, i, j);
      const key = edgeKey('v', i, j);
      if (a !== b) out.push({ dir: 'v', i, j, key, boundary: true });
      else if (a && parts.has(key)) out.push({ dir: 'v', i, j, key, boundary: false });
    }
  }
  return out;
}

/** 같은 직선 위에 이어진 벽 모서리를 하나의 긴 벽으로 병합 */
export function mergeWallRuns(edges: WallEdge[]): WallRun[] {
  const runs: WallRun[] = [];
  const groups = new Map<string, number[]>();
  for (const e of edges) {
    const g = e.dir === 'h' ? `h${e.j}` : `v${e.i}`;
    const along = e.dir === 'h' ? e.i : e.j;
    let arr = groups.get(g);
    if (!arr) groups.set(g, (arr = []));
    arr.push(along);
  }
  for (const [g, arr] of groups) {
    const dir = g[0] as EdgeDir;
    const line = Number(g.slice(1));
    arr.sort((a, b) => a - b);
    let start = arr[0];
    let prev = arr[0];
    const flush = (s: number, e: number) => {
      if (dir === 'h') runs.push({ dir, x1: s * CELL, z1: line * CELL, x2: (e + 1) * CELL, z2: line * CELL });
      else runs.push({ dir, x1: line * CELL, z1: s * CELL, x2: line * CELL, z2: (e + 1) * CELL });
    };
    for (let k = 1; k < arr.length; k++) {
      if (arr[k] === prev + 1) {
        prev = arr[k];
        continue;
      }
      flush(start, prev);
      start = prev = arr[k];
    }
    flush(start, prev);
  }
  return runs;
}

/** 벽면(edge+side)이 바라보는 칸 */
export function facingCell(face: WallFace): [number, number] {
  const e = parseEdge(face.edge);
  const [neg, pos] = edgeCells(e);
  return face.side === 1 ? pos : neg;
}

export function isFaceValid(floor: Floor, face: WallFace, partitions?: Set<EdgeKey>): boolean {
  if (!hasWall(floor, face.edge, partitions)) return false;
  const [ci, cj] = facingCell(face);
  return isFilled(floor, ci, cj);
}

export function facePose(face: WallFace, offset = 0, inset = WALL_THICKNESS / 2): FacePose {
  const e = parseEdge(face.edge);
  let cx: number, cz: number, nx: number, nz: number;
  if (e.dir === 'h') {
    cx = (e.i + 0.5) * CELL;
    cz = e.j * CELL;
    nx = 0;
    nz = face.side;
  } else {
    cx = e.i * CELL;
    cz = (e.j + 0.5) * CELL;
    nx = face.side;
    nz = 0;
  }
  const rx = nz;
  const rz = -nx;
  return {
    x: cx + nx * inset + rx * offset,
    z: cz + nz * inset + rz * offset,
    nx,
    nz,
    rx,
    rz,
    rotY: Math.atan2(nx, nz),
  };
}

export function wallItemPose(item: WallItem): FacePose {
  return facePose(item, item.offset);
}

export interface FaceHit extends WallFace {
  /** 점에서 벽면까지 거리 */
  dist: number;
  /** 벽면 중심 기준, 오른쪽 방향으로의 투영 거리 */
  along: number;
}

/** 주어진 점에서 가장 가까운 유효한 벽면 */
export function nearestFace(floor: Floor, x: number, z: number, maxDist = CELL * 0.8): FaceHit | null {
  const parts = new Set(floor.partitions);
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(z / CELL);
  let best: FaceHit | null = null;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (!isFilled(floor, i, j)) continue;
      const faces: WallFace[] = [
        { edge: edgeKey('h', i, j), side: 1 },
        { edge: edgeKey('h', i, j + 1), side: -1 },
        { edge: edgeKey('v', i, j), side: 1 },
        { edge: edgeKey('v', i + 1, j), side: -1 },
      ];
      for (const f of faces) {
        if (!hasWall(floor, f.edge, parts)) continue;
        const p = facePose(f, 0);
        const dx = x - p.x;
        const dz = z - p.z;
        const along = dx * p.rx + dz * p.rz;
        const normalDist = dx * p.nx + dz * p.nz;
        // 벽 뒤쪽(다른 방)은 제외
        if (normalDist < -WALL_THICKNESS) continue;
        const clamped = Math.max(-CELL / 2, Math.min(CELL / 2, along));
        const ex = dx - p.rx * clamped;
        const ez = dz - p.rz * clamped;
        const dist = Math.hypot(ex, ez);
        if (dist <= maxDist && (!best || dist < best.dist)) best = { ...f, dist, along };
      }
    }
  }
  return best;
}

export function cellAt(x: number, z: number): [number, number] {
  return [Math.floor(x / CELL), Math.floor(z / CELL)];
}

/** 가장 가까운 모서리 (칸막이 벽 도구용) */
export function nearestEdge(floor: Floor, x: number, z: number): { key: EdgeKey; dist: number } | null {
  const gx = x / CELL;
  const gz = z / CELL;
  const candidates: { key: EdgeKey; dist: number }[] = [];
  const hj = Math.round(gz);
  const hi = Math.floor(gx);
  if (edgeExistsInGrid(floor, { dir: 'h', i: hi, j: hj })) candidates.push({ key: edgeKey('h', hi, hj), dist: Math.abs(gz - hj) * CELL });
  const vi = Math.round(gx);
  const vj = Math.floor(gz);
  if (edgeExistsInGrid(floor, { dir: 'v', i: vi, j: vj })) candidates.push({ key: edgeKey('v', vi, vj), dist: Math.abs(gx - vi) * CELL });
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0] ?? null;
}

export function filledCells(floor: Floor): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < floor.rows; j++) for (let i = 0; i < floor.cols; i++) if (floor.cells[j * floor.cols + i] === 1) out.push([i, j]);
  return out;
}

export function floorCentroid(floor: Floor): { x: number; z: number } {
  const cells = filledCells(floor);
  if (!cells.length) return { x: (floor.cols * CELL) / 2, z: (floor.rows * CELL) / 2 };
  let sx = 0;
  let sz = 0;
  for (const [i, j] of cells) {
    sx += (i + 0.5) * CELL;
    sz += (j + 0.5) * CELL;
  }
  return { x: sx / cells.length, z: sz / cells.length };
}

export function isPointOnFloor(floor: Floor, x: number, z: number): boolean {
  const [i, j] = cellAt(x, z);
  return isFilled(floor, i, j);
}

/** 저장된 시작 위치가 유효하면 그대로, 아니면 바닥 중심에 가장 가까운 칸 */
export function resolveSpawn(floor: Floor): Spawn {
  if (floor.spawn && isPointOnFloor(floor, floor.spawn.x, floor.spawn.z)) return floor.spawn;
  const c = floorCentroid(floor);
  const cells = filledCells(floor);
  if (!cells.length) return { x: c.x, z: c.z, yaw: 0 };
  let best = cells[0];
  let bestD = Infinity;
  for (const cell of cells) {
    const d = Math.hypot((cell[0] + 0.5) * CELL - c.x, (cell[1] + 0.5) * CELL - c.z);
    if (d < bestD) {
      bestD = d;
      best = cell;
    }
  }
  return { x: (best[0] + 0.5) * CELL, z: (best[1] + 0.5) * CELL, yaw: 0 };
}

export function invalidWallItemIds(floor: Floor): Set<string> {
  const parts = new Set(floor.partitions);
  const bad = new Set<string>();
  for (const it of floor.wallItems) if (!isFaceValid(floor, it, parts)) bad.add(it.id);
  return bad;
}

/** 모든 유효 벽면을 관람 동선(중심 기준 시계방향) 순서로 반환 */
export function orderedFaces(floor: Floor): WallFace[] {
  const edges = computeWallEdges(floor);
  const faces: (WallFace & { angle: number; r: number })[] = [];
  const c = floorCentroid(floor);
  for (const e of edges) {
    for (const side of [1, -1] as WallSide[]) {
      const f = { edge: e.key, side };
      const [ci, cj] = facingCell(f);
      if (!isFilled(floor, ci, cj)) continue;
      const p = facePose(f, 0);
      let angle = Math.atan2(p.x - c.x, -(p.z - c.z));
      if (angle < 0) angle += Math.PI * 2;
      faces.push({ ...f, angle, r: Math.hypot(p.x - c.x, p.z - c.z) });
    }
  }
  faces.sort((a, b) => a.angle - b.angle || b.r - a.r);
  return faces.map(({ edge, side }) => ({ edge, side }));
}

export const faceId = (f: WallFace) => `${f.edge}|${f.side}`;
