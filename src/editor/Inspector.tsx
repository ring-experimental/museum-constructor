import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, Copy, Download, ImagePlus, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { toast } from '../components/Toast';
import { CELL, DEFAULT_WALL_HEIGHT, FLOOR_STYLE_SPEC, FRAME_STYLE_SPEC, LIGHTING_SPEC, MAX_GRID, MIN_GRID, PROP_SPEC, WALL_COLOR_PRESETS } from '../core/constants';
import { filledCells } from '../core/grid';
import type { Artwork, FloorStyle, FrameItem, FrameStyle, LightingPreset, PropType } from '../core/types';
import { downloadBlob, exportExhibition } from '../storage/exportImport';
import { exhibitionRepo } from '../storage/exhibitionRepo';
import { addFloor, assignArtwork, deleteSelection, moveFloor, removeArtwork, removeFloor, resizeFloor, usageMap } from './actions';
import { ArtworkPicker } from './ArtworkPicker';
import { currentFloor, useEditor, type InspectorTab } from './store';

export function Inspector() {
  const tab = useEditor((s) => s.tab);
  const setTab = useEditor((s) => s.setTab);
  const selection = useEditor((s) => s.selection);
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'selection', label: '선택 항목' },
    { id: 'floor', label: '층 설정' },
    { id: 'exhibition', label: '전시 정보' },
  ];
  return (
    <aside className="inspector">
      <div className="inspector__tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'selection' && selection && <i className="dot" />}
          </button>
        ))}
      </div>
      <div className="inspector__body">
        {tab === 'selection' && <SelectionPanel />}
        {tab === 'floor' && <FloorPanel />}
        {tab === 'exhibition' && <ExhibitionPanel />}
      </div>
    </aside>
  );
}

// ── 공통 입력 ─────────────────────────────────────────────

function Slider({ label, value, min, max, step, unit = 'm', onChange, onCommit }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; onCommit?: () => void }) {
  return (
    <label className="field field--slider">
      <span>
        {label}
        <output>
          {Number(value.toFixed(2))}
          {unit}
        </output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
    </label>
  );
}

/** 슬라이더 드래그 동안은 한 번의 실행취소 단위로 묶는다 */
function useTxnSlider() {
  const begin = useEditor((s) => s.beginTxn);
  const end = useEditor((s) => s.endTxn);
  return {
    onPointerDownCapture: () => begin(),
    onPointerUpCapture: () => end(),
  };
}

