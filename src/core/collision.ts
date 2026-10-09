import { PROP_SPEC, WALL_THICKNESS } from './constants';
import { computeWallEdges, mergeWallRuns, type WallRun } from './grid';
import type { Floor } from './types';

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 선분 두께의 절반 */
  r: number;
}

export interface OBB {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  rot: number;
}

export interface Colliders {
  segments: Segment[];
  boxes: OBB[];
}

export function buildColliders(floor: Floor, runs?: WallRun[]): Colliders {
  const wallRuns = runs ?? mergeWallRuns(computeWallEdges(floor));
  const segments = wallRuns.map((w) => ({ ax: w.x1, az: w.z1, bx: w.x2, bz: w.z2, r: WALL_THICKNESS / 2 }));
  const boxes = floor.props.map((p) => {
    const spec = PROP_SPEC[p.type];
    return { cx: p.x, cz: p.z, hw: spec.w / 2, hd: spec.d / 2, rot: p.rotation };
  });
  return { segments, boxes };
}

function closestOnSegment(px: number, pz: number, s: Segment): [number, number] {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - s.ax) * dx + (pz - s.az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return [s.ax + dx * t, s.az + dz * t];
}

/** 원(플레이어)을 벽·소품 밖으로 밀어낸다. 결과 위치를 반환 */
export function resolveCircle(x: number, z: number, radius: number, col: Colliders): [number, number] {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of col.segments) {
      const [cx, cz] = closestOnSegment(px, pz, s);
      const dx = px - cx;
      const dz = pz - cz;
      const d = Math.hypot(dx, dz);
      const min = radius + s.r;
      if (d < min) {
        if (d > 1e-6) {
          px = cx + (dx / d) * min;
          pz = cz + (dz / d) * min;
        } else {
          // 정확히 벽 위: 선분 법선 방향으로
          const sx = s.bx - s.ax;
          const sz = s.bz - s.az;
          const l = Math.hypot(sx, sz) || 1;
          px = cx + (-sz / l) * min;
          pz = cz + (sx / l) * min;
        }
        moved = true;
      }
    }
    for (const b of col.boxes) {
      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      // 월드 → 박스 로컬 (rotation.y = rot 인 오브젝트 기준)
      const wx = px - b.cx;
      const wz = pz - b.cz;
      const lx = wx * cos - wz * sin;
      const lz = wx * sin + wz * cos;
      const qx = Math.max(-b.hw, Math.min(b.hw, lx));
      const qz = Math.max(-b.hd, Math.min(b.hd, lz));
      let dx = lx - qx;
      let dz = lz - qz;
      let d = Math.hypot(dx, dz);
      if (d >= radius) continue;
      let nlx: number;
      let nlz: number;
      if (d < 1e-6) {
        // 박스 내부: 가장 가까운 면으로 탈출
        const ex = b.hw - Math.abs(lx);
        const ez = b.hd - Math.abs(lz);
        if (ex < ez) {
          nlx = Math.sign(lx) || 1;
          nlz = 0;
          d = -ex;
        } else {
          nlx = 0;
          nlz = Math.sign(lz) || 1;
          d = -ez;
        }
        dx = nlx;
        dz = nlz;
      } else {
        nlx = dx / d;
        nlz = dz / d;
      }
      const push = radius - d;
      const nlxW = nlx * cos + nlz * sin;
      const nlzW = -nlx * sin + nlz * cos;
      px += nlxW * push;
      pz += nlzW * push;
      moved = true;
    }
    if (!moved) break;
  }
  return [px, pz];
}

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = dx - cx;
  const d2z = dz - cz;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
  const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** 두 점 사이에 벽이 가로막는지 (시야/이동 판정) */
export function isPathBlocked(ax: number, az: number, bx: number, bz: number, col: Colliders): boolean {
  for (const s of col.segments) if (segIntersect(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return true;
  return false;
}
