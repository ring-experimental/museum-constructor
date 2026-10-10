import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, Copy, Download, ImagePlus, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { toast } from '../components/Toast';
import { ART_HEIGHT_RANGE, CELL, DEFAULT_WALL_HEIGHT, FLOOR_STYLE_SPEC, FRAME_LIGHT_SPEC, FRAME_STYLE_SPEC, LIGHTING_SPEC, MAX_GRID, MIN_GRID, PROP_SPEC, TEXT_SIZE_SPEC, WALL_COLOR_PRESETS } from '../core/constants';
import { filledCells } from '../core/grid';
import type { Artwork, FloorStyle, FrameItem, FrameLight, FrameStyle, LightingPreset, Prop, PropType, TextAlign, TextColor, TextItem, TextSize } from '../core/types';
import { downloadBlob, exportExhibition } from '../storage/exportImport';
import { exhibitionRepo } from '../storage/exhibitionRepo';
import { addFloor, assignArtwork, assignSculpture, deleteSelection, moveFloor, removeArtwork, removeFloor, resizeFloor, usageMap, WALL_PICKER_MEDIA } from './actions';
import { ArtworkPicker } from './ArtworkPicker';
import { AudioAttachment } from './AudioAttachment';
import { TourOrderSection } from './TourOrder';
import { useTxnField } from './useTxnField';
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

