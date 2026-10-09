/**
 * 전시회 문서 모델.
 * 프로토타입은 IndexedDB 에 그대로 저장하지만, 이후 게시판 서버가 붙어도
 * 이 JSON 구조를 그대로 API 페이로드로 쓸 수 있도록 순수 데이터만 담는다.
 */

export type ID = string;

export const SCHEMA_VERSION = 1;

export type ExhibitionStatus = 'draft' | 'published';

export type FloorStyle = 'oak' | 'concrete' | 'marble' | 'dark';
export type LightingPreset = 'bright' | 'warm' | 'dramatic';

export interface ExhibitionTheme {
  wallColor: string;
  floorStyle: FloorStyle;
  lighting: LightingPreset;
}

export type ArtworkSource =
  | { kind: 'upload'; blobId: ID }
  | { kind: 'url'; url: string }
  | { kind: 'sample'; index: number };

export interface Artwork {
  id: ID;
  source: ArtworkSource;
  /** 원본 이미지 픽셀 크기 (비율 계산용) */
  width: number;
  height: number;
  title: string;
  artist: string;
  year: string;
  description: string;
}

/**
 * 그리드 모서리 키.
 *  - 'h:i:j' : z = j*CELL 위치의 가로 모서리 (x: i*CELL ~ (i+1)*CELL), j ∈ [0, rows]
 *  - 'v:i:j' : x = i*CELL 위치의 세로 모서리 (z: j*CELL ~ (j+1)*CELL), i ∈ [0, cols]
 */
export type EdgeKey = string;

/** 벽면의 어느 쪽을 바라보는지. +1 = 좌표가 증가하는 방향(+z 또는 +x)을 바라봄 */
export type WallSide = 1 | -1;

export type FrameStyle = 'none' | 'black' | 'white' | 'oak' | 'brass';

interface WallItemBase {
  id: ID;
  edge: EdgeKey;
  side: WallSide;
  /** 벽을 바라봤을 때 오른쪽(+)/왼쪽(-) 으로의 이동량 (m) */
  offset: number;
}

export interface FrameItem extends WallItemBase {
  kind: 'frame';
  artworkId: ID | null;
  /** 이미지(작품) 가로 크기 (m). 세로는 이미지 비율로 결정 */
  width: number;
  /** 액자 중심 높이 (m) */
  elevation: number;
  frameStyle: FrameStyle;
  /** 매트(passe-partout) 폭 (m) */
  mat: number;
  showCaption: boolean;
}

export interface ElevatorItem extends WallItemBase {
  kind: 'elevator';
}

export type WallItem = FrameItem | ElevatorItem;

export type PropType = 'bench' | 'plant' | 'pedestal';

export interface Prop {
  id: ID;
  type: PropType;
  x: number;
  z: number;
  /** 라디안 */
  rotation: number;
}

export interface Spawn {
  x: number;
  z: number;
  /** 라디안. 0 = -z 방향(평면도 위쪽)을 바라봄 */
  yaw: number;
}

export interface Floor {
  id: ID;
  name: string;
  cols: number;
  rows: number;
  wallHeight: number;
  /** rows*cols, 0 = 비어있음, 1 = 바닥 */
  cells: number[];
  /** 사용자가 그린 칸막이 벽 */
  partitions: EdgeKey[];
  wallItems: WallItem[];
  props: Prop[];
  spawn: Spawn | null;
}

export interface Exhibition {
  schemaVersion: number;
  id: ID;
  title: string;
  subtitle: string;
  description: string;
  curator: string;
  status: ExhibitionStatus;
  coverArtworkId: ID | null;
  theme: ExhibitionTheme;
  artworks: Artwork[];
  floors: Floor[];
  createdAt: number;
  updatedAt: number;
}

/** 목록 화면용 요약 (무거운 floors 를 읽지 않아도 되도록 별도 저장) */
export interface ExhibitionSummary {
  id: ID;
  title: string;
  subtitle: string;
  curator: string;
  status: ExhibitionStatus;
  floorCount: number;
  artworkCount: number;
  cover: ArtworkSource | null;
  createdAt: number;
  updatedAt: number;
}
