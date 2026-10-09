import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CELL, ELEVATOR_WIDTH, PROP_SPEC, WALL_THICKNESS } from '../core/constants';
import { fillRect } from '../core/factory';
import { cellAt, computeWallEdges, edgeKey, isFilled, nearestEdge, nearestFace, parseEdge, wallItemPose, type WallEdge } from '../core/grid';
import type { Floor, FrameItem, Prop, Spawn, WallItem } from '../core/types';
import { frameDims } from '../three/frameGeometry';
import { assignArtwork, deleteItem, existingItemOnFace, placeElevator, placeFrame, placeProp, reportCleanup } from './actions';
import { cleanupFloor, snap, useEditor, type Tool } from './store';
import { useArtworkThumbs } from './useArtworkThumbs';

interface View {
  scale: number;
  tx: number;
  ty: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx0: number; ty0: number }
  | { kind: 'room'; i0: number; j0: number; i1: number; j1: number; mode: 'add' | 'remove' }
  | { kind: 'wall'; dir: 'h' | 'v'; line: number; from: number; to: number; mode: 'add' | 'remove' }
  | { kind: 'moveProp'; id: string; ox: number; oz: number }
  | { kind: 'moveWallItem'; id: string }
  | { kind: 'moveSpawn' }
  | { kind: 'spawnDir' };

const ACCENT = '#ff5a1f';
const DEG = 180 / Math.PI;

