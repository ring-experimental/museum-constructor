import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Exhibition, ExhibitionSummary } from '../core/types';

export interface StoredImage {
  id: string;
  exhibitionId: string;
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  createdAt: number;
}

interface MuseumDB extends DBSchema {
  exhibitions: { key: string; value: Exhibition };
  summaries: { key: string; value: ExhibitionSummary };
  images: { key: string; value: StoredImage; indexes: { byExhibition: string } };
}

let dbPromise: Promise<IDBPDatabase<MuseumDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<MuseumDB>('museum-constructor', 1, {
      upgrade(db) {
        db.createObjectStore('exhibitions', { keyPath: 'id' });
        db.createObjectStore('summaries', { keyPath: 'id' });
        const images = db.createObjectStore('images', { keyPath: 'id' });
        images.createIndex('byExhibition', 'exhibitionId');
      },
    });
  }
  return dbPromise;
}
