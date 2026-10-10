import * as THREE from 'three';
import type { ArtworkMedia, ArtworkSource } from '../core/types';
import { loadArtworkImage, resolveArtworkUrl, sourceKey } from '../storage/artworkSource';
import { fitSize } from '../storage/imageRepo';

interface Entry {
  promise: Promise<THREE.Texture>;
  texture: THREE.Texture | null;
  refs: number;
  lastUsed: number;
}

/**
 * 작품 텍스처 해상도 단계.
 *  - thumb: 처음 보이는 작은 텍스처 (최대 512px, 업로드 사진은 저장된 썸네일 사용)
 *  - full : 가까이 갔을 때 바꿔 끼우는 고해상도 (데스크톱 2048px / 모바일 1280px).
 *           영상 작품은 이 단계에서 재생되는 VideoTexture (멀리 있으면 대표 이미지만)
 */
export type TexLevel = 'thumb' | 'full';

const entries = new Map<string, Entry>();
/** 쓰지 않게 된 텍스처를 캐시에 남겨 둘 개수 (고해상도는 GPU 메모리를 많이 써서 적게) */
const KEEP_UNUSED: Record<TexLevel, number> = { thumb: 64, full: 4 };
const THUMB_MAX = 512;
const keyOf = (source: ArtworkSource, level: TexLevel) => `${sourceKey(source)}|${level}`;

let maxAnisotropy = 8;
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = n;
}

/** 모바일은 GPU 메모리를 아끼기 위해 더 작은 텍스처 */
function textureMax() {
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return touch ? 1280 : 2048;
}

/** 영상 텍스처: 소리 없이 반복 재생, 아무도 안 쓰면 일시정지 */
async function createVideoTexture(source: ArtworkSource): Promise<THREE.Texture> {
  const url = await resolveArtworkUrl(source, 'full');
  if (!url) throw new Error('영상을 찾을 수 없습니다');
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('영상을 재생할 수 없습니다')), { once: true });
  });
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = video.videoWidth / Math.max(1, video.videoHeight);
  tex.userData.level = 'full';
  tex.userData.video = video;
  return tex;
}

function disposeTexture(tex: THREE.Texture | null) {
  if (!tex) return;
  const video = tex.userData.video as HTMLVideoElement | undefined;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  tex.dispose();
}

function setPlaying(tex: THREE.Texture | null, playing: boolean) {
  const video = tex?.userData.video as HTMLVideoElement | undefined;
  if (!video) return;
  if (playing) void video.play().catch(() => undefined);
  else video.pause();
}

/** 지금 재생 중인 영상 작품의 video 요소 (소리 켜기 등) */
export function getArtworkVideo(source: ArtworkSource): HTMLVideoElement | null {
  return (entries.get(keyOf(source, 'full'))?.texture?.userData.video as HTMLVideoElement | undefined) ?? null;
}

async function createTexture(source: ArtworkSource, level: TexLevel, media: ArtworkMedia): Promise<THREE.Texture> {
  if (media === 'video' && level === 'full') return createVideoTexture(source);
  const img = await loadArtworkImage(source, level);
  const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, level === 'thumb' ? THUMB_MAX : textureMax());
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
  tex.userData.level = level;
  tex.needsUpdate = true;
  return tex;
}

export function acquireArtworkTexture(source: ArtworkSource, level: TexLevel = 'full', media: ArtworkMedia = 'image'): Promise<THREE.Texture> {
  const key = keyOf(source, level);
  let e = entries.get(key);
  if (!e) {
    const entry: Entry = { promise: null as unknown as Promise<THREE.Texture>, texture: null, refs: 0, lastUsed: Date.now() };
    entry.promise = createTexture(source, level, media).then((t) => {
      entry.texture = t;
      setPlaying(t, entry.refs > 0);
      return t;
    });
    entry.promise.catch(() => entries.delete(key));
    entries.set(key, entry);
    e = entry;
  }
  e.refs++;
  e.lastUsed = Date.now();
  if (e.refs === 1) setPlaying(e.texture, true);
  return e.promise;
}

export function releaseArtworkTexture(source: ArtworkSource, level: TexLevel = 'full') {
  const e = entries.get(keyOf(source, level));
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  e.lastUsed = Date.now();
  if (e.refs === 0) setPlaying(e.texture, false);
  sweep(level);
}

function sweep(level: TexLevel) {
  const suffix = `|${level}`;
  const unused = [...entries.entries()].filter(([k, e]) => k.endsWith(suffix) && e.refs === 0 && e.texture);
  if (unused.length <= KEEP_UNUSED[level]) return;
  unused.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key, e] of unused.slice(0, unused.length - KEEP_UNUSED[level])) {
    disposeTexture(e.texture);
    entries.delete(key);
  }
}

/** 소스가 바뀐(예: URL 수정) 경우 강제로 버림 */
export function evictArtworkTexture(source: ArtworkSource) {
  for (const level of ['thumb', 'full'] as TexLevel[]) {
    const key = keyOf(source, level);
    const e = entries.get(key);
    if (e && e.refs === 0) {
      disposeTexture(e.texture);
      entries.delete(key);
    }
  }
}

/** 디버그/검증용: 현재 GPU 에 올라가 있는(로드 완료된) 텍스처 수 */
export function artworkTextureStats() {
  const out = { thumb: 0, full: 0, fullInUse: 0, videos: [] as { playing: boolean; muted: boolean }[] };
  for (const [k, e] of entries) {
    if (!e.texture) continue;
    const v = e.texture.userData.video as HTMLVideoElement | undefined;
    if (v) out.videos.push({ playing: !v.paused, muted: v.muted });
    if (k.endsWith('|thumb')) out.thumb++;
    else {
      out.full++;
      if (e.refs > 0) out.fullInUse++;
    }
  }
  return out;
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

// 개발 중 브라우저 콘솔에서 텍스처 상태를 확인할 수 있게 (빌드에서는 제거됨)
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__artworkTextureStats = artworkTextureStats;
