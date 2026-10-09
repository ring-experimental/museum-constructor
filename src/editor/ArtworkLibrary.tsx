import { Link2, Upload, Wand2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { addArtworksFromFiles, autoHangUnplaced, removeArtwork, usageMap } from './actions';
import { UrlDialog } from './ArtworkPicker';
import { useEditor } from './store';

/** 하단 작품 보관함: 업로드 / URL / 자동 배치 / 드래그해서 걸기 */
export function ArtworkLibrary() {
  const doc = useEditor((s) => s.doc)!;
  const pending = useEditor((s) => s.pendingArtworkId);
  const selection = useEditor((s) => s.selection);
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const used = usageMap(doc);
  const unplaced = doc.artworks.filter((a) => !used.has(a.id)).length;

  return (
    <section className="library" aria-label="작품 보관함">
      <div className="library__head">
        <strong>작품 보관함</strong>
        <span className="muted small">
          {doc.artworks.length}점 · 미배치 {unplaced}점
        </span>
        <div className="library__actions">
          <button className="btn btn--primary btn--sm" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> 사진 업로드
          </button>
          <button className="btn btn--sm" onClick={() => setUrlOpen(true)}>
            <Link2 size={15} /> URL
          </button>
          <button className="btn btn--sm" disabled={!unplaced} onClick={autoHangUnplaced} title="아직 걸리지 않은 작품을 현재 층의 빈 벽에 순서대로 겁니다">
            <Wand2 size={15} /> 빈 벽에 자동 배치
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            if (e.target.files?.length) await addArtworksFromFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="library__list">
        {doc.artworks.length === 0 && (
          <button className="library__drop" onClick={() => fileRef.current?.click()}>
            사진을 여기로 끌어다 놓거나 클릭해서 업로드하세요 (여러 장 가능)
          </button>
        )}
        {doc.artworks.map((a) => {
          const n = used.get(a.id) ?? 0;
          const isPending = pending === a.id;
          const isSelected = selection?.kind === 'artwork' && selection.id === a.id;
          return (
            <div
              key={a.id}
              className={`lib-item ${isPending ? 'is-pending' : ''} ${isSelected ? 'is-selected' : ''} ${n ? 'is-used' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-artwork', a.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                const st = useEditor.getState();
                st.setPending(a.id);
                st.setTool('frame');
                st.select({ kind: 'artwork', id: a.id });
              }}
              title={`${a.title || '무제'} — 클릭: 이 작품부터 걸기 · 도면으로 드래그: 그 벽에 걸기`}
            >
              <ArtworkImage source={a.source} />
              <span className="lib-item__title">{a.title || '무제'}</span>
              {n > 0 && <em className="lib-item__badge">{n}</em>}
              <button
                className="lib-item__remove"
                aria-label="보관함에서 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  removeArtwork(a.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {urlOpen && <UrlDialog onClose={() => setUrlOpen(false)} />}
    </section>
  );
}
