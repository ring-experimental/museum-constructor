import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { CELL } from '../core/constants';
import { cellAt, isFaceValid, isFilled } from '../core/grid';
import type { Exhibition, Floor, PropType } from '../core/types';

export type Tool = 'select' | 'room' | 'wall' | 'frame' | 'text' | 'elevator' | 'prop' | 'spawn' | 'erase';

export type Selection =
  | { kind: 'wallItem'; id: string }
  | { kind: 'prop'; id: string }
  | { kind: 'spawn' }
  | { kind: 'artwork'; id: string }
  /** 여러 벽 항목·소품을 함께 선택 (Shift+클릭, Shift+드래그, Ctrl+A) */
  | { kind: 'multi'; ids: string[] };

export type InspectorTab = 'selection' | 'floor' | 'exhibition';
export type ViewLayout = '2d' | 'split' | '3d';

interface EditorState {
  doc: Exhibition | null;
  floorIndex: number;
  tool: Tool;
  roomMode: 'add' | 'remove';
  propType: PropType;
  propRotation: number;
  selection: Selection | null;
  pendingArtworkId: string | null;
  tab: InspectorTab;
  layout: ViewLayout;
  past: Exhibition[];
  future: Exhibition[];
  txn: boolean;
  /** 트랜잭션 시작 시점의 다시실행 목록 (변화가 없으면 복구) */
  txnFuture: Exhibition[];
  revision: number;

  load(doc: Exhibition): void;
  setTool(t: Tool): void;
  setFloorIndex(i: number): void;
  select(s: Selection | null, opts?: { keepTab?: boolean }): void;
  setTab(t: InspectorTab): void;
  setLayout(l: ViewLayout): void;
  setRoomMode(m: 'add' | 'remove'): void;
  setPropType(t: PropType): void;
  rotateProp(delta: number): void;
  setPending(id: string | null): void;
  mutate(recipe: (d: Draft<Exhibition>) => void, opts?: { record?: boolean }): void;
  mutateFloor(recipe: (f: Draft<Floor>, d: Draft<Exhibition>) => void, opts?: { record?: boolean }): void;
  beginTxn(): void;
  endTxn(): void;
  undo(): void;
  redo(): void;
}

const HISTORY_LIMIT = 120;

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  floorIndex: 0,
  tool: 'select',
  roomMode: 'add',
  propType: 'bench',
  propRotation: 0,
  selection: null,
  pendingArtworkId: null,
  tab: 'floor',
  layout: typeof window !== 'undefined' && window.innerWidth >= 1280 ? 'split' : '2d',
  past: [],
  future: [],
  txn: false,
  txnFuture: [],
  revision: 0,

  load(doc) {
    set({ doc, floorIndex: 0, selection: null, past: [], future: [], txn: false, pendingArtworkId: null, tab: 'floor', tool: 'select' });
  },
  setTool(tool) {
    set({ tool, ...(tool !== 'select' && tool !== 'frame' ? {} : {}) });
  },
  setFloorIndex(i) {
    set({ floorIndex: i, selection: null });
  },
  select(selection, opts) {
    set({ selection, ...(selection && !opts?.keepTab ? { tab: 'selection' as const } : {}) });
  },
  setTab(tab) {
    set({ tab });
  },
  setLayout(layout) {
    set({ layout });
  },
  setRoomMode(roomMode) {
    set({ roomMode });
  },
  setPropType(propType) {
    set({ propType, tool: 'prop' });
  },
  rotateProp(delta) {
    set({ propRotation: (get().propRotation + delta + Math.PI * 2) % (Math.PI * 2) });
  },
  setPending(pendingArtworkId) {
    set({ pendingArtworkId });
  },
  mutate(recipe, opts = {}) {
    const { doc, txn, past } = get();
    if (!doc) return;
    const next = produce(doc, (d) => {
      recipe(d);
      d.updatedAt = Date.now();
    });
    if (next === doc) return;
    const record = opts.record !== false && !txn;
    set({
      doc: next,
      revision: get().revision + 1,
      ...(record ? { past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [] } : {}),
    });
  },
  mutateFloor(recipe, opts) {
    const idx = get().floorIndex;
    get().mutate((d) => {
      const f = d.floors[idx];
      if (f) recipe(f, d);
    }, opts);
  },
  beginTxn() {
    const { doc, past, txn, future } = get();
    if (!doc || txn) return;
    set({ txn: true, past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [], txnFuture: future });
  },
  endTxn() {
    const { txn, past, doc, txnFuture } = get();
    if (!txn) return;
    // 트랜잭션 중 아무 변화가 없었다면 기록을 되돌린다
    if (past[past.length - 1] === doc) set({ txn: false, past: past.slice(0, -1), future: txnFuture, txnFuture: [] });
    else set({ txn: false, txnFuture: [] });
  },
  undo() {
    const { past, future, doc } = get();
    if (!past.length || !doc) return;
    const prev = past[past.length - 1];
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future],
      floorIndex: Math.min(get().floorIndex, prev.floors.length - 1),
      selection: null,
      revision: get().revision + 1,
    });
  },
  redo() {
    const { past, future, doc } = get();
    if (!future.length || !doc) return;
    const next = future[0];
    set({
      doc: next,
      past: [...past, doc],
      future: future.slice(1),
      floorIndex: Math.min(get().floorIndex, next.floors.length - 1),
      selection: null,
      revision: get().revision + 1,
    });
  },
}));

