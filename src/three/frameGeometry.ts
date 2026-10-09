import * as THREE from 'three';
import { FRAME_STYLE_SPEC } from '../core/constants';
import type { FrameStyle } from '../core/types';

export interface FrameDims {
  imageW: number;
  imageH: number;
  mat: number;
  border: number;
  depth: number;
  /** 매트/이미지가 놓이는 깊이 (벽에서부터) */
  matZ: number;
  outerW: number;
  outerH: number;
}

export function frameDims(style: FrameStyle, imageW: number, imageH: number, mat: number): FrameDims {
  const spec = FRAME_STYLE_SPEC[style];
  const border = spec.border;
  const depth = spec.depth;
  const effMat = style === 'none' ? 0 : mat;
  return {
    imageW,
    imageH,
    mat: effMat,
    border,
    depth,
    matZ: style === 'none' ? depth : depth * 0.45,
    outerW: imageW + 2 * effMat + 2 * border,
    outerH: imageH + 2 * effMat + 2 * border,
  };
}

/**
 * 액자 몰딩 단면(profile)을 사각형 둘레로 스윕한 지오메트리.
 * 단면 점은 (u = 바깥 모서리에서 안쪽으로의 거리, v = 벽에서의 높이).
 * 모서리는 45° 마이터로 자동 처리된다. 로컬 원점은 액자 중심, 벽면 z=0, 정면 +Z.
 */
export function moldingGeometry(d: FrameDims): THREE.BufferGeometry {
  const B = d.border;
  const D = d.depth;
  const profile: [number, number][] = [
    [0, 0],
    [0, D * 0.92],
    [B * 0.12, D],
    [B * 0.78, D],
    [B, D * 0.8],
    [B, d.matZ],
  ];
  const hw = d.outerW / 2;
  const hh = d.outerH / 2;
  // 정면에서 볼 때 시계방향: 위 → 오른쪽 → 아래 → 왼쪽
  const sides: { A: [number, number]; Bp: [number, number]; n: [number, number]; dir: [number, number] }[] = [
    { A: [-hw, hh], Bp: [hw, hh], n: [0, -1], dir: [1, 0] },
    { A: [hw, hh], Bp: [hw, -hh], n: [-1, 0], dir: [0, -1] },
    { A: [hw, -hh], Bp: [-hw, -hh], n: [0, 1], dir: [-1, 0] },
    { A: [-hw, -hh], Bp: [-hw, hh], n: [1, 0], dir: [0, 1] },
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const s of sides) {
    const len = Math.hypot(s.Bp[0] - s.A[0], s.Bp[1] - s.A[1]);
    const pt = (u: number, v: number, end: boolean): [number, number, number] => {
      const base = end ? s.Bp : s.A;
      const sign = end ? -1 : 1;
      return [base[0] + u * (s.n[0] + sign * s.dir[0]), base[1] + u * (s.n[1] + sign * s.dir[1]), v];
    };
    let acc = 0;
    for (let k = 0; k < profile.length - 1; k++) {
      const [u0, v0] = profile[k];
      const [u1, v1] = profile[k + 1];
      const segLen = Math.hypot(u1 - u0, v1 - v0);
      const s0 = pt(u0, v0, false);
      const s1 = pt(u1, v1, false);
      const e0 = pt(u0, v0, true);
      const e1 = pt(u1, v1, true);
      const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
      tri(s0, s1, e1);
      tri(s0, e1, e0);
      // 결 방향(몰딩 길이)으로 u, 단면 방향으로 v. 1 UV = 1m (TEXTURE_TILE.frame_oak)
      const a0 = acc;
      const a1 = acc + segLen;
      const L = len;
      uv.push(0, a0, 0, a1, L, a1, 0, a0, L, a1, L, a0);
      acc += segLen;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** 액자 없는 스타일: 두께 있는 패널(캔버스 프린트)의 측면 */
export function panelGeometry(d: FrameDims): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(d.imageW, d.imageH, d.depth);
  g.translate(0, 0, d.depth / 2);
  return g;
}

/** 매트 보드 (이미지 뒤의 흰 여백 판) */
export function matGeometry(d: FrameDims): THREE.BufferGeometry {
  const w = d.imageW + 2 * d.mat;
  const h = d.imageH + 2 * d.mat;
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, 0, d.matZ);
  return g;
}

export function imageGeometry(d: FrameDims): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(d.imageW, d.imageH);
  g.translate(0, 0, d.matZ + 0.0015);
  return g;
}