export function PlanCanvas() {
  const doc = useEditor((s) => s.doc)!;
  const floorIndex = useEditor((s) => s.floorIndex);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const roomMode = useEditor((s) => s.roomMode);
  const propType = useEditor((s) => s.propType);
  const propRotation = useEditor((s) => s.propRotation);
  const pendingArtworkId = useEditor((s) => s.pendingArtworkId);
  const floor = doc.floors[floorIndex];
  const thumbs = useArtworkThumbs(doc.artworks);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ scale: 30, tx: 40, ty: 40 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceHeld = useRef(false);
  const [dropFace, setDropFace] = useState<{ x: number; z: number } | null>(null);

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ── 화면 맞춤 ─────────────────────────────────────────
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !floor) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const pad = 56;
    const ww = floor.cols * CELL;
    const wh = floor.rows * CELL;
    const scale = Math.max(6, Math.min(120, Math.min((W - pad * 2) / ww, (H - pad * 2) / wh)));
    setView({ scale, tx: (W - ww * scale) / 2, ty: (H - wh * scale) / 2 });
  }, [floor?.cols, floor?.rows, floor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // 휠 줌 (passive: false 필요)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const v = viewRef.current;
      if (e.ctrlKey || !e.shiftKey) {
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const scale = Math.max(6, Math.min(160, v.scale * k));
        const f = scale / v.scale;
        setView({ scale, tx: mx - (mx - v.tx) * f, ty: my - (my - v.ty) * f });
      } else {
        setView({ ...v, tx: v.tx - e.deltaY });
      }
    };
    svg.addEventListener('wheel', on, { passive: false });
    return () => svg.removeEventListener('wheel', on);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceHeld.current = true;
        if (e.target === document.body) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.tx) / v.scale, z: (clientY - r.top - v.ty) / v.scale };
  };

  const edges = useMemo(() => (floor ? computeWallEdges(floor) : []), [floor]);

  if (!floor) return null;

  // ── 포인터 ───────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useEditor.getState();
    const p = toWorld(e.clientX, e.clientY);
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const hitKind = target?.dataset.kind;
    const hitId = target?.dataset.id;
    svgRef.current!.setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceHeld.current || (e.button === 2 && tool !== 'room')) {
      setDragBoth({ kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: view.tx, ty0: view.ty });
      return;
    }
    if (e.button !== 0 && !(e.button === 2 && tool === 'room')) return;

    switch (tool) {
      case 'select': {
        if (hitKind === 'wallItem' && hitId) {
          st.select({ kind: 'wallItem', id: hitId });
          st.beginTxn();
          setDragBoth({ kind: 'moveWallItem', id: hitId });
        } else if (hitKind === 'prop' && hitId) {
          const pr = floor.props.find((x) => x.id === hitId)!;
          st.select({ kind: 'prop', id: hitId });
          st.beginTxn();
          setDragBoth({ kind: 'moveProp', id: hitId, ox: p.x - pr.x, oz: p.z - pr.z });
        } else if (hitKind === 'spawn') {
          st.select({ kind: 'spawn' });
          st.beginTxn();
          setDragBoth({ kind: 'moveSpawn' });
        } else {
          st.select(null);
          setDragBoth({ kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: view.tx, ty0: view.ty });
        }
        break;
      }
      case 'room': {
        const [i, j] = cellAt(p.x, p.z);
        const mode = e.button === 2 || e.altKey ? 'remove' : roomMode;
        setDragBoth({ kind: 'room', i0: i, j0: j, i1: i, j1: j, mode });
        break;
      }
      case 'wall': {
        const ne = nearestEdge(floor, p.x, p.z);
        if (!ne || ne.dist > CELL * 0.35) return;
        const e0 = parseEdge(ne.key);
        const has = floor.partitions.includes(ne.key);
        const along = e0.dir === 'h' ? e0.i : e0.j;
        setDragBoth({ kind: 'wall', dir: e0.dir, line: e0.dir === 'h' ? e0.j : e0.i, from: along, to: along, mode: has ? 'remove' : 'add' });
        break;
      }
      case 'frame':
      case 'elevator': {
        if (hitKind === 'wallItem' && hitId) {
          st.select({ kind: 'wallItem', id: hitId });
          return;
        }
        const face = nearestFace(floor, p.x, p.z);
        if (!face) return;
        const ex = existingItemOnFace(floor, face);
        if (ex) {
          st.select({ kind: 'wallItem', id: ex.id });
          return;
        }
        if (tool === 'frame') placeFrame(face, pendingArtworkId);
        else placeElevator(face);
        break;
      }
      case 'prop': {
        placeProp(snap(p.x, 0.25), snap(p.z, 0.25));
        break;
      }
      case 'spawn': {
        const x = snap(p.x, 0.25);
        const z = snap(p.z, 0.25);
        const [i, j] = cellAt(x, z);
        if (!isFilled(floor, i, j)) return;
        st.beginTxn();
        st.mutateFloor((f) => {
          f.spawn = { x, z, yaw: f.spawn?.yaw ?? 0 };
        });
        st.select({ kind: 'spawn' });
        setDragBoth({ kind: 'spawnDir' });
        break;
      }
      case 'erase': {
        if ((hitKind === 'wallItem' || hitKind === 'prop') && hitId) {
          deleteItem(hitKind, hitId);
          return;
        }
        if (hitKind === 'spawn') {
          st.mutateFloor((f) => void (f.spawn = null));
          return;
        }
        const ne = nearestEdge(floor, p.x, p.z);
        if (ne && ne.dist < CELL * 0.3 && floor.partitions.includes(ne.key)) {
          let removed: [number, number] = [0, 0];
          st.mutateFloor((f) => {
            f.partitions = f.partitions.filter((k) => k !== ne.key);
            removed = cleanupFloor(f);
          });
          reportCleanup(removed);
        }
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    setHover(p);
    const d = dragRef.current;
    if (!d) return;
    const st = useEditor.getState();
    switch (d.kind) {
      case 'pan':
        setView((v) => ({ ...v, tx: d.tx0 + (e.clientX - d.sx), ty: d.ty0 + (e.clientY - d.sy) }));
        break;
      case 'room': {
        const [i, j] = cellAt(p.x, p.z);
        const ci = Math.max(0, Math.min(floor.cols - 1, i));
        const cj = Math.max(0, Math.min(floor.rows - 1, j));
        if (ci !== d.i1 || cj !== d.j1) setDragBoth({ ...d, i1: ci, j1: cj });
        break;
      }
      case 'wall': {
        const g = d.dir === 'h' ? p.x / CELL : p.z / CELL;
        const max = d.dir === 'h' ? floor.cols - 1 : floor.rows - 1;
        const to = Math.max(0, Math.min(max, Math.floor(g)));
        if (to !== d.to) setDragBoth({ ...d, to });
        break;
      }
      case 'moveProp': {
        const step = e.shiftKey ? 0.05 : 0.25;
        const x = snap(p.x - d.ox, step);
        const z = snap(p.z - d.oz, step);
        const [i, j] = cellAt(x, z);
        if (!isFilled(floor, i, j)) return;
        st.mutateFloor((f) => {
          const pr = f.props.find((q) => q.id === d.id);
          if (pr) {
            pr.x = x;
            pr.z = z;
          }
        });
        break;
      }
      case 'moveWallItem': {
        const face = nearestFace(floor, p.x, p.z, CELL * 1.2);
        if (!face) return;
        const lim = CELL / 2;
        let offset = Math.max(-lim, Math.min(lim, snap(face.along, e.shiftKey ? 0.02 : 0.1)));
        if (!e.shiftKey && Math.abs(offset) < 0.15) offset = 0;
        st.mutateFloor((f) => {
          const it = f.wallItems.find((q) => q.id === d.id);
          if (it) {
            it.edge = face.edge;
            it.side = face.side;
            it.offset = it.kind === 'elevator' ? 0 : offset;
          }
        });
        break;
      }
      case 'moveSpawn': {
        const x = snap(p.x, 0.25);
        const z = snap(p.z, 0.25);
        const [i, j] = cellAt(x, z);
        if (!isFilled(floor, i, j)) return;
        st.mutateFloor((f) => {
          if (f.spawn) {
            f.spawn.x = x;
            f.spawn.z = z;
          }
        });
        break;
      }
      case 'spawnDir': {
        const sp = floor.spawn;
        if (!sp) return;
        const dx = p.x - sp.x;
        const dz = p.z - sp.z;
        if (Math.hypot(dx, dz) < 0.4) return;
        const raw = Math.atan2(-dx, -dz);
        const yaw = e.shiftKey ? raw : snap(raw, Math.PI / 4);
        st.mutateFloor((f) => {
          if (f.spawn) f.spawn.yaw = yaw;
        });
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    setDragBoth(null);
    if (!d) return;
    const st = useEditor.getState();
    if (d.kind === 'room') {
      let removed: [number, number] = [0, 0];
      st.mutateFloor((f) => {
        fillRect(f as Floor, d.i0, d.j0, d.i1, d.j1, d.mode === 'add' ? 1 : 0);
        removed = cleanupFloor(f);
      });
      reportCleanup(removed);
    } else if (d.kind === 'wall') {
      const keys = wallDragKeys(d);
      let removed: [number, number] = [0, 0];
      st.mutateFloor((f) => {
        const set = new Set(f.partitions);
        for (const k of keys) {
          if (d.mode === 'add') set.add(k);
          else set.delete(k);
        }
        f.partitions = [...set];
        removed = cleanupFloor(f);
      });
      reportCleanup(removed);
    } else if (d.kind === 'moveProp' || d.kind === 'moveWallItem' || d.kind === 'moveSpawn' || d.kind === 'spawnDir') {
      st.endTxn();
    }
  };

  // ── 라이브러리에서 드래그&드롭 ───────────────────────
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-artwork')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropFace(toWorld(e.clientX, e.clientY));
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-artwork');
    setDropFace(null);
    if (!id) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    const target = (e.target as Element).closest('[data-kind="wallItem"]') as HTMLElement | null;
    const st = useEditor.getState();
    if (target?.dataset.id) {
      const it = floor.wallItems.find((w) => w.id === target.dataset.id);
      if (it?.kind === 'frame') {
        assignArtwork(it.id, id);
        st.select({ kind: 'wallItem', id: it.id });
        return;
      }
    }
    const face = nearestFace(floor, p.x, p.z);
    if (!face) return;
    const ex = existingItemOnFace(floor, face);
    if (ex && ex.kind === 'frame') {
      assignArtwork(ex.id, id);
      st.select({ kind: 'wallItem', id: ex.id });
    } else if (!ex) placeFrame(face, id);
  };

  const ghost = drag ? null : renderGhost(tool, floor, hover, { roomMode, propType, propRotation });

  return (
    <div className={`plan plan--${tool}`} ref={wrapRef}>
      <svg
        ref={svgRef}
        className="plan__svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !dragRef.current && setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={onDragOver}
        onDragLeave={() => setDropFace(null)}
        onDrop={onDrop}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <GridLayer floor={floor} />
          <WallLayer edges={edges} partitions={floor.partitions} />
          <ItemsLayer floor={floor} thumbs={thumbs} artworks={doc.artworks} selectionId={selection && 'id' in selection ? selection.id : selection?.kind === 'spawn' ? '__spawn' : null} />
          {ghost}
          {drag?.kind === 'room' && <RoomDragPreview d={drag} />}
          {drag?.kind === 'wall' && <WallDragPreview d={drag} floor={floor} />}
          {dropFace && <FaceGhost floor={floor} x={dropFace.x} z={dropFace.z} width={1.1} color={ACCENT} />}
        </g>
      </svg>
      <div className="plan__zoom">
        <button onClick={() => setView((v) => zoomAtCenter(v, 1.25, wrapRef.current))} aria-label="확대">
          +
        </button>
        <button onClick={() => setView((v) => zoomAtCenter(v, 0.8, wrapRef.current))} aria-label="축소">
          −
        </button>
        <button onClick={fit} aria-label="화면에 맞추기" className="plan__fit">
          맞춤
        </button>
      </div>
      {!floor.cells.includes(1) && !drag && (
        <div className="plan__onboard">
          <strong>빈 부지예요</strong>
          <span>
            {tool === 'room' ? '격자 위를 드래그해서 방을 그려 보세요. 벽은 자동으로 세워져요.' : '왼쪽의 공간 도구(2)를 고른 뒤 격자 위를 드래그해서 방을 그려 보세요.'}
          </span>
          {tool !== 'room' && (
            <button className="btn btn--primary btn--sm" onClick={() => useEditor.getState().setTool('room')}>
              공간 도구 선택
            </button>
          )}
        </div>
      )}
      {hover && (
        <div className="plan__coords">
          {hover.x.toFixed(1)}m, {hover.z.toFixed(1)}m
        </div>
      )}
    </div>
  );
}

function zoomAtCenter(v: View, k: number, el: HTMLElement | null): View {
  const W = el?.clientWidth ?? 800;
  const H = el?.clientHeight ?? 600;
  const scale = Math.max(6, Math.min(160, v.scale * k));
  const f = scale / v.scale;
  return { scale, tx: W / 2 - (W / 2 - v.tx) * f, ty: H / 2 - (H / 2 - v.ty) * f };
}

function wallDragKeys(d: Extract<Drag, { kind: 'wall' }>) {
  const keys: string[] = [];
  for (let k = Math.min(d.from, d.to); k <= Math.max(d.from, d.to); k++) keys.push(d.dir === 'h' ? edgeKey('h', k, d.line) : edgeKey('v', d.line, k));
  return keys;
}

// ── 레이어 ─────────────────────────────────────────────

const GridLayer = memo(function GridLayer({ floor }: { floor: Floor }) {
  const W = floor.cols * CELL;
  const H = floor.rows * CELL;
  const filled: React.ReactNode[] = [];
  for (let j = 0; j < floor.rows; j++)
    for (let i = 0; i < floor.cols; i++)
      if (floor.cells[j * floor.cols + i]) filled.push(<rect key={`${i}:${j}`} x={i * CELL} y={j * CELL} width={CELL + 0.01} height={CELL + 0.01} className="plan-cell" />);
  const lines: React.ReactNode[] = [];
  for (let i = 0; i <= floor.cols; i++) lines.push(<line key={`v${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={H} />);
  for (let j = 0; j <= floor.rows; j++) lines.push(<line key={`h${j}`} x1={0} y1={j * CELL} x2={W} y2={j * CELL} />);
  const labels: React.ReactNode[] = [];
  for (let i = 0; i <= floor.cols; i += floor.cols > 20 ? 2 : 1)
    labels.push(
      <text key={`lx${i}`} x={i * CELL} y={-0.45} className="plan-ruler" textAnchor="middle">
        {i * CELL}
      </text>,
    );
  for (let j = 0; j <= floor.rows; j += floor.rows > 20 ? 2 : 1)
    labels.push(
      <text key={`ly${j}`} x={-0.45} y={j * CELL + 0.15} className="plan-ruler" textAnchor="end">
        {j * CELL}
      </text>,
    );
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} className="plan-site" />
      <g className="plan-grid">{lines}</g>
      {filled}
      {labels}
      <text x={W + 0.4} y={-0.45} className="plan-ruler">
        m
      </text>
    </g>
  );
});

const WallLayer = memo(function WallLayer({ edges, partitions }: { edges: WallEdge[]; partitions: string[] }) {
  void partitions;
  const T = WALL_THICKNESS;
  return (
    <g>
      {edges.map((e) =>
        e.dir === 'h' ? (
          <rect key={e.key} x={e.i * CELL - T / 2} y={e.j * CELL - T / 2} width={CELL + T} height={T} className={e.boundary ? 'plan-wall' : 'plan-wall plan-wall--partition'} />
        ) : (
          <rect key={e.key} x={e.i * CELL - T / 2} y={e.j * CELL - T / 2} width={T} height={CELL + T} className={e.boundary ? 'plan-wall' : 'plan-wall plan-wall--partition'} />
        ),
      )}
    </g>
  );
});

const ItemsLayer = memo(function ItemsLayer({
  floor,
  thumbs,
  artworks,
  selectionId,
}: {
  floor: Floor;
  thumbs: Record<string, string>;
  artworks: { id: string; width: number; height: number }[];
  selectionId: string | null;
}) {
  const artMap = new Map(artworks.map((a) => [a.id, a]));
  return (
    <g>
      {floor.props.map((p) => (
        <PropShape key={p.id} prop={p} selected={selectionId === p.id} />
      ))}
      {floor.wallItems.map((w) => (
        <WallItemShape key={w.id} item={w} selected={selectionId === w.id} thumb={w.kind === 'frame' && w.artworkId ? thumbs[w.artworkId] : undefined} art={w.kind === 'frame' && w.artworkId ? artMap.get(w.artworkId) : undefined} />
      ))}
      {floor.spawn && <SpawnShape spawn={floor.spawn} selected={selectionId === '__spawn'} />}
    </g>
  );
});

function frameOuterWidth(it: FrameItem, art?: { width: number; height: number }) {
  const aspect = art ? art.width / Math.max(1, art.height) : 4 / 3;
  return frameDims(it.frameStyle, it.width, it.width / aspect, it.mat).outerW;
}

function WallItemShape({ item, selected, thumb, art }: { item: WallItem; selected: boolean; thumb?: string; art?: { width: number; height: number } }) {
  const p = wallItemPose(item);
  const angle = Math.atan2(p.rz, p.rx) * DEG;
  if (item.kind === 'elevator') {
    const w = ELEVATOR_WIDTH;
    return (
      <g transform={`translate(${p.x} ${p.z}) rotate(${angle})`} data-kind="wallItem" data-id={item.id} className={`plan-item plan-elevator ${selected ? 'is-selected' : ''}`}>
        <rect x={-w / 2} y={0} width={w} height={0.9} rx={0.06} className="plan-elevator__body" />
        <path d="M -0.25 0.62 L 0 0.3 L 0.25 0.62 M -0.25 0.72 L 0 1.04 L 0.25 0.72" transform="translate(0 -0.22)" className="plan-elevator__icon" />
        <rect x={-w / 2} y={0} width={w} height={0.9} className="plan-hit" />
      </g>
    );
  }
  const w = frameOuterWidth(item, art);
  const empty = !item.artworkId;
  return (
    <g transform={`translate(${p.x} ${p.z}) rotate(${angle})`} data-kind="wallItem" data-id={item.id} className={`plan-item plan-frame ${selected ? 'is-selected' : ''} ${empty ? 'is-empty' : ''}`}>
      <rect x={-w / 2} y={0} width={w} height={0.14} className="plan-frame__bar" />
      <g transform={`translate(0 0.62) rotate(${-angle})`}>
        {thumb ? (
          <>
            <rect x={-0.36} y={-0.36} width={0.72} height={0.72} className="plan-frame__thumb-bg" />
            <image href={thumb} x={-0.32} y={-0.32} width={0.64} height={0.64} preserveAspectRatio="xMidYMid slice" />
          </>
        ) : (
          <g className="plan-frame__empty">
            <rect x={-0.3} y={-0.3} width={0.6} height={0.6} rx={0.05} />
            <path d="M -0.12 0 H 0.12 M 0 -0.12 V 0.12" />
          </g>
        )}
      </g>
      <rect x={-Math.max(w, 0.8) / 2} y={-0.1} width={Math.max(w, 0.8)} height={1.1} className="plan-hit" />
    </g>
  );
}

function PropShape({ prop, selected }: { prop: Prop; selected: boolean }) {
  const s = PROP_SPEC[prop.type];
  return (
    <g transform={`translate(${prop.x} ${prop.z}) rotate(${-prop.rotation * DEG})`} data-kind="prop" data-id={prop.id} className={`plan-item plan-prop plan-prop--${prop.type} ${selected ? 'is-selected' : ''}`}>
      {prop.type === 'plant' ? (
        <>
          <circle r={s.w / 2} className="plan-prop__body" />
          <circle r={s.w / 4} className="plan-prop__detail" />
        </>
      ) : prop.type === 'pedestal' ? (
        <>
          <rect x={-s.w / 2} y={-s.d / 2} width={s.w} height={s.d} className="plan-prop__body" />
          <circle r={0.12} className="plan-prop__detail" />
        </>
      ) : (
        <>
          <rect x={-s.w / 2} y={-s.d / 2} width={s.w} height={s.d} rx={0.05} className="plan-prop__body" />
          <line x1={-s.w / 2 + 0.15} y1={0} x2={s.w / 2 - 0.15} y2={0} className="plan-prop__detail-line" />
        </>
      )}
      <rect x={-s.w / 2 - 0.1} y={-s.d / 2 - 0.1} width={s.w + 0.2} height={s.d + 0.2} className="plan-hit" />
    </g>
  );
}

function SpawnShape({ spawn, selected, ghost }: { spawn: Spawn; selected?: boolean; ghost?: boolean }) {
  // yaw 0 = 위쪽(-z). SVG 회전은 시계방향이므로 -yaw
  return (
    <g transform={`translate(${spawn.x} ${spawn.z}) rotate(${-spawn.yaw * DEG})`} data-kind={ghost ? undefined : 'spawn'} className={`plan-item plan-spawn ${selected ? 'is-selected' : ''} ${ghost ? 'is-ghost' : ''}`}>
      <path d="M 0 -0.95 L 0.5 -0.1 L -0.5 -0.1 Z" className="plan-spawn__dir" />
      <circle r={0.34} className="plan-spawn__body" />
      <circle r={0.12} className="plan-spawn__dot" />
      <circle r={0.7} className="plan-hit" />
    </g>
  );
}

function FaceGhost({ floor, x, z, width, color }: { floor: Floor; x: number; z: number; width: number; color: string }) {
  const face = nearestFace(floor, x, z);
  if (!face) return null;
  const p = wallItemPose({ ...face, offset: 0, id: '', kind: 'elevator' });
  const angle = Math.atan2(p.rz, p.rx) * DEG;
  return (
    <g transform={`translate(${p.x} ${p.z}) rotate(${angle})`} className="plan-ghost" pointerEvents="none">
      <rect x={-width / 2} y={0} width={width} height={0.16} fill={color} opacity={0.75} />
      <rect x={-CELL / 2} y={0} width={CELL} height={0.6} fill={color} opacity={0.08} />
    </g>
  );
}

function renderGhost(
  tool: Tool,
  floor: Floor,
  hover: { x: number; z: number } | null,
  o: { roomMode: 'add' | 'remove'; propType: Prop['type']; propRotation: number },
) {
  if (!hover) return null;
  switch (tool) {
    case 'room': {
      const [i, j] = cellAt(hover.x, hover.z);
      if (i < 0 || j < 0 || i >= floor.cols || j >= floor.rows) return null;
      return <rect x={i * CELL} y={j * CELL} width={CELL} height={CELL} className={`plan-ghost-cell plan-ghost-cell--${o.roomMode}`} pointerEvents="none" />;
    }
    case 'wall': {
      const ne = nearestEdge(floor, hover.x, hover.z);
      if (!ne || ne.dist > CELL * 0.35) return null;
      const e = parseEdge(ne.key);
      const has = floor.partitions.includes(ne.key);
      const T = WALL_THICKNESS;
      return e.dir === 'h' ? (
        <rect x={e.i * CELL} y={e.j * CELL - T / 2} width={CELL} height={T} className={`plan-ghost-wall ${has ? 'is-remove' : ''}`} pointerEvents="none" />
      ) : (
        <rect x={e.i * CELL - T / 2} y={e.j * CELL} width={T} height={CELL} className={`plan-ghost-wall ${has ? 'is-remove' : ''}`} pointerEvents="none" />
      );
    }
    case 'frame': {
      const face = nearestFace(floor, hover.x, hover.z);
      if (face && existingItemOnFace(floor, face)) return null;
      return <FaceGhost floor={floor} x={hover.x} z={hover.z} width={1.1} color={ACCENT} />;
    }
    case 'elevator':
      return <FaceGhost floor={floor} x={hover.x} z={hover.z} width={ELEVATOR_WIDTH} color="#4d6bd8" />;
    case 'prop': {
      const x = snap(hover.x, 0.25);
      const z = snap(hover.z, 0.25);
      const [i, j] = cellAt(x, z);
      if (!isFilled(floor, i, j)) return null;
      return (
        <g opacity={0.55} pointerEvents="none">
          <PropShape prop={{ id: '', type: o.propType, x, z, rotation: o.propRotation }} selected={false} />
        </g>
      );
    }
    case 'spawn': {
      const x = snap(hover.x, 0.25);
      const z = snap(hover.z, 0.25);
      const [i, j] = cellAt(x, z);
      if (!isFilled(floor, i, j)) return null;
      return (
        <g opacity={0.5} pointerEvents="none">
          <SpawnShape spawn={{ x, z, yaw: floor.spawn?.yaw ?? 0 }} ghost />
        </g>
      );
    }
    default:
      return null;
  }
}

function RoomDragPreview({ d }: { d: Extract<Drag, { kind: 'room' }> }) {
  const i0 = Math.min(d.i0, d.i1);
  const j0 = Math.min(d.j0, d.j1);
  const w = (Math.abs(d.i1 - d.i0) + 1) * CELL;
  const h = (Math.abs(d.j1 - d.j0) + 1) * CELL;
  return (
    <g pointerEvents="none">
      <rect x={i0 * CELL} y={j0 * CELL} width={w} height={h} className={`plan-ghost-cell plan-ghost-cell--${d.mode}`} />
      <text x={i0 * CELL + w / 2} y={j0 * CELL + h / 2} className="plan-dim" textAnchor="middle" dominantBaseline="middle">
        {w} × {h} m
      </text>
    </g>
  );
}

function WallDragPreview({ d, floor }: { d: Extract<Drag, { kind: 'wall' }>; floor: Floor }) {
  void floor;
  const T = WALL_THICKNESS;
  const a = Math.min(d.from, d.to);
  const b = Math.max(d.from, d.to) + 1;
  return d.dir === 'h' ? (
    <rect x={a * CELL} y={d.line * CELL - T / 2} width={(b - a) * CELL} height={T} className={`plan-ghost-wall ${d.mode === 'remove' ? 'is-remove' : ''}`} pointerEvents="none" />
  ) : (
    <rect x={d.line * CELL - T / 2} y={a * CELL} width={T} height={(b - a) * CELL} className={`plan-ghost-wall ${d.mode === 'remove' ? 'is-remove' : ''}`} pointerEvents="none" />
  );
}
