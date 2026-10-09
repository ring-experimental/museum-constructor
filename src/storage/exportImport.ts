import { uid } from '../core/ids';
import { SCHEMA_VERSION, type Exhibition } from '../core/types';
import { exhibitionRepo } from './exhibitionRepo';
import { imageRepo } from './imageRepo';

const FORMAT = 'museum-constructor/exhibition';

interface ExportFile {
  format: typeof FORMAT;
  version: number;
  exhibition: Exhibition;
  images: Record<string, { full: string; thumb: string; width: number; height: number }>;
}

function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function dataURLToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

/** 업로드 이미지까지 포함한 단일 JSON 파일로 내보내기 (서버 없이 백업/공유용) */
export async function exportExhibition(id: string): Promise<{ blob: Blob; filename: string }> {
  const doc = await exhibitionRepo.get(id);
  if (!doc) throw new Error('전시를 찾을 수 없습니다');
  const images: ExportFile['images'] = {};
  for (const art of doc.artworks) {
    if (art.source.kind !== 'upload') continue;
    const rec = await imageRepo.get(art.source.blobId);
    if (!rec) continue;
    images[rec.id] = { full: await blobToDataURL(rec.blob), thumb: await blobToDataURL(rec.thumb), width: rec.width, height: rec.height };
  }
  const file: ExportFile = { format: FORMAT, version: SCHEMA_VERSION, exhibition: doc, images };
  const safe = doc.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'exhibition';
  return { blob: new Blob([JSON.stringify(file)], { type: 'application/json' }), filename: `${safe}.museum.json` };
}

export async function importExhibition(file: File): Promise<Exhibition> {
  let parsed: ExportFile;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('파일을 읽을 수 없습니다 (JSON 형식이 아님)');
  }
  if (parsed?.format !== FORMAT || !parsed.exhibition) throw new Error('Museum Constructor 전시 파일이 아닙니다');
  const doc = parsed.exhibition;
  doc.id = uid('ex');
  doc.updatedAt = Date.now();
  for (const art of doc.artworks) {
    if (art.source.kind !== 'upload') continue;
    const img = parsed.images[art.source.blobId];
    if (!img) continue;
    const newId = await imageRepo.putRaw(doc.id, await dataURLToBlob(img.full), await dataURLToBlob(img.thumb), img.width, img.height);
    art.source = { kind: 'upload', blobId: newId };
  }
  await exhibitionRepo.save(doc);
  return doc;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
