import { ART_HEIGHT_DEFAULT, CELL, DEFAULT_WALL_HEIGHT, FRAME_DEFAULTS, TEXT_DEFAULTS } from './constants';
import { edgeKey, faceId, isFaceValid, orderedFaces, parseEdge } from './grid';
import { uid } from './ids';
import type { WallFace } from './grid';
import { SCHEMA_VERSION, type Artwork, type Exhibition, type Floor, type FrameItem, type ElevatorItem, type Prop, type PropType, type TextItem } from './types';

export function createFloor(name: string, cols = 12, rows = 10): Floor {
  return {
    id: uid('fl'),
    name,
    cols,
    rows,
    wallHeight: DEFAULT_WALL_HEIGHT,
    cells: new Array(cols * rows).fill(0),
    partitions: [],
    wallItems: [],
    props: [],
    spawn: null,
    tourOrder: [],
  };
}

export function fillRect(floor: Floor, i0: number, j0: number, i1: number, j1: number, value: 0 | 1 = 1) {
  for (let j = Math.max(0, Math.min(j0, j1)); j <= Math.min(floor.rows - 1, Math.max(j0, j1)); j++)
    for (let i = Math.max(0, Math.min(i0, i1)); i <= Math.min(floor.cols - 1, Math.max(i0, i1)); i++) floor.cells[j * floor.cols + i] = value;
}

/** 가로/세로 일직선 칸막이 추가. 'h' 는 z=line 위 i0..i1, 'v' 는 x=line 위 j0..j1 */
export function addPartitionLine(floor: Floor, dir: 'h' | 'v', line: number, from: number, to: number) {
  const set = new Set(floor.partitions);
  for (let k = Math.min(from, to); k <= Math.max(from, to); k++) set.add(dir === 'h' ? edgeKey('h', k, line) : edgeKey('v', line, k));
  floor.partitions = [...set];
}

export function newFrame(face: WallFace, artworkId: string | null = null, offset = 0): FrameItem {
  return { id: uid('fr'), kind: 'frame', edge: face.edge, side: face.side, offset, artworkId, ...FRAME_DEFAULTS };
}

export function newText(face: WallFace, offset = 0): TextItem {
  return { id: uid('tx'), kind: 'text', edge: face.edge, side: face.side, offset, title: '', body: '', ...TEXT_DEFAULTS };
}

export function newProp(type: PropType, x: number, z: number, rotation = 0, artworkId: string | null = null): Prop {
  return { id: uid('pr'), type, x, z, rotation, artworkId: type === 'pedestal' ? artworkId : null, artHeight: ART_HEIGHT_DEFAULT };
}

export function newElevator(face: WallFace): ElevatorItem {
  return { id: uid('el'), kind: 'elevator', edge: face.edge, side: face.side, offset: 0 };
}

export function blankExhibition(title: string): Exhibition {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('ex'),
    title,
    subtitle: '',
    description: '',
    curator: '',
    status: 'draft',
    coverArtworkId: null,
    theme: { wallColor: '#f4f2ee', floorStyle: 'oak', lighting: 'bright' },
    audio: { bgmBlobId: null, bgmVolume: 0.35, tts: true },
    artworks: [],
    floors: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  build: () => Floor[];
}

