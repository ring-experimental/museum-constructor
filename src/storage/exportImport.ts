import { collectBlobIds, remapBlobIds } from '../core/blobs';
import { uid } from '../core/ids';
import { migrateExhibition } from '../core/schema';
import { SCHEMA_VERSION, type Exhibition } from '../core/types';
import { exhibitionRepo } from './exhibitionRepo';
import { imageRepo } from './imageRepo';

const FORMAT = 'museum-constructor/exhibition';

interface ExportFile {
  format: typeof FORMAT;
  version: number;
  exhibition: Exhibition;
  /** 업로드 파일 (이미지·영상·3D 모델·오디오). 이름은 옛 버전과의 호환을 위해 images 그대로 */
  images: Record<string, { full: string; thumb: string; width: number; height: number }>;
}

function blobToDataURL(b: Blob): Promise<string> {
  // 미리보기가 없는 파일(오디오)은 빈 문자열로
  if (!b.size) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** 파일 안의 데이터는 data: URL 로만 받는다 (외부 주소로 요청을 보내지 않게) */
const DATA_URL = /^data:[a-z]+\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,/i;

async function dataURLToBlob(url: string): Promise<Blob> {
  if (url === '') return new Blob([]);
  if (!DATA_URL.test(url)) throw new Error('전시 파일의 첨부 데이터가 올바르지 않아요');
  return (await fetch(url)).blob();
}

/** 업로드 파일까지 포함한 단일 JSON 파일로 내보내기 (서버 없이 백업/공유용) */
export async function exportExhibition(id: string): Promise<{ blob: Blob; filename: string }> {
  const doc = await exhibitionRepo.get(id);
  if (!doc) throw new Error('전시를 찾을 수 없습니다');
  const images: ExportFile['images'] = {};
  for (const blobId of collectBlobIds(doc)) {
    const rec = await imageRepo.get(blobId);
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
  // 버전 변환 + 값 검증 (새 버전 파일이면 SchemaError 메시지가 그대로 안내된다)
  const doc = migrateExhibition(parsed.exhibition);
  doc.id = uid('ex');
  doc.updatedAt = Date.now();
  const images = parsed.images && typeof parsed.images === 'object' ? parsed.images : {};
  const pick = (blobId: string) => {
    const img = Object.hasOwn(images, blobId) ? images[blobId] : undefined;
    return img && typeof img.full === 'string' && typeof img.thumb === 'string' ? img : undefined;
  };
  const refs = collectBlobIds(doc);
  // 저장하기 전에 모든 첨부 데이터를 먼저 검사한다 (중간에 실패해 찌꺼기가 남지 않게)
  for (const blobId of refs) {
    const img = pick(blobId);
    if (img && (!DATA_URL.test(img.full) || (img.thumb !== '' && !DATA_URL.test(img.thumb)))) throw new Error('전시 파일의 첨부 데이터가 올바르지 않아요');
  }
  try {
    const map = new Map<string, string>();
    for (const blobId of refs) {
      const img = pick(blobId);
      if (!img) continue;
      map.set(blobId, await imageRepo.putRaw(doc.id, await dataURLToBlob(img.full), await dataURLToBlob(img.thumb), Number(img.width) || 0, Number(img.height) || 0));
    }
    remapBlobIds(doc, map);
    await exhibitionRepo.save(doc);
  } catch (e) {
    await imageRepo.removeByExhibition(doc.id);
    throw e;
  }
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
