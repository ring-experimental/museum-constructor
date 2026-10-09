import { Copy, Download, Eye, FolderOpen, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { Modal } from '../components/Modal';
import { PlanThumb } from '../components/PlanThumb';
import { toast } from '../components/Toast';
import { formatDate, useExhibitionList } from '../components/useExhibitions';
import { createExhibitionFromTemplate, TEMPLATES } from '../core/factory';
import { href, navigate } from '../router';
import { exhibitionRepo } from '../storage/exhibitionRepo';
import { downloadBlob, exportExhibition, importExhibition } from '../storage/exportImport';

export function StudioListPage() {
  const list = useExhibitionList();
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const doc = await importExhibition(file);
      toast(`‘${doc.title}’ 전시를 가져왔어요`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <main className="page">
      <section className="studio-head">
        <div>
          <p className="eyebrow">편집 모드</p>
          <h1>내 전시 스튜디오</h1>
          <p className="hero__lead">템플릿으로 시작해 벽을 그리고, 사진을 걸어 전시관을 완성하세요. 작업 내용은 이 브라우저에 자동 저장됩니다.</p>
        </div>
        <div className="studio-head__actions">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> 전시 파일 가져오기
          </button>
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> 새 전시 만들기
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => (onImport(e.target.files?.[0]), (e.target.value = ''))} />
        </div>
      </section>

      {list === null ? (
        <p className="empty">불러오는 중…</p>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={40} strokeWidth={1.2} />
          <h2>아직 만든 전시가 없어요</h2>
          <p>템플릿을 골라 첫 전시관을 만들어 보세요.</p>
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> 새 전시 만들기
          </button>
        </div>
      ) : (
        <ul className="studio-list">
          {list.map((x) => (
            <li key={x.id} className="studio-row">
              <a className="studio-row__cover" href={href.editor(x.id)}>
                <ArtworkImage source={x.cover} fallback={<span className="studio-row__ph">{x.title.slice(0, 1)}</span>} />
              </a>
              <div className="studio-row__info">
                <a href={href.editor(x.id)} className="studio-row__title">
                  {x.title || '제목 없는 전시'}
                </a>
                <p>
                  <span className={`badge ${x.status === 'published' ? 'badge--live' : 'badge--draft'}`}>{x.status === 'published' ? '공개' : '초안'}</span>
                  {x.floorCount}개 층 · 작품 {x.artworkCount}점 · {formatDate(x.updatedAt)} 수정
                </p>
              </div>
              <div className="studio-row__actions">
                <a className="btn btn--primary btn--sm" href={href.editor(x.id)}>
                  <Pencil size={14} /> 편집
                </a>
                <a className="btn btn--sm" href={href.visit(x.id)}>
                  <Eye size={14} /> 관람
                </a>
                <button
                  className="icon-btn"
                  title="복제"
                  aria-label="복제"
                  onClick={async () => {
                    await exhibitionRepo.duplicate(x.id);
                    toast('전시를 복제했어요', 'success');
                  }}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-btn"
                  title="파일로 내보내기"
                  aria-label="파일로 내보내기"
                  onClick={async () => {
                    try {
                      const { blob, filename } = await exportExhibition(x.id);
                      downloadBlob(blob, filename);
                    } catch (e) {
                      toast((e as Error).message, 'error');
                    }
                  }}
                >
                  <Download size={16} />
                </button>
                <button
                  className="icon-btn icon-btn--danger"
                  title="삭제"
                  aria-label="삭제"
                  onClick={async () => {
                    if (!confirm(`‘${x.title}’ 전시를 삭제할까요? 업로드한 이미지도 함께 삭제되며 되돌릴 수 없습니다.`)) return;
                    await exhibitionRepo.remove(x.id);
                    toast('삭제했어요');
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </main>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const previews = useMemo(() => TEMPLATES.map((t) => ({ t, floors: t.build() })), []);
  const create = async () => {
    const doc = createExhibitionFromTemplate(template, title.trim() || '새 전시');
    await exhibitionRepo.save(doc);
    navigate(href.editor(doc.id));
  };
  return (
    <Modal title="새 전시 만들기" onClose={onClose} wide>
      <label className="field">
        <span>전시 제목</span>
        <input autoFocus value={title} placeholder="예) 여름의 기록" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
      </label>
      <p className="field-label">공간 템플릿</p>
      <div className="template-grid">
        {previews.map(({ t, floors }) => (
          <button key={t.id} className={`template-card ${template === t.id ? 'is-active' : ''}`} onClick={() => setTemplate(t.id)}>
            <div className="template-card__plans">
              {floors.map((f) => (
                <div key={f.id} className="template-card__plan">
                  <PlanThumb floor={f} />
                  {floors.length > 1 && <small>{f.name}</small>}
                </div>
              ))}
            </div>
            <strong>{t.name}</strong>
            <span>{t.description}</span>
          </button>
        ))}
      </div>
      <div className="modal__foot">
        <button className="btn btn--ghost" onClick={onClose}>
          취소
        </button>
        <button className="btn btn--primary" onClick={create}>
          만들고 편집 시작
        </button>
      </div>
    </Modal>
  );
}