const center = (n: number) => Math.floor(n / 2);

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'small',
    name: '작은 갤러리',
    description: '12×10m 단일 전시실. 처음 시작하기 좋아요.',
    build: () => {
      const f = createFloor('1F', 8, 7);
      fillRect(f, 1, 1, 6, 5);
      f.props.push(newProp('bench', 4 * CELL, 3.5 * CELL, 0));
      f.spawn = { x: 4 * CELL, z: 5.6 * CELL, yaw: 0 };
      return [f];
    },
  },
  {
    id: 'corridor',
    name: '회랑형 갤러리',
    description: '칸막이로 S자 동선을 만든 20×12m 전시실.',
    build: () => {
      const f = createFloor('1F', 12, 8);
      fillRect(f, 1, 1, 10, 6);
      addPartitionLine(f, 'v', 4, 1, 4);
      addPartitionLine(f, 'v', 8, 3, 6);
      f.props.push(newProp('plant', 1.4 * CELL, 1.4 * CELL, 0));
      f.props.push(newProp('bench', 6 * CELL, 4 * CELL, Math.PI / 2));
      f.spawn = { x: 2.5 * CELL, z: 6.5 * CELL, yaw: 0 };
      return [f];
    },
  },
  {
    id: 'ushape',
    name: 'U자형 전시관',
    description: '세 개의 전시 공간이 이어지는 U자 동선.',
    build: () => {
      const f = createFloor('1F', 12, 10);
      fillRect(f, 1, 1, 3, 8);
      fillRect(f, 4, 1, 7, 3);
      fillRect(f, 8, 1, 10, 8);
      addPartitionLine(f, 'v', 4, 1, 1);
      addPartitionLine(f, 'v', 8, 1, 1);
      f.props.push(newProp('pedestal', 6 * CELL, 2 * CELL, 0));
      f.props.push(newProp('bench', 2.5 * CELL, 5 * CELL, Math.PI / 2));
      f.props.push(newProp('bench', 9.5 * CELL, 5 * CELL, Math.PI / 2));
      f.spawn = { x: 2.5 * CELL, z: 8.4 * CELL, yaw: 0 };
      return [f];
    },
  },
  {
    id: 'twofloor',
    name: '2층 전시관',
    description: '엘리베이터로 연결된 두 개 층. 2층엔 가운데 독립벽이 있어요.',
    build: () => {
      const f1 = createFloor('1F', 10, 8);
      fillRect(f1, 1, 1, 8, 6);
      f1.wallItems.push(newElevator({ edge: edgeKey('h', center(10), 1), side: 1 }));
      f1.props.push(newProp('bench', 5 * CELL, 4.2 * CELL, 0));
      f1.spawn = { x: 5 * CELL, z: 2.5 * CELL, yaw: Math.PI };
      const f2 = createFloor('2F', 10, 8);
      fillRect(f2, 1, 1, 8, 6);
      f2.wallItems.push(newElevator({ edge: edgeKey('h', center(10), 1), side: 1 }));
      addPartitionLine(f2, 'h', 4, 3, 6);
      f2.props.push(newProp('plant', 1.4 * CELL, 6.6 * CELL, 0));
      f2.props.push(newProp('plant', 8.6 * CELL, 6.6 * CELL, 0));
      return [f1, f2];
    },
  },
  {
    id: 'blank',
    name: '빈 도면',
    description: '24×20m 빈 부지에서 직접 공간을 그려요.',
    build: () => [createFloor('1F', 12, 10)],
  },
];

export function createExhibitionFromTemplate(templateId: string, title: string): Exhibition {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const ex = blankExhibition(title);
  ex.floors = t.build();
  return ex;
}

/**
 * 빈 벽면에 작품을 동선 순서대로 자동으로 건다.
 * 벽이 남으면 전시실 전체에 고르게 퍼뜨리고, 엘리베이터 바로 옆 구간은 비워 둔다.
 * @returns 실제로 걸린 작품 수
 */
export function autoHang(floor: Floor, artworks: Artwork[]): number {
  const parts = new Set(floor.partitions);
  const occupied = new Set<string>();
  const nearElevator = new Set<string>();
  for (const it of floor.wallItems) {
    occupied.add(faceId(it));
    if (it.kind === 'elevator') {
      const e = parseEdge(it.edge);
      for (const d of [-1, 1]) {
        const n = e.dir === 'h' ? edgeKey('h', e.i + d, e.j) : edgeKey('v', e.i, e.j + d);
        nearElevator.add(faceId({ edge: n, side: it.side }));
      }
    }
  }
  const free = orderedFaces(floor).filter((f) => isFaceValid(floor, f, parts) && !occupied.has(faceId(f)));
  const preferred = free.filter((f) => !nearElevator.has(faceId(f)));
  const pool = preferred.length >= artworks.length ? preferred : free;
  const n = Math.min(artworks.length, pool.length);
  for (let k = 0; k < n; k++) {
    // 남는 벽이 있으면 간격을 두고 고르게 선택
    const f = pool[Math.floor((k * pool.length) / n)];
    const art = artworks[k];
    const frame = newFrame(f, art.id);
    const aspect = art.width / Math.max(1, art.height);
    frame.width = aspect >= 1.3 ? 1.35 : aspect <= 0.8 ? 0.85 : 1.05;
    floor.wallItems.push(frame);
  }
  return n;
}
