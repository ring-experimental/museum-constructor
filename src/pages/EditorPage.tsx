import { ArrowLeft, Columns2, Footprints, Globe, Lock, Plus, Redo2, Square, Box, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../components/Toast';
import { imageRepo } from '../storage/imageRepo';
import { exhibitionRepo } from '../storage/exhibitionRepo';
import { href, navigate } from '../router';
import { addArtworksFromFiles, addFloor, deleteSelection } from '../editor/actions';
import { ArtworkLibrary } from '../editor/ArtworkLibrary';
import { Inspector } from '../editor/Inspector';
import { PlanCanvas } from '../editor/PlanCanvas';
import { Preview3D } from '../editor/Preview3D';
import { useEditor, type ViewLayout } from '../editor/store';
import { TOOLS, Toolbar, ToolOptions } from '../editor/Toolbar';

type SaveState = 'saved' | 'saving' | 'error';

export function EditorPage({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const load = useEditor((s) => s.load);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [fileOver, setFileOver] = useState(false);
  const lastSaved = useRef<unknown>(null);

  // 불러오기 + 참조되지 않는 업로드 이미지 정리
  useEffect(() => {
    let alive = true;
    exhibitionRepo.get(id).then(async (d) => {
      if (!alive) return;
      if (!d) return setMissing(true);
      lastSaved.current = d;
      load(d);
      const refs = new Set(d.artworks.flatMap((a) => (a.source.kind === 'upload' ? [a.source.blobId] : [])));
      const stored = await imageRepo.listByExhibition(d.id);
      for (const s of stored) if (!refs.has(s.id)) await imageRepo.remove(s.id);
    });
    return () => {
      alive = false;
      // 떠나기 직전 변경분 즉시 저장
      const d = useEditor.getState().doc;
      if (d && d !== lastSaved.current) void exhibitionRepo.save(d);
      useEditor.setState({ doc: null, past: [], future: [] });
    };
  }, [id, load]);

  // 자동 저장 (디바운스)
  useEffect(() => {
    if (!doc || doc === lastSaved.current) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      exhibitionRepo
        .save(doc)
        .then(() => {
          lastSaved.current = doc;
          setSaveState('saved');
        })
        .catch((e) => {
          console.error(e);
          setSaveState('error');
          toast('저장에 실패했어요. 브라우저 저장 공간을 확인하세요.', 'error');
        });
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  // 탭을 닫을 때 즉시 저장
  useEffect(() => {
    const flush = () => {
      const d = useEditor.getState().doc;
      if (d && d !== lastSaved.current) void exhibitionRepo.save(d);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // 단축키
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (document.querySelector('.modal-backdrop')) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod) return;
      const tool = TOOLS.find((x) => x.key === e.key);
      if (tool) {
        st.setTool(tool.id);
        return;
      }
      switch (e.code) {
        case 'KeyV':
          st.setTool('select');
          break;
        case 'Escape':
          if (st.selection) st.select(null);
          else st.setTool('select');
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          break;
        case 'KeyR': {
          if (st.selection?.kind === 'prop') {
            const pid = st.selection.id;
            st.mutateFloor((f) => {
              const p = f.props.find((x) => x.id === pid);
              if (p) p.rotation = (p.rotation + Math.PI / 2) % (Math.PI * 2);
            });
          } else st.rotateProp(Math.PI / 2);
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (st.selection?.kind !== 'prop') return;
          e.preventDefault();
          const step = e.shiftKey ? 0.5 : 0.1;
          const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0;
          const dz = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0;
          const pid = st.selection.id;
          st.mutateFloor((f) => {
            const p = f.props.find((x) => x.id === pid);
            if (p) {
              p.x = Math.round((p.x + dx) * 100) / 100;
              p.z = Math.round((p.z + dz) * 100) / 100;
            }
          });
          break;
        }
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // 창 전체에 사진 드롭 → 업로드
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setFileOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setFileOver(false);
    };
    const over = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setFileOver(false);
      if (e.dataTransfer?.files.length) void addArtworksFromFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (missing)
    return (
      <div className="visit visit--loading">
        <p>전시를 찾을 수 없습니다.</p>
        <a className="btn" href={href.studio()}>
          스튜디오로
        </a>
      </div>
    );
  if (!doc) return <div className="boot">편집기를 여는 중…</div>;
  return <EditorShell saveState={saveState} fileOver={fileOver} />;
}

function EditorShell({ saveState, fileOver }: { saveState: SaveState; fileOver: boolean }) {
  const doc = useEditor((s) => s.doc)!;
  const floorIndex = useEditor((s) => s.floorIndex);
  const setFloorIndex = useEditor((s) => s.setFloorIndex);
  const layout = useEditor((s) => s.layout);
  const setLayout = useEditor((s) => s.setLayout);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const mutate = useEditor((s) => s.mutate);
  const published = doc.status === 'published';

  const walk = async () => {
    await exhibitionRepo.save(useEditor.getState().doc!);
    navigate(href.visit(doc.id, { floor: floorIndex, from: 'editor' }));
  };

  const layouts: { id: ViewLayout; label: string; icon: React.ReactNode }[] = [
    { id: '2d', label: '도면', icon: <Square size={15} /> },
    { id: 'split', label: '분할', icon: <Columns2 size={15} /> },
    { id: '3d', label: '3D', icon: <Box size={15} /> },
  ];

  return (
    <div className="editor">
      <header className="editor__top">
        <a className="icon-btn" href={href.studio()} aria-label="스튜디오로 돌아가기" title="스튜디오로">
          <ArrowLeft size={18} />
        </a>
        <input className="editor__title" value={doc.title} onChange={(e) => mutate((d) => void (d.title = e.target.value))} aria-label="전시 제목" placeholder="전시 제목" />
        <span className={`save-state save-state--${saveState}`}>{saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중…' : '저장 실패'}</span>
        <div className="editor__top-group">
          <button className="icon-btn" disabled={!canUndo} onClick={undo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">
            <Undo2 size={18} />
          </button>
          <button className="icon-btn" disabled={!canRedo} onClick={redo} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">
            <Redo2 size={18} />
          </button>
        </div>
        <div className="seg seg--compact" role="group" aria-label="화면 구성">
          {layouts.map((l) => (
            <button key={l.id} className={layout === l.id ? 'is-active' : ''} onClick={() => setLayout(l.id)}>
              {l.icon}
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <div className="editor__top-spacer" />
        <button className="btn btn--sm" onClick={walk} title="저장하고 1인칭으로 걸어보기">
          <Footprints size={15} /> 걸어보기
        </button>
        <button
          className={`btn btn--sm ${published ? 'btn--live' : 'btn--primary'}`}
          onClick={() => {
            mutate((d) => void (d.status = published ? 'draft' : 'published'));
            toast(published ? '초안으로 바꿨어요. 관람 목록에서 숨겨져요.' : '전시를 공개했어요! 관람 모드 목록에 나타나요.', 'success');
          }}
          title={published ? '클릭하면 비공개(초안)로 전환' : '관람 모드 목록에 공개'}
        >
          {published ? <Globe size={15} /> : <Lock size={15} />}
          {published ? '공개 중' : '공개하기'}
        </button>
      </header>

      <div className="editor__main">
        <Toolbar />
        <div className="editor__center">
          <div className="floor-tabs" role="tablist" aria-label="층 선택">
            {doc.floors.map((f, k) => (
              <button key={f.id} role="tab" aria-selected={k === floorIndex} className={k === floorIndex ? 'is-active' : ''} onClick={() => setFloorIndex(k)}>
                {f.name}
              </button>
            ))}
            <button className="floor-tabs__add" onClick={() => addFloor(true)} title="층 추가 (현재 층 구조 복제)">
              <Plus size={15} /> 층 추가
            </button>
            <ToolOptions />
          </div>
          <div className={`editor__views editor__views--${layout}`}>
            {layout !== '3d' && <PlanCanvas />}
            {layout !== '2d' && <Preview3D />}
          </div>
          <ArtworkLibrary />
        </div>
        <Inspector />
      </div>

      {fileOver && (
        <div className="file-drop">
          <div>사진을 놓으면 작품 보관함에 추가돼요</div>
        </div>
      )}
    </div>
  );
}
