import { useEffect, useState } from 'react';
import type { Artwork } from '../core/types';
import { resolveArtworkUrl, sourceKey } from '../storage/artworkSource';

/** 작품 id → 썸네일 URL */
export function useArtworkThumbs(artworks: Artwork[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = artworks.map((a) => `${a.id}=${sourceKey(a.source)}`).join('|');
  useEffect(() => {
    let alive = true;
    void Promise.all(
      artworks.map(async (a) => {
        try {
          return [a.id, await resolveArtworkUrl(a.source, 'thumb')] as const;
        } catch {
          return [a.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      const m: Record<string, string> = {};
      for (const [id, url] of entries) if (url) m[id] = url;
      setMap(m);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}
