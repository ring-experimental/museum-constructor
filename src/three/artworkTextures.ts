import * as THREE from 'three';
import type { ArtworkSource } from '../core/types';
import { loadArtworkImage, sourceKey } from '../storage/artworkSource';
import { fitSize } from '../storage/imageRepo';

interface Entry {
  promise: Promise<THREE.Texture>;
  texture: THREE.Texture | null;
  refs: number;
  lastUsed: number;
}

const entries = new Map<string, Entry>();
const KEEP_UNUSED = 24;

let maxAnisotropy = 8;
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = n;
}

/** 모바일은 GPU 메모리를 아끼기 위해 더 작은 텍스처 */
function textureMax() {
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return touch ? 1280 : 2048;
}

async function createTexture(source: ArtworkSource): Promise<THREE.Texture> {
  const img = await loadArtworkImage(source, 'full');
  const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, textureMax());
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.userData.aspect = img.naturalWidth / img.naturalHeight;
  tex.needsUpdate = true;
  return tex;
}

export function acquireArtworkTexture(source: ArtworkSource): Promise<THREE.Texture> {
  const key = sourceKey(source);
  let e = entries.get(key);
  if (!e) {
    const entry: Entry = { promise: null as unknown as Promise<THREE.Texture>, texture: null, refs: 0, lastUsed: Date.now() };
    entry.promise = createTexture(source).then((t) => {
      entry.texture = t;
      return t;
    });
    entry.promise.catch(() => entries.delete(key));
    entries.set(key, entry);
    e = entry;
  }
  e.refs++;
  e.lastUsed = Date.now();
  return e.promise;
}

export function releaseArtworkTexture(source: ArtworkSource) {
  const e = entries.get(sourceKey(source));
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  e.lastUsed = Date.now();
  sweep();
}

function sweep() {
  const unused = [...entries.entries()].filter(([, e]) => e.refs === 0 && e.texture);
  if (unused.length <= KEEP_UNUSED) return;
  unused.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key, e] of unused.slice(0, unused.length - KEEP_UNUSED)) {
    e.texture?.dispose();
    entries.delete(key);
  }
}

/** 소스가 바뀐(예: URL 수정) 경우 강제로 버림 */
export function evictArtworkTexture(source: ArtworkSource) {
  const key = sourceKey(source);
  const e = entries.get(key);
  if (e && e.refs === 0) {
    e.texture?.dispose();
    entries.delete(key);
  }
}

/**
 * 액자 비율과 이미지 비율이 다르면 object-fit: cover 처럼 가운데를 잘라 쓴다.
 * 텍스처는 공유되므로 clone 해서 repeat/offset 을 따로 갖게 한다.
 */
export function fitTextureToAspect(tex: THREE.Texture, frameAspect: number): THREE.Texture {
  const imgAspect = (tex.userData.aspect as number) || frameAspect;
  if (Math.abs(imgAspect - frameAspect) / frameAspect < 0.01) return tex;
  const t = tex.clone();
  t.userData = { ...tex.userData, isClone: true };
  if (imgAspect > frameAspect) {
    const r = frameAspect / imgAspect;
    t.repeat.set(r, 1);
    t.offset.set((1 - r) / 2, 0);
  } else {
    const r = imgAspect / frameAspect;
    t.repeat.set(1, r);
    t.offset.set(0, (1 - r) / 2);
  }
  t.needsUpdate = true;
  return t;
}
