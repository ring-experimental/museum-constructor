import { useEffect, useState } from 'react';
import type { ArtworkSource } from '../core/types';
import { resolveArtworkUrl } from '../storage/artworkSource';

/** 영상 작품을 크게 재생 (컨트롤 표시, 소리 켜짐) */
export function ArtworkVideo({ source, className }: { source: ArtworkSource; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    void resolveArtworkUrl(source, 'full').then((u) => alive && setUrl(u));
    void resolveArtworkUrl(source, 'thumb').then((u) => alive && setPoster(u ?? undefined));
    return () => {
      alive = false;
    };
  }, [source]);
  if (!url) return <span className={`img-fallback ${className ?? ''}`} />;
  return <video className={className} src={url} poster={poster} controls autoPlay loop playsInline />;
}