export function currentFloor(s: { doc: Exhibition | null; floorIndex: number }): Floor | null {
  return s.doc?.floors[s.floorIndex] ?? null;
}

/** 선택된 벽 항목·소품 id 목록 */
export function selectedIds(sel: Selection | null): string[] {
  if (!sel) return [];
  if (sel.kind === 'multi') return sel.ids;
  if (sel.kind === 'wallItem' || sel.kind === 'prop') return [sel.id];
  return [];
}

/** id 목록을 알맞은 선택 상태로 (0개 = 없음, 1개 = 단일, 여러 개 = multi) */
export function selectionFromIds(floor: Floor, ids: Iterable<string>): Selection | null {
  const wall = new Set(floor.wallItems.map((w) => w.id));
  const props = new Set(floor.props.map((p) => p.id));
  const list = [...new Set(ids)].filter((id) => wall.has(id) || props.has(id));
  if (!list.length) return null;
  if (list.length === 1) return wall.has(list[0]) ? { kind: 'wallItem', id: list[0] } : { kind: 'prop', id: list[0] };
  return { kind: 'multi', ids: list };
}

/** Shift+클릭: 선택에 넣거나 뺀다 */
export function toggleSelected(id: string) {
  const st = useEditor.getState();
  const floor = currentFloor(st);
  if (!floor) return;
  const cur = new Set(selectedIds(st.selection));
  if (cur.has(id)) cur.delete(id);
  else cur.add(id);
  st.select(selectionFromIds(floor, cur));
}

/**
 * 공간/벽 편집 후 더 이상 걸 수 없는 액자·소품을 정리한다.
 * @returns 제거된 [벽 항목 수, 소품 수]
 */
export function cleanupFloor(f: Draft<Floor>): [number, number] {
  const parts = new Set(f.partitions);
  const beforeItems = f.wallItems.length;
  const beforeProps = f.props.length;
  f.wallItems = f.wallItems.filter((w) => isFaceValid(f as Floor, w, parts));
  f.props = f.props.filter((p) => {
    const [i, j] = cellAt(p.x, p.z);
    return isFilled(f as Floor, i, j);
  });
  // 바닥이 아닌 곳의 칸막이 데이터 정리
  f.partitions = f.partitions.filter((k) => {
    const [dir, a, b] = k.split(':');
    const i = Number(a);
    const j = Number(b);
    return dir === 'h' ? isFilled(f as Floor, i, j - 1) && isFilled(f as Floor, i, j) : isFilled(f as Floor, i - 1, j) && isFilled(f as Floor, i, j);
  });
  if (f.spawn) {
    const [i, j] = cellAt(f.spawn.x, f.spawn.z);
    if (!isFilled(f as Floor, i, j)) f.spawn = null;
  }
  return [beforeItems - f.wallItems.length, beforeProps - f.props.length];
}

export const snap = (v: number, step: number) => Math.round(v / step) * step;
export const clampToGrid = (f: Floor, x: number, z: number): [number, number] => [
  Math.max(0, Math.min(f.cols * CELL, x)),
  Math.max(0, Math.min(f.rows * CELL, z)),
];
