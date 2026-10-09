import { useEffect, useState } from 'react';

export type Route =
  | { name: 'visitList' }
  | { name: 'visit'; id: string; floor?: number; from?: string }
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
    return { name: 'visit', id: decodeURIComponent(seg[1]), floor: f ? Number(f) : undefined, from: q.get('from') ?? undefined };
  }
  if (seg[0] === 'studio' && !seg[1]) return { name: 'studio' };
  if (seg[0] === 'studio' && seg[1]) return { name: 'editor', id: decodeURIComponent(seg[1]) };
  return { name: 'notFound' };
}

export const href = {
  visitList: () => '#/',
  visit: (id: string, opts: { floor?: number; from?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.floor !== undefined) q.set('floor', String(opts.floor));
    if (opts.from) q.set('from', opts.from);
    const s = q.toString();
    return `#/visit/${encodeURIComponent(id)}${s ? `?${s}` : ''}`;
  },
  studio: () => '#/studio',
  editor: (id: string) => `#/studio/${encodeURIComponent(id)}`,
};

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
