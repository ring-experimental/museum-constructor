import { Link2, Table2, Upload, Wand2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { acceptFor, addArtworksFromFiles, autoHangUnplaced, isWallMedia, removeArtwork, usageMap } from './actions';
import { UrlDialog } from './ArtworkPicker';
import { ArtworkTable } from './ArtworkTable';
import { useEditor } from './store';

/** 하단 작품 보관함: 업로드 / URL / 자동 배치 / 드래그해서 걸기 */
export function ArtworkLibrary() {
  const doc = useEditor((s) => s.doc)!;
  const pending = useEditor((s) => s.pendingArtworkId);
  const selection = useEditor((s) => s.selection);
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const used = usageMap(doc);
  const unplaced = doc.artworks.filter((a) => !used.has(a.id)).length;
  const unplacedWall = doc.artworks.filter((a) => !used.has(a.id) && isWallMedia(a.media)).length;

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
          <button className="btn btn--sm" disabled={!doc.artworks.length} onClick={() => setTableOpen(true)} title="제목·작가·연도·설명을 표에서 한꺼번에 입력해요">
            <Table2 size={15} /> 정보 일괄 편집
          </button>
          <button className="btn btn--sm" disabled={!unplacedWall} onClick={autoHangUnplaced} title="아직 걸리지 않은 작품을 현재 층의 빈 벽에 순서대로 겁니다">
            <Wand2 size={15} /> 빈 벽에 자동 배치
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={acceptFor(['image', 'video', 'model'])}
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
            사진·영상·GLB 3D 모델을 여기로 끌어다 놓거나 클릭해서 업로드하세요 (여러 개 가능)
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
                // 입체 작품은 조각 좌대를 놓는 소품 도구로
                if (a.media === 'model') st.setPropType('pedestal');
                else st.setTool('frame');
                st.select({ kind: 'artwork', id: a.id });
              }}
              title={
                a.media === 'model'
                  ? `${a.title || '무제'} (3D) — 클릭: 바닥을 눌러 좌대와 함께 놓기 · 도면으로 드래그: 그 자리(또는 좌대)에 올리기`
                  : `${a.title || '무제'} — 클릭: 이 작품부터 걸기 · 도면으로 드래그: 그 벽에 걸기`
              }
            >
              <ArtworkImage source={a.source} />
              <span className="lib-item__title">{a.title || '무제'}</span>
              {a.media !== 'image' && <b className="media-badge">{a.media === 'model' ? '3D' : '영상'}</b>}
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
      {tableOpen && <ArtworkTable onClose={() => setTableOpen(false)} />}
    </section>
  );
}
