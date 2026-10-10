import { Link2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { Modal } from '../components/Modal';
import type { ArtworkMedia } from '../core/types';
import { acceptFor, addArtworkFromUrl, addArtworksFromFiles, usageMap } from './actions';
import { useEditor } from './store';

export function ArtworkPicker({ onPick, onClose, media = ['image', 'video', 'model'] }: { onPick: (id: string) => void; onClose: () => void; media?: ArtworkMedia[] }) {
  const doc = useEditor((s) => s.doc)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const used = usageMap(doc);
  const onlyModels = media.length === 1 && media[0] === 'model';
  const list = doc.artworks.filter((a) => media.includes(a.media));
  return (
    <Modal title={onlyModels ? '좌대에 올릴 입체 작품 고르기' : '걸 작품 고르기'} onClose={onClose} wide>
      <div className="row">
        <button className="btn btn--primary btn--sm" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {onlyModels ? '3D 모델(.glb) 업로드' : '새 작품 업로드'}
        </button>
        {media.includes('image') && (
          <button className="btn btn--sm" onClick={() => setUrlOpen(true)}>
            <Link2 size={15} /> URL로 추가
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={acceptFor(media)}
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            const added = (await addArtworksFromFiles(files)).filter((a) => media.includes(a.media));
            e.target.value = '';
            if (added[0]) onPick(added[0].id);
          }}
        />
      </div>
      {list.length === 0 ? (
        <p className="muted">{onlyModels ? '보관함에 입체 작품이 없어요. GLB 3D 모델 파일을 업로드하세요.' : '보관함이 비어 있어요. 사진을 업로드하거나 URL로 추가하세요.'}</p>
      ) : (
        <div className="picker-grid">
          {list.map((a) => (
            <button key={a.id} className="picker-item" onClick={() => onPick(a.id)}>
              <ArtworkImage source={a.source} />
              <span>{a.title || '무제'}</span>
              {used.get(a.id) ? <em>{a.media === 'model' ? '올림' : '걸림'} {used.get(a.id)}</em> : null}
              {a.media !== 'image' && <b className="media-badge">{a.media === 'model' ? '3D' : '영상'}</b>}
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
