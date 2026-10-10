import { ChevronDown, ChevronUp, GripVertical, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { moveInSequence, tourSequence } from '../core/tour';
import type { Prop, WallItem } from '../core/types';
import { currentFloor, useEditor } from './store';

/** 층 설정 패널의 '감상 순서' 목록: 드래그 또는 ↑↓ 로 순서를 바꾼다 */
export function TourOrderSection() {
  const doc = useEditor((s) => s.doc)!;
  const floor = useEditor(currentFloor)!;
  const selection = useEditor((s) => s.selection);
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const seq = useMemo(() => tourSequence(floor), [floor]);
  const byId = useMemo(() => new Map<string, WallItem | Prop>([...floor.wallItems.map((w) => [w.id, w] as const), ...floor.props.map((p) => [p.id, p] as const)]), [floor]);
  const artMap = useMemo(() => new Map(doc.artworks.map((a) => [a.id, a])), [doc.artworks]);
  const custom = !!floor.tourOrder?.length;

  const move = (from: number, to: number) => {
    if (from === to) return;
    mutateFloor((f) => {
      f.tourOrder = moveInSequence(tourSequence(f), from, to);
    });
  };

  const artOf = (w: WallItem | Prop) => ('kind' in w ? (w.kind === 'frame' ? w.artworkId : null) : w.artworkId);
  const label = (w: WallItem | Prop) => {
    if (!('kind' in w)) return `${artMap.get(w.artworkId ?? '')?.title || '무제'} (입체)`;
    if (w.kind === 'frame') return artMap.get(w.artworkId ?? '')?.title || '무제';
    if (w.kind === 'text') return w.title.trim() || w.body.trim().split('\n')[0] || '벽 글';
    return '';
  };

  return (
    <div className="tour-order">
      <div className="tour-order__head">
        <h4>감상 순서</h4>
        {custom && (
          <button className="link-btn" onClick={() => mutateFloor((f) => void (f.tourOrder = []))} title="벽을 따라 도는 자동 순서로 되돌려요">
            <RotateCcw size={13} /> 자동 순서로
          </button>
        )}
      </div>
      <p className="muted small">{custom ? '직접 정한 순서예요. 새로 건 작품은 맨 뒤에 붙어요.' : '벽을 따라 도는 자동 순서예요. 끌어서 순서를 바꿀 수 있어요.'} ‘순서대로 감상’과 도면의 번호가 이 순서를 따라요.</p>
      {seq.length === 0 ? (
        <p className="muted small">아직 감상할 작품이나 벽 글이 없어요.</p>
      ) : (
        <ol className="tour-order__list">
          {seq.map((id, k) => {
            const w = byId.get(id);
            if (!w) return null;
            const artId = artOf(w);
            const art = artId ? artMap.get(artId) : undefined;
            const selected = (selection?.kind === 'wallItem' || selection?.kind === 'prop') && selection.id === id;
            return (
              <li
                key={id}
                className={`tour-order__row ${selected ? 'is-selected' : ''} ${dragOver === k && dragFrom !== null && dragFrom !== k ? (dragFrom < k ? 'is-drop-after' : 'is-drop-before') : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragFrom(k);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', id);
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  setDragOver(k);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, k);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onClick={() => useEditor.getState().select('kind' in w ? { kind: 'wallItem', id } : { kind: 'prop', id }, { keepTab: true })}
              >
                <GripVertical size={14} className="tour-order__grip" aria-hidden />
                <span className="tour-order__num">{k + 1}</span>
                <span className="tour-order__thumb">{art ? <ArtworkImage source={art.source} /> : <i>Aa</i>}</span>
                <span className="tour-order__label">{label(w)}</span>
                <span className="tour-order__btns">
                  <button
                    className="icon-btn"
                    disabled={k === 0}
                    aria-label="앞으로"
                    onClick={(e) => {
                      e.stopPropagation();
                      move(k, k - 1);
                    }}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={k === seq.length - 1}
                    aria-label="뒤로"
                    onClick={(e) => {
                      e.stopPropagation();
                      move(k, k + 1);
                    }}
                  >
                    <ChevronDown size={15} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
