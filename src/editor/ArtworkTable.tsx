import { ChevronDown, ChevronUp, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import type { Artwork } from '../core/types';
import { removeArtwork, usageMap } from './actions';
import { useEditor } from './store';
import { useTxnField } from './useTxnField';

type Field = 'title' | 'artist' | 'year' | 'description';
const COLS: Field[] = ['title', 'artist', 'year', 'description'];
const LIMIT: Record<Field, number> = { title: 60, artist: 60, year: 20, description: 2000 };

/** 표의 한 칸. 고치는 동안은 실행취소 한 번으로 묶이고, Enter 로 아래 칸으로 이동 */
function Cell({ art, field, row, placeholder }: { art: Artwork; field: Field; row: number; placeholder?: string }) {
  const mutate = useEditor((s) => s.mutate);
  const txn = useTxnField();
  const col = COLS.indexOf(field);
  const onChange = (v: string) =>
    mutate((d) => {
      const a = d.artworks.find((x) => x.id === art.id);
      if (a) a[field] = v.slice(0, LIMIT[field]);
    });
  const focusCell = (r: number, c: number) => {
    const el = document.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`);
    el?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const multiline = field === 'description';
    if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      focusCell(row + (e.shiftKey ? -1 : 1), col);
    }
  };
  const common = { value: art[field], placeholder, 'data-cell': `${row}:${col}`, 'aria-label': placeholder, onKeyDown, ...txn };
  return field === 'description' ? (
    <textarea rows={2} {...common} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input {...common} onChange={(e) => onChange(e.target.value)} />
  );
}

/** 작품 정보 일괄 편집 (스프레드시트처럼 한 화면에서) */
export function ArtworkTable({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const mutate = useEditor((s) => s.mutate);
  const [query, setQuery] = useState('');
  const [bulk, setBulk] = useState({ artist: '', year: '' });
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const used = usageMap(doc);
  const q = query.trim().toLowerCase();
  const rows = doc.artworks.map((a, k) => ({ a, k })).filter(({ a }) => !q || `${a.title} ${a.artist} ${a.year} ${a.description}`.toLowerCase().includes(q));
  const emptyCount = (f: 'artist' | 'year') => doc.artworks.filter((a) => !a[f].trim()).length;

  const applyBulk = (field: 'artist' | 'year') => {
    const value = bulk[field].trim().slice(0, LIMIT[field]);
    let n = 0;
    mutate((d) => {
      for (const a of d.artworks) {
        if (onlyEmpty && a[field].trim()) continue;
        a[field] = value;
        n++;
      }
    });
    toast(n ? `작품 ${n}점의 ${field === 'artist' ? '작가' : '연도'}를 바꿨어요 (Ctrl+Z 로 되돌리기)` : '바꿀 작품이 없어요', n ? 'success' : 'info');
  };

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= doc.artworks.length) return;
    mutate((d) => {
      const [a] = d.artworks.splice(index, 1);
      d.artworks.splice(to, 0, a);
    });
  };

  return (
    <Modal title="작품 정보 일괄 편집" onClose={onClose} wide="xl">
      <div className="art-table__tools">
        <label className="art-table__search">
          <Search size={15} />
          <input value={query} placeholder="제목·작가·설명 검색" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="art-table__bulk">
          <span className="muted small">한꺼번에 입력</span>
          {(['artist', 'year'] as const).map((f) => (
            <div key={f} className="art-table__bulk-field">
              <input
                value={bulk[f]}
                placeholder={f === 'artist' ? '작가 이름' : '연도 (예: 2026)'}
                onChange={(e) => setBulk((b) => ({ ...b, [f]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && applyBulk(f)}
              />
              <button className="btn btn--sm" onClick={() => applyBulk(f)} disabled={!bulk[f].trim() && !onlyEmpty}>
                {f === 'artist' ? '작가' : '연도'} 적용
              </button>
            </div>
          ))}
          <label className="check">
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
            빈 칸에만 (작가 {emptyCount('artist')} · 연도 {emptyCount('year')})
          </label>
        </div>
      </div>
      <p className="muted small">Enter 로 아래 칸, Shift+Enter 로 위 칸으로 이동해요. 설명 칸은 Ctrl+Enter. 위아래 화살표는 보관함 순서(자동 배치·연속 걸기 순서)를 바꿔요.</p>
      {doc.artworks.length === 0 ? (
        <p className="muted">보관함이 비어 있어요.</p>
      ) : (
        <div className="art-table__wrap">
          <table className="art-table">
            <thead>
              <tr>
                <th className="art-table__num">#</th>
                <th className="art-table__thumb" aria-label="이미지" />
                <th>제목</th>
                <th>작가</th>
                <th className="art-table__year">연도</th>
                <th>설명</th>
                <th className="art-table__used">걸림</th>
                <th className="art-table__act" aria-label="순서·삭제" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, k }, row) => (
                <tr key={a.id}>
                  <td className="art-table__num">{k + 1}</td>
                  <td className="art-table__thumb">
                    <ArtworkImage source={a.source} />
                  </td>
                  <td>
                    <Cell art={a} field="title" row={row} placeholder="무제" />
                  </td>
                  <td>
                    <Cell art={a} field="artist" row={row} placeholder="작가" />
                  </td>
                  <td className="art-table__year">
                    <Cell art={a} field="year" row={row} placeholder="연도" />
                  </td>
                  <td>
                    <Cell art={a} field="description" row={row} placeholder="작품 설명" />
                  </td>
                  <td className="art-table__used">{used.get(a.id) ? `${used.get(a.id)}곳` : <span className="muted">—</span>}</td>
                  <td className="art-table__act">
                    <button className="icon-btn" disabled={!!q || k === 0} onClick={() => move(k, -1)} aria-label="앞으로" title="보관함에서 앞으로">
                      <ChevronUp size={15} />
                    </button>
                    <button className="icon-btn" disabled={!!q || k === doc.artworks.length - 1} onClick={() => move(k, 1)} aria-label="뒤로" title="보관함에서 뒤로">
                      <ChevronDown size={15} />
                    </button>
                    <button className="icon-btn icon-btn--danger" onClick={() => removeArtwork(a.id)} aria-label="보관함에서 삭제" title="보관함에서 삭제">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">‘{query}’와 맞는 작품이 없어요.</p>}
        </div>
      )}
      <div className="modal__foot">
        <button className="btn btn--primary" onClick={onClose}>
          완료
        </button>
      </div>
    </Modal>
  );
}
