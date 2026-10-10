/**
 * 전시 문서 스키마 마이그레이션 + 검증.
 *
 * 저장소(IndexedDB, 이후 서버)·가져오기 파일처럼 '바깥'에서 들어온 JSON 은 모두 여기를 거친다.
 *  - 옛 버전 문서를 현재 버전 구조로 올린다 (v1 → v2: 벽 글, 감상 순서 추가)
 *  - 타입이 틀리거나 범위를 벗어난 값은 안전한 값으로 고치고, 쓸 수 없는 항목은 버린다
 *  - 앱보다 새로운 버전이거나 전시 문서가 아니면 SchemaError
 * 서버가 생기면 같은 함수를 API 응답/요청 검증에 그대로 쓸 수 있다.
 */
import { ART_HEIGHT_DEFAULT, ART_HEIGHT_RANGE, CELL, FRAME_DEFAULTS, MAX_FLOORS, MAX_GRID, MIN_GRID, TEXT_DEFAULTS } from './constants';
import { edgeExistsInGrid, parseEdge } from './grid';
import { uid } from './ids';
import {
  SCHEMA_VERSION,
  type Artwork,
  type ArtworkMedia,
  type ArtworkSource,
  type Exhibition,
  type Floor,
  type FloorStyle,
  type FrameLight,
  type FrameStyle,
  type LightingPreset,
  type Prop,
  type PropType,
  type Spawn,
  type TextAlign,
  type TextColor,
  type TextSize,
  type WallItem,
  type WallSide,
} from './types';

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** 샘플 이미지 개수 (storage/artworkSource 와 맞춤) */
const SAMPLE_COUNT = 12;
const TAU = Math.PI * 2;

const FRAME_STYLES: FrameStyle[] = ['none', 'black', 'white', 'oak', 'brass'];
const FRAME_LIGHTS: FrameLight[] = ['normal', 'spot', 'off'];
const FLOOR_STYLES: FloorStyle[] = ['oak', 'concrete', 'marble', 'dark'];
const LIGHTINGS: LightingPreset[] = ['bright', 'warm', 'dramatic'];
const PROP_TYPES: PropType[] = ['bench', 'plant', 'pedestal'];
const TEXT_SIZES: TextSize[] = ['S', 'M', 'L'];
const TEXT_ALIGNS: TextAlign[] = ['left', 'center'];
const TEXT_COLORS: TextColor[] = ['auto', 'dark', 'light'];
const MEDIA: ArtworkMedia[] = ['image', 'video', 'model'];
/** 벽 액자에 걸 수 있는 작품 종류 */
export const WALL_MEDIA: ReadonlySet<ArtworkMedia> = new Set<ArtworkMedia>(['image', 'video']);

type MediaMap = Map<string, ArtworkMedia>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function str(v: unknown, max: number, fallback = ''): string {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return fallback;
  return v.slice(0, max);
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  return Math.round(num(v, min, max, fallback));
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 고유 id 보장 (형식이 이상하거나 중복이면 새로 발급) */
class IdPool {
  private used = new Set<string>();
  take(v: unknown, prefix: string): string {
    let id = typeof v === 'string' && ID_RE.test(v) ? v : '';
    if (!id || this.used.has(id)) id = uid(prefix);
    this.used.add(id);
    return id;
  }
}

function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

function time(v: unknown, fallback: number): number {
  return num(v, 0, 8.64e15, fallback);
}

function source(v: unknown): ArtworkSource | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'upload':
      return typeof v.blobId === 'string' && ID_RE.test(v.blobId) ? { kind: 'upload', blobId: v.blobId } : null;
    case 'url': {
      const url = str(v.url, 2048).trim();
      // 이미지로만 쓰이지만 javascript: 같은 주소는 애초에 받지 않는다
      return /^https?:\/\/\S+$/i.test(url) ? { kind: 'url', url } : null;
    }
    case 'sample': {
      const index = int(v.index, -1, 1e6, -1);
      return index >= 0 && index < SAMPLE_COUNT ? { kind: 'sample', index } : null;
    }
    default:
      return null;
  }
}

