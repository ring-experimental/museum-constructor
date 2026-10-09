import { uid } from '../core/ids';
import { getDB, type StoredImage } from './db';

/** 업로드 원본은 이 크기로 줄여 저장한다 (라이트박스 감상용) */
const FULL_MAX = 2560;
const THUMB_MAX = 400;

export interface UploadResult {
  blobId: string;
  width: number;
  height: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 인코딩 실패'))), type, quality),
  );
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  return src instanceof HTMLImageElement ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

export function fitSize(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function resizeToBlob(src: CanvasImageSource, w: number, h: number, max: number, quality: number) {
  const size = fitSize(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size.w, size.h);
  return { blob: await canvasToBlob(canvas, 'image/jpeg', quality), ...size };
}

const urlCache = new Map<string, string>();

class ImageRepository {
  /** 파일을 줄여서(최대 2560px) 저장하고 썸네일을 만든다 */
  async put(exhibitionId: string, file: Blob): Promise<UploadResult> {
    if (!file.type.startsWith('image/')) throw new Error('이미지 파일이 아닙니다');
    const src = await decode(file);
    const { w, h } = sizeOf(src);
    const full = await resizeToBlob(src, w, h, FULL_MAX, 0.92);
    const thumb = await resizeToBlob(src, w, h, THUMB_MAX, 0.82);
    if ('close' in src) src.close();
    const rec: StoredImage = {
      id: uid('img'),
      exhibitionId,
      blob: full.blob,
      thumb: thumb.blob,
      width: full.w,
      height: full.h,
      createdAt: Date.now(),
    };
    const db = await getDB();
    await db.put('images', rec);
    void navigator.storage?.persist?.();
    return { blobId: rec.id, width: rec.width, height: rec.height };
  }

  async get(blobId: string) {
    const db = await getDB();
    return db.get('images', blobId);
  }

  async getURL(blobId: string, variant: 'full' | 'thumb' = 'full'): Promise<string | null> {
    const key = `${blobId}:${variant}`;
    const cached = urlCache.get(key);
    if (cached) return cached;
    const rec = await this.get(blobId);
    if (!rec) return null;
    const url = URL.createObjectURL(variant === 'full' ? rec.blob : rec.thumb);
    urlCache.set(key, url);
    return url;
  }

  async copy(blobId: string, toExhibitionId: string): Promise<string | null> {
    const rec = await this.get(blobId);
    if (!rec) return null;
    const db = await getDB();
    const id = uid('img');
    await db.put('images', { ...rec, id, exhibitionId: toExhibitionId, createdAt: Date.now() });
    return id;
  }

  async remove(blobId: string) {
    const db = await getDB();
    await db.delete('images', blobId);
    for (const v of ['full', 'thumb']) {
      const key = `${blobId}:${v}`;
      const url = urlCache.get(key);
      if (url) URL.revokeObjectURL(url);
      urlCache.delete(key);
    }
  }

  async removeByExhibition(exhibitionId: string) {
    const db = await getDB();
    const keys = await db.getAllKeysFromIndex('images', 'byExhibition', exhibitionId);
    for (const k of keys) await this.remove(k);
  }

  async listByExhibition(exhibitionId: string) {
    const db = await getDB();
    return db.getAllFromIndex('images', 'byExhibition', exhibitionId);
  }

  /** 가져오기(import)용: 이미 인코딩된 Blob 을 그대로 저장 */
  async putRaw(exhibitionId: string, blob: Blob, thumb: Blob, width: number, height: number, id = uid('img')) {
    const db = await getDB();
    await db.put('images', { id, exhibitionId, blob, thumb, width, height, createdAt: Date.now() });
    return id;
  }
}

export const imageRepo = new ImageRepository();

export type UrlProbe = { ok: true; width: number; height: number } | { ok: false; reason: 'cors' | 'invalid' };

function loadImg(url: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = url;
  });
}

/** 외부 URL 이미지가 3D 텍스처로 쓸 수 있는지(CORS 허용) 확인 */
export async function probeImageUrl(url: string): Promise<UrlProbe> {
  try {
    const img = await loadImg(url, true);
    return { ok: true, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    try {
      await loadImg(url, false);
      return { ok: false, reason: 'cors' };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
}

export { loadImg };
