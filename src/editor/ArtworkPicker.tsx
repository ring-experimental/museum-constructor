import { Link2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { Modal } from '../components/Modal';
import { addArtworkFromUrl, addArtworksFromFiles, usageMap } from './actions';
import { useEditor } from './store';

export function ArtworkPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const used = usageMap(doc);
  return (
    <Modal title="걸 작품 고르기" onClose={onClose} wide>
      <div className="row">
        <button className="btn btn--primary btn--sm" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> 새 사진 업로드
        </button>
        <button className="btn btn--sm" onClick={() => setUrlOpen(true)}>
          <Link2 size={15} /> URL로 추가
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            const added = await addArtworksFromFiles(files);
            e.target.value = '';
            if (added[0]) onPick(added[0].id);
          }}
        />
      </div>
      {doc.artworks.length === 0 ? (
        <p className="muted">보관함이 비어 있어요. 사진을 업로드하거나 URL로 추가하세요.</p>
      ) : (
        <div className="picker-grid">
          {doc.artworks.map((a) => (
            <button key={a.id} className="picker-item" onClick={() => onPick(a.id)}>
              <ArtworkImage source={a.source} />
              <span>{a.title || '무제'}</span>
              {used.get(a.id) ? <em>걸림 {used.get(a.id)}</em> : null}
            </button>
          ))}
        </div>
      )}
      {urlOpen && (
        <UrlDialog
          onClose={() => setUrlOpen(false)}
          onAdded={() => {
            setUrlOpen(false);
            const last = useEditor.getState().doc?.artworks.at(-1);
            if (last) onPick(last.id);
          }}
        />
      )}
    </Modal>
  );
}

export function UrlDialog({ onClose, onAdded }: { onClose: () => void; onAdded?: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await addArtworkFromUrl(url);
    setBusy(false);
    if (r.ok) (onAdded ?? onClose)();
    else setError(r.message ?? '추가하지 못했어요');
  };
  return (
    <Modal title="이미지 URL로 추가" onClose={onClose}>
      <label className="field">
        <span>이미지 주소</span>
        <input autoFocus value={url} placeholder="https://example.com/photo.jpg" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
      <p className="muted small">외부 이미지는 원본 서버가 CORS 를 허용해야 3D 전시관에 걸 수 있어요. 안 되면 사진을 내려받아 업로드해 주세요.</p>
      {error && <p className="notice notice--error">{error}</p>}
      <div className="modal__foot">
        <button className="btn btn--ghost" onClick={onClose}>
          취소
        </button>
        <button className="btn btn--primary" disabled={busy || !url.trim()} onClick={submit}>
          {busy ? '확인하는 중…' : '추가'}
        </button>
      </div>
    </Modal>
  );
}
