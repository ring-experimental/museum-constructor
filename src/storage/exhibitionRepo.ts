import { uid } from '../core/ids';
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
    return db.get('exhibitions', id);
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
    for (const art of copy.artworks) {
      if (art.source.kind === 'upload') {
        const newId = await imageRepo.copy(art.source.blobId, copy.id);
        if (newId) art.source = { kind: 'upload', blobId: newId };
      }
    }
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