function TextField({ label, value, onChange, multiline, placeholder, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; rows?: number }) {
  const txn = useTxnField();
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...txn} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...txn} />
      )}
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
        <p>도면에서 액자, 벽 글, 소품, 시작 위치를 클릭하면 여기서 자세히 설정할 수 있어요.</p>
        <ul className="tips">
          <li>
            <b>빠르게 시작하기</b> — 아래 보관함에서 <em>사진 업로드</em> 후 <em>빈 벽에 자동 배치</em>를 누르세요.
          </li>
          <li>
            <b>화면 이동</b> — 빈 곳 드래그(선택 도구) · 스페이스+드래그 · 휠로 확대/축소
          </li>
          <li>
            <b>여러 개 선택</b> — Shift+클릭 · Shift+드래그로 범위 선택 · Ctrl+A 로 층 전체
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
  if (selection.kind === 'multi') return <MultiPanel ids={selection.ids} />;
  if (selection.kind === 'prop') {
    const p = floor.props.find((x) => x.id === selection.id);
    return p ? <PropPanel id={p.id} /> : null;
  }
  const item = floor.wallItems.find((w) => w.id === selection.id);
  if (!item) return null;
  if (item.kind === 'text') return <TextPanel item={item} />;
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

      <h4>조명</h4>
      <LightSeg active={(k) => frame.light === k} onPick={(k) => set((f) => void (f.light = k))} />
      <p className="muted small">{FRAME_LIGHT_SPEC[frame.light].hint}. 스포트라이트는 ‘드라마틱’ 전시 조명에서 가장 돋보여요.</p>

      <button className="btn btn--danger" onClick={deleteSelection}>
        <Trash2 size={16} /> 액자 삭제
      </button>
      {picking && (
        <ArtworkPicker
          media={WALL_PICKER_MEDIA}
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

function LightSeg({ active, onPick }: { active: (k: FrameLight) => boolean; onPick: (k: FrameLight) => void }) {
  return (
    <div className="seg seg--full" role="group" aria-label="작품 조명">
      {(Object.keys(FRAME_LIGHT_SPEC) as FrameLight[]).map((k) => (
        <button key={k} className={active(k) ? 'is-active' : ''} onClick={() => onPick(k)} title={FRAME_LIGHT_SPEC[k].hint}>
          {FRAME_LIGHT_SPEC[k].label}
        </button>
      ))}
    </div>
  );
}

/** 여러 항목을 한꺼번에 맞추는 패널 */
function MultiPanel({ ids }: { ids: string[] }) {
  const floor = useEditor(currentFloor)!;
  const doc = useEditor((s) => s.doc)!;
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const txn = useTxnSlider();
  const set = new Set(ids);
  const frames = floor.wallItems.filter((w): w is FrameItem => w.kind === 'frame' && set.has(w.id));
  const texts = floor.wallItems.filter((w): w is TextItem => w.kind === 'text' && set.has(w.id));
  const elevators = floor.wallItems.filter((w) => w.kind === 'elevator' && set.has(w.id)).length;
  const props = floor.props.filter((p) => set.has(p.id));
  const artMap = new Map(doc.artworks.map((a) => [a.id, a]));
  const frameH = (f: FrameItem) => {
    const a = f.artworkId ? artMap.get(f.artworkId) : undefined;
    return f.width / (a ? a.width / Math.max(1, a.height) : 4 / 3);
  };
  const eachFrame = (fn: (f: FrameItem) => void) =>
    mutateFloor((fl) => {
      for (const w of fl.wallItems) if (w.kind === 'frame' && set.has(w.id)) fn(w);
    });
  const eachWallItem = (fn: (w: FrameItem | TextItem) => void) =>
    mutateFloor((fl) => {
      for (const w of fl.wallItems) if ((w.kind === 'frame' || w.kind === 'text') && set.has(w.id)) fn(w);
    });
  /** 중심 높이를 맞추되 작품이 바닥에 닿지 않게 액자마다 최소 높이 보정 */
  const setCenterLine = (v: number) => eachFrame((f) => void (f.elevation = Math.min(3.2, Math.max(0.5, frameH(f) / 2 + 0.15, v))));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const centerLine = Math.round(avg(frames.map((f) => f.elevation)) * 100) / 100;
  const captionState = frames.every((f) => f.showCaption) ? true : frames.every((f) => !f.showCaption) ? false : null;
  const summary = [frames.length && `액자 ${frames.length}`, texts.length && `벽 글 ${texts.length}`, props.length && `소품 ${props.length}`, elevators && `엘리베이터 ${elevators}`].filter(Boolean).join(' · ');

  return (
    <div className="panel">
      <h3>{ids.length}개 선택됨</h3>
      <p className="muted small">{summary}. Shift+클릭으로 더하거나 빼고, Esc 로 선택을 풀어요.</p>

      {frames.length > 0 && (
        <>
          <h4>액자 맞추기</h4>
          <div {...txn}>
            <Slider label="중심 높이 (모두 같게)" value={centerLine} min={0.8} max={2.6} step={0.05} onChange={setCenterLine} />
          </div>
          <div className="row">
            <button className="btn btn--sm" onClick={() => setCenterLine(1.45)} title="미술관에서 흔히 쓰는 작품 중심 높이">
              눈높이 1.45m
            </button>
            <button className="btn btn--sm" onClick={() => setCenterLine(1.55)}>
              1.55m
            </button>
          </div>
          <div className="field">
            <span>크기 통일</span>
            <div className="seg seg--full" role="group" aria-label="크기 통일">
              {(
                [
                  ['S', 0.6],
                  ['M', 1.05],
                  ['L', 1.5],
                  ['XL', 2.4],
                ] as const
              ).map(([k, w]) => (
                <button key={k} className={frames.every((f) => Math.abs(f.width - w) < 0.01) ? 'is-active' : ''} onClick={() => eachFrame((f) => void (f.width = w))}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>액자 스타일</span>
            <div className="swatches">
              {(Object.keys(FRAME_STYLE_SPEC) as FrameStyle[]).map((k) => (
                <button key={k} className={`swatch ${frames.every((f) => f.frameStyle === k) ? 'is-active' : ''}`} onClick={() => eachFrame((f) => void (f.frameStyle = k))} title={FRAME_STYLE_SPEC[k].label}>
                  <i style={{ background: k === 'none' ? 'repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 8px)' : FRAME_STYLE_SPEC[k].color }} />
                  <span>{FRAME_STYLE_SPEC[k].label}</span>
                </button>
              ))}
            </div>
          </div>
          <div {...txn}>
            <Slider label="매트(여백) 폭" value={avg(frames.map((f) => f.mat))} min={0} max={0.3} step={0.01} onChange={(v) => eachFrame((f) => void (f.mat = v))} />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={captionState === true}
              ref={(el) => {
                if (el) el.indeterminate = captionState === null;
              }}
              onChange={(e) => eachFrame((f) => void (f.showCaption = e.target.checked))}
            />
            명제표(제목·작가) 표시
          </label>
        </>
      )}

      {frames.length > 0 && (
        <div className="field">
          <span>조명</span>
          <LightSeg active={(k) => frames.every((f) => f.light === k)} onPick={(k) => eachFrame((f) => void (f.light = k))} />
        </div>
      )}

      {texts.length > 0 && (
        <div className="field">
          <span>벽 글 크기</span>
          <div className="seg seg--full" role="group" aria-label="벽 글 크기">
            {(Object.keys(TEXT_SIZE_SPEC) as TextSize[]).map((k) => (
              <button
                key={k}
                className={texts.every((t) => t.size === k) ? 'is-active' : ''}
                onClick={() =>
                  mutateFloor((fl) => {
                    for (const w of fl.wallItems) if (w.kind === 'text' && set.has(w.id)) w.size = k;
                  })
                }
              >
                {TEXT_SIZE_SPEC[k].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {frames.length + texts.length > 0 && (
        <button className="btn btn--sm" onClick={() => eachWallItem((w) => void (w.offset = 0))} title="각 항목을 걸린 벽 구간의 가운데로">
          벽 구간 가운데로 정렬
        </button>
      )}
      {props.length > 0 && (
        <button
          className="btn btn--sm"
          onClick={() =>
            mutateFloor((fl) => {
              for (const p of fl.props) if (set.has(p.id)) p.rotation = (p.rotation + Math.PI / 2) % (Math.PI * 2);
            })
          }
        >
          <RotateCw size={15} /> 소품 각자 90° 회전 (R)
        </button>
      )}
      {props.length > 0 && <p className="muted small">방향키로 선택한 소품을 함께 옮길 수 있어요 (Shift = 크게).</p>}

      <button className="btn btn--danger" onClick={deleteSelection}>
        <Trash2 size={16} /> {ids.length}개 모두 삭제
      </button>
    </div>
  );
}

function TextPanel({ item }: { item: TextItem }) {
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const txn = useTxnSlider();
  const set = (fn: (t: TextItem) => void) =>
    mutateFloor((fl) => {
      const w = fl.wallItems.find((x) => x.id === item.id);
      if (w && w.kind === 'text') fn(w);
    });
  const sizes = Object.keys(TEXT_SIZE_SPEC) as TextSize[];
  const aligns: [TextAlign, string][] = [
    ['left', '왼쪽 정렬'],
    ['center', '가운데 정렬'],
  ];
  const colors: [TextColor, string][] = [
    ['auto', '자동'],
    ['dark', '어두운 글씨'],
    ['light', '밝은 글씨'],
  ];
  return (
    <div className="panel">
      <h3>벽 글</h3>
      <p className="muted small">전시 서문, 섹션 제목, 안내문처럼 벽에 직접 쓰는 글이에요. 관람객이 클릭하면 가까이서 읽을 수 있어요.</p>
      <TextField label="제목" value={item.title} onChange={(v) => set((t) => void (t.title = v.slice(0, 80)))} placeholder="예) 1부 · 빛을 기다리는 시간" />
      <TextField label="본문" value={item.body} multiline rows={7} onChange={(v) => set((t) => void (t.body = v.slice(0, 2000)))} placeholder="여러 줄로 쓸 수 있어요. 빈 줄을 넣으면 문단이 나뉘어요." />

      <h4>모양</h4>
      <div className="field">
        <span>글자 크기</span>
        <div className="seg seg--full" role="group" aria-label="글자 크기">
          {sizes.map((k) => (
            <button key={k} className={item.size === k ? 'is-active' : ''} onClick={() => set((t) => void (t.size = k))}>
              {TEXT_SIZE_SPEC[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>정렬</span>
        <div className="seg seg--full" role="group" aria-label="정렬">
          {aligns.map(([k, label]) => (
            <button key={k} className={item.align === k ? 'is-active' : ''} onClick={() => set((t) => void (t.align = k))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>글자 색</span>
        <div className="seg seg--full" role="group" aria-label="글자 색">
          {colors.map(([k, label]) => (
            <button key={k} className={item.color === k ? 'is-active' : ''} onClick={() => set((t) => void (t.color = k))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div {...txn}>
        <Slider label="글 폭" value={item.width} min={0.6} max={4} step={0.05} onChange={(v) => set((t) => void (t.width = v))} />
        <Slider label="중심 높이" value={item.elevation} min={0.8} max={3} step={0.05} onChange={(v) => set((t) => void (t.elevation = v))} />
        <Slider label="좌우 위치" value={item.offset} min={-CELL / 2} max={CELL / 2} step={0.05} onChange={(v) => set((t) => void (t.offset = v))} />
      </div>
      <button className="btn btn--danger" onClick={deleteSelection}>
        <Trash2 size={16} /> 벽 글 삭제
      </button>
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
            <ArtworkImage source={art.source} variant={art.media === 'image' ? 'full' : 'thumb'} />
          </div>
        </>
      )}
      {!standalone && <h4>작품 정보</h4>}
      <TextField label="제목" value={art.title} onChange={(v) => set((a) => void (a.title = v))} placeholder="무제" />
      <TextField label="작가" value={art.artist} onChange={(v) => set((a) => void (a.artist = v))} />
      <TextField label="제작 연도" value={art.year} onChange={(v) => set((a) => void (a.year = v))} placeholder="예) 2026" />
      <TextField label="작품 설명" value={art.description} multiline onChange={(v) => set((a) => void (a.description = v))} placeholder="관람객이 작품을 클릭하면 보이는 설명이에요" />
      <AudioAttachment
        label="음성 해설 녹음 (선택)"
        blobId={art.audioBlobId}
        onChange={(id) => set((a) => void (a.audioBlobId = id))}
        hint={doc.audio.tts ? '녹음이 없으면 관람객이 음성 해설을 켰을 때 작품 설명을 음성 합성으로 읽어 줘요.' : '녹음이 있으면 관람객이 음성 해설을 켰을 때 들려줘요.'}
      />
      <p className="muted small">
        {art.media === 'model' ? '3D 모델 (GLB)' : art.media === 'video' ? `영상 ${art.width}×${art.height}` : `원본 ${art.width}×${art.height}px`} · {art.source.kind === 'upload' ? '업로드' : art.source.kind === 'url' ? '외부 URL' : '샘플'} · {art.media === 'model' ? `좌대 ${uses}곳에 올림` : `액자 ${uses}곳에 걸림`}
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
          <button
            key={k}
            className={p.type === k ? 'is-active' : ''}
            onClick={() =>
              set((q) => {
                q.type = k;
                if (k !== 'pedestal') q.artworkId = null;
              })
            }
          >
            {PROP_SPEC[k].label}
          </button>
        ))}
      </div>
      {p.type === 'pedestal' && <SculptureSection prop={p} />}
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

/** 조각 좌대 위 입체 작품 */
function SculptureSection({ prop }: { prop: Prop }) {
  const doc = useEditor((s) => s.doc)!;
  const mutateFloor = useEditor((s) => s.mutateFloor);
  const txn = useTxnSlider();
  const [picking, setPicking] = useState(false);
  const art = prop.artworkId ? doc.artworks.find((a) => a.id === prop.artworkId) : undefined;
  return (
    <>
      <h4>좌대 위 입체 작품</h4>
      <div className="frame-art">
        <button className="frame-art__thumb" onClick={() => setPicking(true)} aria-label="입체 작품 고르기">
          {art ? <ArtworkImage source={art.source} /> : <ImagePlus size={28} strokeWidth={1.4} />}
        </button>
        <div className="frame-art__actions">
          <button className="btn btn--primary btn--sm" onClick={() => setPicking(true)}>
            {art ? '작품 바꾸기' : '작품 올리기'}
          </button>
          {art ? (
            <button className="btn btn--ghost btn--sm" onClick={() => assignSculpture(prop.id, null)}>
              내리기
            </button>
          ) : (
            <span className="muted small">GLB 3D 모델을 올릴 수 있어요</span>
          )}
        </div>
      </div>
      {art && (
        <>
          <div {...txn}>
            <Slider
              label="작품 높이"
              value={prop.artHeight}
              min={ART_HEIGHT_RANGE.min}
              max={ART_HEIGHT_RANGE.max}
              step={0.05}
              onChange={(v) =>
                mutateFloor((f) => {
                  const q = f.props.find((x) => x.id === prop.id);
                  if (q) q.artHeight = v;
                })
              }
            />
          </div>
          <ArtworkInfo art={art} />
        </>
      )}
      {picking && (
        <ArtworkPicker
          media={['model']}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            assignSculpture(prop.id, id);
            setPicking(false);
          }}
        />
      )}
    </>
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

      <TourOrderSection />

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
  const txn = useTxnSlider();
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

      <h4>소리</h4>
      <AudioAttachment
        label="배경 음악"
        blobId={doc.audio.bgmBlobId}
        maxMB={30}
        onChange={(id) => mutate((d) => void (d.audio.bgmBlobId = id))}
        hint="관람객이 입장하면 반복 재생돼요. 저작권이 있는 음악은 사용 허락을 받은 파일만 올려 주세요."
      />
      {doc.audio.bgmBlobId && (
        <div {...txn}>
          <Slider label="배경 음악 음량" value={Math.round(doc.audio.bgmVolume * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => mutate((d) => void (d.audio.bgmVolume = v / 100))} />
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={doc.audio.tts} onChange={(e) => mutate((d) => void (d.audio.tts = e.target.checked))} />
        녹음이 없는 작품·벽 글은 음성 합성으로 읽어 주기
      </label>
      <p className="muted small">
        관람객이 화면의 헤드폰 버튼으로 음성 해설을 켜면, 작품 앞에 설 때마다 해설이 나와요. 자동 투어도 해설이 끝난 뒤 다음 작품으로 넘어가요. 해설 음성은 관람객 브라우저의 기본 음성 합성을 쓰며, 이를 지원하지 않는 브라우저에서는 음성 해설 버튼이 나타나지 않아요.
      </p>

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
