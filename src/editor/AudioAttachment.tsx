import { Music, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../components/Toast';
import { imageRepo } from '../storage/imageRepo';
import { useEditor } from './store';

/** 오디오 파일을 확인하고 전시 소속 파일로 저장한다 */
async function storeAudio(exhibitionId: string, file: File, maxMB: number): Promise<string> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(file.name)) throw new Error('오디오 파일(MP3, M4A, WAV, OGG)만 올릴 수 있어요');
  if (file.size > maxMB * 1024 * 1024) throw new Error(`오디오는 ${maxMB}MB 이하만 올릴 수 있어요`);
  const url = URL.createObjectURL(file);
  try {
    // 이 브라우저에서 재생 가능한지 확인
    await new Promise<void>((resolve, reject) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', () => resolve(), { once: true });
      a.addEventListener('error', () => reject(new Error('이 브라우저에서 재생할 수 없는 오디오 형식이에요')), { once: true });
      a.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  // 오디오는 미리보기 이미지가 없으므로 빈 썸네일
  return imageRepo.putRaw(exhibitionId, file, new Blob([]), 0, 0);
}

/** 오디오 첨부 한 칸: 미리 듣기 · 올리기/바꾸기 · 지우기 */
export function AudioAttachment({ blobId, onChange, label, hint, maxMB = 20 }: { blobId: string | null; onChange: (id: string | null) => void; label: string; hint?: string; maxMB?: number }) {
  const exhibitionId = useEditor((s) => s.doc?.id)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (blobId) void imageRepo.getURL(blobId, 'full').then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [blobId]);

  return (
    <div className="field audio-field">
      <span>
        <Music size={13} /> {label}
      </span>
      {blobId && (url ? <audio controls src={url} preload="none" /> : <small className="muted">불러오는 중…</small>)}
      <div className="row">
        <button className="btn btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> {busy ? '확인하는 중…' : blobId ? '파일 바꾸기' : '오디오 파일 올리기'}
        </button>
        {blobId && (
          <button className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
            <Trash2 size={14} /> 지우기
          </button>
        )}
      </div>
      {hint && <small className="muted">{hint}</small>}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            onChange(await storeAudio(exhibitionId, file, maxMB));
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
