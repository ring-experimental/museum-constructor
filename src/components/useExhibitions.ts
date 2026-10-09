import { useEffect, useState } from 'react';
import type { ExhibitionSummary } from '../core/types';
import { exhibitionRepo, onExhibitionsChanged } from '../storage/exhibitionRepo';

export function useExhibitionList() {
  const [list, setList] = useState<ExhibitionSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      exhibitionRepo
        .list()
        .then((l) => alive && setList(l))
        .catch(() => alive && setList([]));
    void load();
    const off = onExhibitionsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}

export function formatDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
