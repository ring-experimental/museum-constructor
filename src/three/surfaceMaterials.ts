import * as THREE from 'three';
import { FLOOR_STYLE_SPEC } from '../core/constants';
import type { FloorStyle } from '../core/types';
import { publicUrl } from '../publicUrl';

/**
 * 외부 제작 PBR 텍스처 슬롯.
 * public/assets/textures/<set>/basecolor.jpg, normal.jpg, roughness.jpg 를 넣으면 자동 적용되고,
 * 파일이 없으면 단색 재질로 동작한다. (세부 규격은 docs/EXTERNAL_ASSETS.md)
 */
export type TextureSet = 'floor_oak' | 'floor_concrete' | 'floor_marble' | 'floor_dark' | 'wall_plaster' | 'frame_oak';

/** 텍스처 한 장이 덮는 실제 크기 (m) */
export const TEXTURE_TILE: Record<TextureSet, number> = {
  floor_oak: 2,
  floor_concrete: 3,
  floor_marble: 2,
  floor_dark: 2,
  wall_plaster: 3,
  frame_oak: 1,
};

type MapKind = 'basecolor' | 'normal' | 'roughness';
const texCache = new Map<string, Promise<THREE.Texture | null>>();
const loader = new THREE.TextureLoader();

function loadOptional(set: TextureSet, kind: MapKind): Promise<THREE.Texture | null> {
  const url = publicUrl(`assets/textures/${set}/${kind}.jpg`);
  let p = texCache.get(url);
  if (!p) {
    p = loader
      .loadAsync(url)
      .then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (kind === 'basecolor') t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })
      .catch(() => null);
    texCache.set(url, p);
  }
  return p;
}

/** 재질에 외부 텍스처가 있으면 비동기로 붙인다 */
export function applyTextureSet(mat: THREE.MeshStandardMaterial, set: TextureSet, tintToWhite = true) {
  void Promise.all([loadOptional(set, 'basecolor'), loadOptional(set, 'normal'), loadOptional(set, 'roughness')]).then(([base, normal, rough]) => {
    if (!base && !normal && !rough) return;
    if (base) {
      mat.map = base;
      if (tintToWhite) mat.color.set('#ffffff');
    }
    if (normal) mat.normalMap = normal;
    if (rough) {
      mat.roughnessMap = rough;
      mat.roughness = 1;
    }
    mat.needsUpdate = true;
  });
}

export function floorSetFor(style: FloorStyle): TextureSet {
  return `floor_${style}` as TextureSet;
}

export function createFloorMaterial(style: FloorStyle) {
  const spec = FLOOR_STYLE_SPEC[style];
  const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: 0 });
  applyTextureSet(mat, floorSetFor(style));
  return mat;
}

export function createWallMaterial(color: string) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  // 벽 텍스처는 회색조 플라스터 디테일만 쓰고 색은 테마 색을 유지 (곱연산)
  applyTextureSet(mat, 'wall_plaster', false);
  return mat;
}
