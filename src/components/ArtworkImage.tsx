import { useEffect, useState } from 'react';
import type { ArtworkSource } from '../core/types';
import { resolveArtworkUrl } from '../storage/artworkSource';

/** 업로드/URL/샘플 이미지를 비동기로 해석해서 표시 */
export function ArtworkImage({
  source,
  variant = 'thumb',
  alt = '',
  className,
  fallback,
}: {
  source: ArtworkSource | null | undefined;
  variant?: 'thumb' | 'full';
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const key = source ? JSON.stringify(source) : '';
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError(false);
    if (!source) return;
    resolveArtworkUrl(source, variant)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, variant]);
  if (!source || error || !url) return <>{fallback ?? <span className={`img-fallback ${className ?? ''}`} />}</>;
  return <img className={className} src={url} alt={alt} draggable={false} loading="lazy" onError={() => setError(true)} referrerPolicy="no-referrer" />;
}