function artwork(v: unknown, ids: IdPool): Artwork | null {
  if (!isObj(v)) return null;
  const src = source(v.source);
  if (!src) return null;
  const media = oneOf(v.media, MEDIA, 'image');
  // 이미지가 아닌 작품은 업로드 파일로만 받는다
  if (media !== 'image' && src.kind !== 'upload') return null;
  return {
    id: ids.take(v.id, 'art'),
    media,
    source: src,
    width: int(v.width, 1, 20000, 1000),
    height: int(v.height, 1, 20000, 1000),
    title: str(v.title, 120),
    artist: str(v.artist, 120),
    year: str(v.year, 20),
    description: str(v.description, 4000),
    audioBlobId: typeof v.audioBlobId === 'string' && ID_RE.test(v.audioBlobId) ? v.audioBlobId : null,
  };
}

function edgeOk(floor: Floor, key: unknown): key is string {
  if (typeof key !== 'string' || !/^[hv]:\d{1,3}:\d{1,3}$/.test(key)) return false;
  return edgeExistsInGrid(floor, parseEdge(key));
}

function wallItem(v: unknown, floor: Floor, ids: IdPool, media: MediaMap): WallItem | null {
  if (!isObj(v) || !edgeOk(floor, v.edge)) return null;
  const base = {
    edge: v.edge as string,
    side: (v.side === -1 ? -1 : 1) as WallSide,
    offset: num(v.offset, -CELL / 2, CELL / 2, 0),
  };
  switch (v.kind) {
    case 'frame':
      return {
        id: ids.take(v.id, 'fr'),
        kind: 'frame',
        ...base,
        artworkId: typeof v.artworkId === 'string' && WALL_MEDIA.has(media.get(v.artworkId)!) ? v.artworkId : null,
        width: num(v.width, 0.3, 4, FRAME_DEFAULTS.width),
        elevation: num(v.elevation, 0.5, 3.2, FRAME_DEFAULTS.elevation),
        frameStyle: oneOf(v.frameStyle, FRAME_STYLES, FRAME_DEFAULTS.frameStyle),
        mat: num(v.mat, 0, 0.3, FRAME_DEFAULTS.mat),
        showCaption: typeof v.showCaption === 'boolean' ? v.showCaption : FRAME_DEFAULTS.showCaption,
        light: oneOf(v.light, FRAME_LIGHTS, FRAME_DEFAULTS.light),
      };
    case 'elevator':
      return { id: ids.take(v.id, 'el'), kind: 'elevator', ...base, offset: 0 };
    case 'text':
      return {
        id: ids.take(v.id, 'tx'),
        kind: 'text',
        ...base,
        title: str(v.title, 80),
        body: str(v.body, 2000),
        width: num(v.width, 0.6, 4, TEXT_DEFAULTS.width),
        elevation: num(v.elevation, 0.8, 3, TEXT_DEFAULTS.elevation),
        size: oneOf(v.size, TEXT_SIZES, TEXT_DEFAULTS.size),
        align: oneOf(v.align, TEXT_ALIGNS, TEXT_DEFAULTS.align),
        color: oneOf(v.color, TEXT_COLORS, TEXT_DEFAULTS.color),
      };
    default:
      return null;
  }
}

