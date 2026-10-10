import { useEffect, useState } from 'react';

export type Route =
  | { name: 'visitList' }
  | { name: 'visit'; id: string; floor?: number; from?: string; art?: string }
  | { name: 'studio' }
  | { name: 'editor'; id: string }
  | { name: 'notFound' };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const q = new URLSearchParams(qs ?? '');
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'visitList' };
  if (seg[0] === 'visit' && seg[1]) {
    const f = q.get('floor');
    return { name: 'visit', id: decodeURIComponent(seg[1]), floor: f ? Number(f) : undefined, from: q.get('from') ?? undefined, art: q.get('art') ?? undefined };
  }
  if (seg[0] === 'studio' && !seg[1]) return { name: 'studio' };
  if (seg[0] === 'studio' && seg[1]) return { name: 'editor', id: decodeURIComponent(seg[1]) };
  return { name: 'notFound' };
}

export const href = {
  visitList: () => '#/',
  visit: (id: string, opts: { floor?: number; from?: string; art?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.floor !== undefined) q.set('floor', String(opts.floor));
    if (opts.from) q.set('from', opts.from);
    if (opts.art) q.set('art', opts.art);
    const s = q.toString();
    return `#/visit/${encodeURIComponent(id)}${s ? `?${s}` : ''}`;
  },
  studio: () => '#/studio',
  editor: (id: string) => `#/studio/${encodeURIComponent(id)}`,
};

/** 작품(또는 전시) 공유용 절대 주소 */
export function absoluteHref(hash: string) {
  return `${location.origin}${location.pathname}${hash}`;
}

/** 기록을 남기지 않고 주소창만 바꾼다 (hashchange 없음) */
export function replaceHash(hash: string) {
  if (location.hash !== hash) history.replaceState(history.state, '', hash);
}

export function navigate(to: string) {
  if (location.hash !== to) location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
