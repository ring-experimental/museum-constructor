import { collectBlobIds, remapBlobIds } from '../core/blobs';
import { uid } from '../core/ids';
import { migrateExhibition, SchemaError } from '../core/schema';
import type { Exhibition, ExhibitionSummary } from '../core/types';
import { getDB } from './db';
import { imageRepo } from './imageRepo';

/**
 * 전시 저장소. 지금은 IndexedDB 구현이지만, 게시판 서버가 생기면
 * 같은 인터페이스의 REST 구현으로 교체하면 된다.
 */
export interface ExhibitionRepository {
  list(): Promise<ExhibitionSummary[]>;
  get(id: string): Promise<Exhibition | undefined>;
  save(doc: Exhibition): Promise<void>;
  remove(id: string): Promise<void>;
  duplicate(id: string): Promise<Exhibition | undefined>;
}

export function summarize(doc: Exhibition): ExhibitionSummary {
  const cover = doc.artworks.find((a) => a.id === doc.coverArtworkId) ?? doc.artworks[0];
  return {
    id: doc.id,
    title: doc.title,
    subtitle: doc.subtitle,
    curator: doc.curator,
    status: doc.status,
    floorCount: doc.floors.length,
    artworkCount: doc.floors.reduce((n, f) => n + f.wallItems.filter((w) => w.kind === 'frame' && w.artworkId).length, 0),
    cover: cover ? cover.source : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

class IndexedDBExhibitionRepository implements ExhibitionRepository {
  async list() {
    const db = await getDB();
    const all = await db.getAll('summaries');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string) {
    const db = await getDB();
    const raw = await db.get('exhibitions', id);
    if (!raw) return undefined;
    try {
      // 옛 버전 문서도 현재 구조로 읽는다 (저장은 편집할 때 자연스럽게 새 버전으로)
      return migrateExhibition(raw);
    } catch (e) {
      if (e instanceof SchemaError) console.error(`[exhibitionRepo] ${id}: ${e.message}`);
      else throw e;
      return undefined;
    }
  }

  async save(doc: Exhibition) {
    const db = await getDB();
    const tx = db.transaction(['exhibitions', 'summaries'], 'readwrite');
    await Promise.all([tx.objectStore('exhibitions').put(doc), tx.objectStore('summaries').put(summarize(doc)), tx.done]);
    notify();
  }

  async remove(id: string) {
    const db = await getDB();
    const tx = db.transaction(['exhibitions', 'summaries'], 'readwrite');
    await Promise.all([tx.objectStore('exhibitions').delete(id), tx.objectStore('summaries').delete(id), tx.done]);
    await imageRepo.removeByExhibition(id);
    notify();
  }

  async duplicate(id: string) {
    const src = await this.get(id);
    if (!src) return undefined;
    const copy: Exhibition = structuredClone(src);
    copy.id = uid('ex');
    copy.title = `${src.title} (사본)`;
    copy.status = 'draft';
    copy.createdAt = copy.updatedAt = Date.now();
    // 업로드 파일(이미지·영상·모델·오디오)도 새 전시 소속으로 복사
    const map = new Map<string, string>();
    for (const blobId of collectBlobIds(copy)) {
      const newId = await imageRepo.copy(blobId, copy.id);
      if (newId) map.set(blobId, newId);
    }
    remapBlobIds(copy, map);
    await this.save(copy);
    return copy;
  }
}

export const exhibitionRepo: ExhibitionRepository = new IndexedDBExhibitionRepository();

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
export function onExhibitionsChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