function prop(v: unknown, floor: Floor, ids: IdPool, media: MediaMap): Prop | null {
  if (!isObj(v)) return null;
  const x = num(v.x, -1, 1e6, NaN);
  const z = num(v.z, -1, 1e6, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const rot = num(v.rotation, -1e6, 1e6, 0);
  const type = oneOf(v.type, PROP_TYPES, 'bench');
  return {
    id: ids.take(v.id, 'pr'),
    type,
    x: Math.min(floor.cols * CELL, Math.max(0, x)),
    z: Math.min(floor.rows * CELL, Math.max(0, z)),
    rotation: ((rot % TAU) + TAU) % TAU,
    // 좌대 위에는 입체 작품만
    artworkId: type === 'pedestal' && typeof v.artworkId === 'string' && media.get(v.artworkId) === 'model' ? v.artworkId : null,
    artHeight: num(v.artHeight, ART_HEIGHT_RANGE.min, ART_HEIGHT_RANGE.max, ART_HEIGHT_DEFAULT),
  };
}

function spawn(v: unknown, floor: Floor): Spawn | null {
  if (!isObj(v)) return null;
  const x = num(v.x, 0, floor.cols * CELL, NaN);
  const z = num(v.z, 0, floor.rows * CELL, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z, yaw: num(v.yaw, -TAU, TAU, 0) };
}

function floorOf(v: unknown, k: number, ids: IdPool, media: MediaMap): Floor | null {
  if (!isObj(v)) return null;
  const cols = int(v.cols, MIN_GRID, MAX_GRID, 12);
  const rows = int(v.rows, MIN_GRID, MAX_GRID, 10);
  const srcCells = arr(v.cells);
  // 칸 배열 길이가 맞지 않으면 앞에서부터 채우고 나머지는 빈 칸
  const cells = Array.from({ length: cols * rows }, (_, i) => (srcCells[i] === 1 ? 1 : 0));
  const f: Floor = {
    id: ids.take(v.id, 'fl'),
    name: str(v.name, 24, `${k + 1}F`).trim() || `${k + 1}F`,
    cols,
    rows,
    wallHeight: num(v.wallHeight, 3, 8, 4),
    cells,
    partitions: [],
    wallItems: [],
    props: [],
    spawn: null,
    tourOrder: [],
  };
  f.partitions = [...new Set(arr(v.partitions).filter((p): p is string => edgeOk(f, p)))];
  let hasElevator = false;
  for (const raw of arr(v.wallItems)) {
    const it = wallItem(raw, f, ids, media);
    if (!it) continue;
    // 엘리베이터는 층마다 하나
    if (it.kind === 'elevator') {
      if (hasElevator) continue;
      hasElevator = true;
    }
    f.wallItems.push(it);
  }
  f.props = arr(v.props)
    .map((p) => prop(p, f, ids, media))
    .filter((p): p is Prop => !!p);
  f.spawn = spawn(v.spawn, f);
  const itemIds = new Set<string>([...f.wallItems.map((w) => w.id), ...f.props.map((p) => p.id)]);
  f.tourOrder = [...new Set(arr(v.tourOrder).filter((id): id is string => typeof id === 'string' && itemIds.has(id)))];
  return f;
}

/** 버전을 확인하고 현재 스키마의 전시 문서로 정리한다 */
export function migrateExhibition(raw: unknown): Exhibition {
  if (!isObj(raw)) throw new SchemaError('전시 데이터 형식이 아니에요');
  const version = raw.schemaVersion === undefined ? 1 : Number(raw.schemaVersion);
  if (!Number.isFinite(version) || version < 1) throw new SchemaError('전시 데이터의 버전 정보가 올바르지 않아요');
  if (version > SCHEMA_VERSION) throw new SchemaError('더 새로운 버전의 Museum Constructor 에서 만든 전시예요. 페이지를 새로 고친 뒤 다시 시도해 주세요.');
  if (!Array.isArray(raw.floors) || !Array.isArray(raw.artworks)) throw new SchemaError('전시 데이터에 층/작품 정보가 없어요');

  const ids = new IdPool();
  const now = Date.now();
  const artworks = raw.artworks.map((a) => artwork(a, ids)).filter((a): a is Artwork => !!a);
  const artIds = new Set(artworks.map((a) => a.id));
  const media: MediaMap = new Map(artworks.map((a) => [a.id, a.media]));
  let floors = raw.floors
    .slice(0, MAX_FLOORS)
    .map((f, k) => floorOf(f, k, ids, media))
    .filter((f): f is Floor => !!f);
  if (!floors.length) floors = [floorOf({}, 0, ids, media)!];
  const theme = isObj(raw.theme) ? raw.theme : {};
  const audio = isObj(raw.audio) ? raw.audio : {};
  const createdAt = time(raw.createdAt, now);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: ids.take(raw.id, 'ex'),
    title: str(raw.title, 120),
    subtitle: str(raw.subtitle, 160),
    description: str(raw.description, 4000),
    curator: str(raw.curator, 80),
    status: raw.status === 'published' ? 'published' : 'draft',
    coverArtworkId: typeof raw.coverArtworkId === 'string' && artIds.has(raw.coverArtworkId) ? raw.coverArtworkId : null,
    theme: {
      wallColor: color(theme.wallColor, '#f4f2ee'),
      floorStyle: oneOf(theme.floorStyle, FLOOR_STYLES, 'oak'),
      lighting: oneOf(theme.lighting, LIGHTINGS, 'bright'),
    },
    audio: {
      bgmBlobId: typeof audio.bgmBlobId === 'string' && ID_RE.test(audio.bgmBlobId) ? audio.bgmBlobId : null,
      bgmVolume: num(audio.bgmVolume, 0, 1, 0.35),
      tts: typeof audio.tts === 'boolean' ? audio.tts : true,
    },
    artworks,
    floors,
    createdAt,
    updatedAt: Math.max(createdAt, time(raw.updatedAt, createdAt)),
  };
}