function TextField({ label, value, onChange, multiline, placeholder }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea value={value} rows={4} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

// ── 선택 항목 ─────────────────────────────────────────────

function SelectionPanel() {
  const selection = useEditor((s) => s.selection);
  const floor = useEditor(currentFloor);
  const doc = useEditor((s) => s.doc);
  if (!selection || !floor || !doc)
    return (
      <div className="inspector__empty">
        <p>도면에서 액자, 소품, 시작 위치를 클릭하면 여기서 자세히 설정할 수 있어요.</p>
        <ul className="tips">
          <li>
            <b>빠르게 시작하기</b> — 아래 보관함에서 <em>사진 업로드</em> 후 <em>빈 벽에 자동 배치</em>를 누르세요.
          </li>
          <li>
            <b>화면 이동</b> — 빈 곳 드래그(선택 도구) · 스페이스+드래그 · 휠로 확대/축소
          </li>
          <li>
            <b>실행취소</b> — Ctrl+Z / 다시실행 Ctrl+Shift+Z
          </li>
        </ul>
      </div>
    );
  if (selection.kind === 'artwork') {
    const art = doc.artworks.find((a) => a.id === selection.id);
    return art ? <ArtworkInfo art={art} standalone /> : null;
  }
  if (selection.kind === 'spawn') return <SpawnPanel />;
  if (selection.kind === 'prop') {
    const p = floor.props.find((x) => x.id === selection.id);
    return p ? <PropPanel id={p.id} /> : null;
  }
  const item = floor.wallItems.find((w) => w.id === selection.id);
  if (!item) return null;
  if (item.kind === 'elevator')
    return (
      <div className="panel">
        <h3>엘리베이터</h3>
        <p className="muted">관람객이 가까이 가거나 클릭하면 다른 층으로 이동할 수 있어요. 다른 층에도 엘리베이터를 두면 그 앞에 도착해요.</p>
        <p className="muted">선택 도구로 드래그하면 다른 벽으로 옮길 수 있어요.</p>
        <button className="btn btn--danger" onClick={deleteSelection}>
          <Trash2 size={16} /> 엘리베이터 삭제
        </button>
      </div>
    );
  return <FramePanel frame={item} />;
}

function FramePanel({ frame }: { frame: FrameItem }) {
  const doc = useEditor((s) => s.doc)!;
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const txn = useTxnSlider();
  const [picking, setPicking] = useState(false);
  const art = frame.artworkId ? doc.artworks.find((a) => a.id === frame.artworkId) : undefined;
  const set = (fn: (f: FrameItem) => void) =>
    mutateFloor((fl) => {
      const w = fl.wallItems.find((x) => x.id === frame.id);
      if (w && w.kind === 'frame') fn(w);
    });
  const aspect = art ? art.width / Math.max(1, art.height) : 4 / 3;
  const h = frame.width / aspect;

  return (
    <div className="panel">
      <h3>액자</h3>
      <div className="frame-art">
        <button className="frame-art__thumb" onClick={() => setPicking(true)} aria-label="작품 고르기">
          {art ? <ArtworkImage source={art.source} /> : <ImagePlus size={28} strokeWidth={1.4} />}
        </button>
        <div className="frame-art__actions">
          <button className="btn btn--primary btn--sm" onClick={() => setPicking(true)}>
            {art ? '작품 바꾸기' : '작품 걸기'}
          </button>
          {art && (
            <button className="btn btn--ghost btn--sm" onClick={() => assignArtwork(frame.id, null)}>
              비우기
            </button>
          )}
        </div>
      </div>

      {art && <ArtworkInfo art={art} />}

      <h4>크기와 위치</h4>
      <div className="seg seg--full" role="group" aria-label="크기 프리셋">
        {[
          ['S', 0.6],
          ['M', 1.05],
          ['L', 1.5],
          ['XL', 2.4],
        ].map(([k, w]) => (
          <button key={k} className={Math.abs(frame.width - (w as number)) < 0.01 ? 'is-active' : ''} onClick={() => set((f) => void (f.width = w as number))}>
            {k}
          </button>
        ))}
      </div>
      <div {...txn}>
        <Slider label={`가로 (세로 ${h.toFixed(2)}m)`} value={frame.width} min={0.3} max={4} step={0.05} onChange={(v) => set((f) => void (f.width = v))} />
        <Slider label="중심 높이" value={frame.elevation} min={Math.max(0.5, h / 2 + 0.15)} max={3.2} step={0.05} onChange={(v) => set((f) => void (f.elevation = v))} />
        <Slider label="좌우 위치" value={frame.offset} min={-CELL / 2} max={CELL / 2} step={0.05} onChange={(v) => set((f) => void (f.offset = v))} />
      </div>

      <h4>액자 스타일</h4>
      <div className="swatches">
        {(Object.keys(FRAME_STYLE_SPEC) as FrameStyle[]).map((k) => (
          <button key={k} className={`swatch ${frame.frameStyle === k ? 'is-active' : ''}`} onClick={() => set((f) => void (f.frameStyle = k))} title={FRAME_STYLE_SPEC[k].label}>
            <i style={{ background: k === 'none' ? 'repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 8px)' : FRAME_STYLE_SPEC[k].color }} />
            <span>{FRAME_STYLE_SPEC[k].label}</span>
          </button>
        ))}
      </div>
      {frame.frameStyle !== 'none' && (
        <div {...txn}>
          <Slider label="매트(여백) 폭" value={frame.mat} min={0} max={0.3} step={0.01} onChange={(v) => set((f) => void (f.mat = v))} />
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={frame.showCaption} onChange={(e) => set((f) => void (f.showCaption = e.target.checked))} />
        작품 옆에 명제표(제목·작가) 표시
      </label>

      <button className="btn btn--danger" onClick={deleteSelection}>
        <Trash2 size={16} /> 액자 삭제
      </button>
      {picking && (
        <ArtworkPicker
          onClose={() => setPicking(false)}
          onPick={(id) => {
            assignArtwork(frame.id, id);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function ArtworkInfo({ art, standalone }: { art: Artwork; standalone?: boolean }) {
  const mutate = useEditor((s) => s.mutate);
  const doc = useEditor((s) => s.doc)!;
  const uses = usageMap(doc).get(art.id) ?? 0;
  const set = (fn: (a: Artwork) => void) =>
    mutate((d) => {
      const a = d.artworks.find((x) => x.id === art.id);
      if (a) fn(a);
    });
  return (
    <div className={standalone ? 'panel' : 'artwork-info'}>
      {standalone && (
        <>
          <h3>작품 정보</h3>
          <div className="artwork-preview">
            <ArtworkImage source={art.source} variant="full" />
          </div>
        </>
      )}
      {!standalone && <h4>작품 정보</h4>}
      <TextField label="제목" value={art.title} onChange={(v) => set((a) => void (a.title = v))} placeholder="무제" />
      <TextField label="작가" value={art.artist} onChange={(v) => set((a) => void (a.artist = v))} />
      <TextField label="제작 연도" value={art.year} onChange={(v) => set((a) => void (a.year = v))} placeholder="예) 2026" />
      <TextField label="작품 설명" value={art.description} multiline onChange={(v) => set((a) => void (a.description = v))} placeholder="관람객이 작품을 클릭하면 보이는 설명이에요" />
      <p className="muted small">
        원본 {art.width}×{art.height}px · {art.source.kind === 'upload' ? '업로드' : art.source.kind === 'url' ? '외부 URL' : '샘플'} · 액자 {uses}곳에 걸림
      </p>
      {standalone && (
        <button className="btn btn--danger" onClick={() => removeArtwork(art.id)}>
          <Trash2 size={16} /> 보관함에서 삭제
        </button>
      )}
    </div>
  );
}

function PropPanel({ id }: { id: string }) {
  const floor = useEditor(currentFloor)!;
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const p = floor.props.find((x) => x.id === id)!;
  const set = (fn: (q: typeof p) => void) =>
    mutateFloor((f) => {
      const q = f.props.find((x) => x.id === id);
      if (q) fn(q);
    });
  return (
    <div className="panel">
      <h3>소품</h3>
      <div className="seg seg--full">
        {(Object.keys(PROP_SPEC) as PropType[]).map((k) => (
          <button key={k} className={p.type === k ? 'is-active' : ''} onClick={() => set((q) => void (q.type = k))}>
            {PROP_SPEC[k].label}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn btn--sm" onClick={() => set((q) => void (q.rotation = (q.rotation + Math.PI / 2) % (Math.PI * 2)))}>
          <RotateCcw size={15} /> 왼쪽 90°
        </button>
        <button className="btn btn--sm" onClick={() => set((q) => void (q.rotation = (q.rotation - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)))}>
          <RotateCw size={15} /> 오른쪽 90°
        </button>
      </div>
      <p className="muted small">드래그로 이동 · 방향키로 미세 이동 · R 키로 회전 · Shift+드래그는 자유 이동</p>
      <button className="btn btn--danger" onClick={deleteSelection}>
        <Trash2 size={16} /> 소품 삭제
      </button>
    </div>
  );
}

function SpawnPanel() {
  const floor = useEditor(currentFloor)!;
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const dirs: [string, number, React.ReactNode][] = [
    ['위쪽', 0, <ArrowUp key="u" size={16} />],
    ['오른쪽', -Math.PI / 2, <ArrowRight key="r" size={16} />],
    ['아래쪽', Math.PI, <ArrowDown key="d" size={16} />],
    ['왼쪽', Math.PI / 2, <ArrowLeft key="l" size={16} />],
  ];
  return (
    <div className="panel">
      <h3>시작 위치</h3>
      <p className="muted">관람객이 이 층에 처음 들어왔을 때 서 있는 곳과 바라보는 방향이에요. (엘리베이터로 도착할 때는 엘리베이터 앞)</p>
      <div className="seg seg--full">
        {dirs.map(([label, yaw, icon]) => (
          <button key={label} className={floor.spawn && Math.abs(floor.spawn.yaw - yaw) < 0.01 ? 'is-active' : ''} onClick={() => mutateFloor((f) => void (f.spawn && (f.spawn.yaw = yaw)))} aria-label={label}>
            {icon}
          </button>
        ))}
      </div>
      <button className="btn btn--danger" onClick={deleteSelection}>
        <Trash2 size={16} /> 시작 위치 지우기 (자동)
      </button>
    </div>
  );
}

// ── 층 설정 ───────────────────────────────────────────────

function FloorPanel() {
  const doc = useEditor((s) => s.doc)!;
  const floorIndex = useEditor((s) => s.floorIndex);
  const floor = doc.floors[floorIndex];
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const txn = useTxnSlider();
  const [cols, setCols] = useState(floor.cols);
  const [rows, setRows] = useState(floor.rows);
  const [syncId, setSyncId] = useState(floor.id + floor.cols + floor.rows);
  if (syncId !== floor.id + floor.cols + floor.rows) {
    setSyncId(floor.id + floor.cols + floor.rows);
    setCols(floor.cols);
    setRows(floor.rows);
  }
  const area = filledCells(floor).length * CELL * CELL;
  const frames = floor.wallItems.filter((w) => w.kind === 'frame');
  const hasElevator = floor.wallItems.some((w) => w.kind === 'elevator');
  const clampGrid = (n: number) => Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(n) || MIN_GRID));

  return (
    <div className="panel">
      <h3>{floor.name} 설정</h3>
      <TextField label="층 이름" value={floor.name} onChange={(v) => mutateFloor((f) => void (f.name = v.slice(0, 12)))} />
      <div className="field">
        <span>부지 크기 (칸 · 1칸 = {CELL}m)</span>
        <div className="row">
          <input type="number" min={MIN_GRID} max={MAX_GRID} value={cols} onChange={(e) => setCols(Number(e.target.value))} aria-label="가로 칸 수" />
          <span>×</span>
          <input type="number" min={MIN_GRID} max={MAX_GRID} value={rows} onChange={(e) => setRows(Number(e.target.value))} aria-label="세로 칸 수" />
          <button
            className="btn btn--sm"
            disabled={clampGrid(cols) === floor.cols && clampGrid(rows) === floor.rows}
            onClick={() => {
              const c = clampGrid(cols);
              const r = clampGrid(rows);
              setCols(c);
              setRows(r);
              resizeFloor(c, r);
            }}
          >
            적용
          </button>
        </div>
        <small className="muted">
          {floor.cols * CELL}m × {floor.rows * CELL}m 부지 · 전시 면적 {area}㎡
        </small>
      </div>
      <div {...txn}>
        <Slider label="천장 높이" value={floor.wallHeight} min={3} max={8} step={0.25} onChange={(v) => mutateFloor((f) => void (f.wallHeight = v))} />
      </div>
      {floor.wallHeight !== DEFAULT_WALL_HEIGHT && (
        <button className="link-btn" onClick={() => mutateFloor((f) => void (f.wallHeight = DEFAULT_WALL_HEIGHT))}>
          기본 높이({DEFAULT_WALL_HEIGHT}m)로
        </button>
      )}
      <p className="muted small">
        액자 {frames.length}개 (작품이 걸린 액자 {frames.filter((f) => f.kind === 'frame' && f.artworkId).length}개) · 소품 {floor.props.length}개
      </p>
      {doc.floors.length > 1 && !hasElevator && <p className="notice">이 층에 엘리베이터가 없어요. 관람객은 화면의 층 버튼으로도 이동할 수 있지만, 엘리베이터를 두면 더 자연스러워요.</p>}

      <h4>층 관리</h4>
      <div className="floor-list">
        {doc.floors.map((f, k) => (
          <div key={f.id} className={`floor-list__row ${k === floorIndex ? 'is-active' : ''}`}>
            <button className="floor-list__name" onClick={() => useEditor.getState().setFloorIndex(k)}>
              {f.name}
            </button>
            <button className="icon-btn" disabled={k === doc.floors.length - 1} onClick={() => moveFloor(k, 1)} aria-label="위층으로" title="위층으로">
              <ChevronUp size={16} />
            </button>
            <button className="icon-btn" disabled={k === 0} onClick={() => moveFloor(k, -1)} aria-label="아래층으로" title="아래층으로">
              <ChevronDown size={16} />
            </button>
            <button className="icon-btn icon-btn--danger" disabled={doc.floors.length <= 1} onClick={() => removeFloor(k)} aria-label="층 삭제" title="층 삭제">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn btn--sm" onClick={() => addFloor(false)}>
          <Plus size={15} /> 빈 층 추가
        </button>
        <button className="btn btn--sm" onClick={() => addFloor(true)}>
          <Copy size={15} /> 현재 층 구조 복제
        </button>
      </div>
    </div>
  );
}

// ── 전시 정보 ─────────────────────────────────────────────

function ExhibitionPanel() {
  const doc = useEditor((s) => s.doc)!;
  const mutate = useEditor((s) => s.mutate);
  return (
    <div className="panel">
      <h3>전시 정보</h3>
      <TextField label="전시 제목" value={doc.title} onChange={(v) => mutate((d) => void (d.title = v))} />
      <TextField label="부제" value={doc.subtitle} onChange={(v) => mutate((d) => void (d.subtitle = v))} />
      <TextField label="기획 / 작가" value={doc.curator} onChange={(v) => mutate((d) => void (d.curator = v))} />
      <TextField label="전시 소개" value={doc.description} multiline onChange={(v) => mutate((d) => void (d.description = v))} placeholder="관람객이 입장할 때 보는 초대장 문구예요" />

      <label className="field">
        <span>대표 이미지 (목록 표지)</span>
        <select value={doc.coverArtworkId ?? ''} onChange={(e) => mutate((d) => void (d.coverArtworkId = e.target.value || null))}>
          <option value="">자동 (첫 작품)</option>
          {doc.artworks.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title || '무제'}
            </option>
          ))}
        </select>
      </label>

      <h4>공간 분위기</h4>
      <div className="field">
        <span>벽 색</span>
        <div className="colors">
          {WALL_COLOR_PRESETS.map((c) => (
            <button key={c} className={`color ${doc.theme.wallColor === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => mutate((d) => void (d.theme.wallColor = c))} aria-label={c} />
          ))}
          <label className="color color--custom" title="직접 선택">
            <input type="color" value={doc.theme.wallColor} onChange={(e) => mutate((d) => void (d.theme.wallColor = e.target.value))} />
          </label>
        </div>
      </div>
      <div className="field">
        <span>바닥</span>
        <div className="seg seg--full seg--wrap">
          {(Object.keys(FLOOR_STYLE_SPEC) as FloorStyle[]).map((k) => (
            <button key={k} className={doc.theme.floorStyle === k ? 'is-active' : ''} onClick={() => mutate((d) => void (d.theme.floorStyle = k))}>
              <i className="chip" style={{ background: FLOOR_STYLE_SPEC[k].color }} />
              {FLOOR_STYLE_SPEC[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>조명</span>
        <div className="options">
          {(Object.keys(LIGHTING_SPEC) as LightingPreset[]).map((k) => (
            <button key={k} className={`option ${doc.theme.lighting === k ? 'is-active' : ''}`} onClick={() => mutate((d) => void (d.theme.lighting = k))}>
              <strong>{LIGHTING_SPEC[k].label}</strong>
              <span>{LIGHTING_SPEC[k].description}</span>
            </button>
          ))}
        </div>
      </div>

      <h4>파일</h4>
      <button
        className="btn btn--sm"
        onClick={async () => {
          await exhibitionRepo.save(useEditor.getState().doc!);
          try {
            const { blob, filename } = await exportExhibition(doc.id);
            downloadBlob(blob, filename);
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}
      >
        <Download size={15} /> 전시 파일로 내보내기 (.museum.json)
      </button>
      <p className="muted small">업로드한 사진까지 한 파일에 담겨요. 다른 브라우저에서 ‘전시 파일 가져오기’로 열 수 있어요.</p>
    </div>
  );
}
