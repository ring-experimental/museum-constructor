/**
 * 전시회 문서 모델.
 * 프로토타입은 IndexedDB 에 그대로 저장하지만, 이후 게시판 서버가 붙어도
 * 이 JSON 구조를 그대로 API 페이로드로 쓸 수 있도록 순수 데이터만 담는다.
 */

export type ID = string;

/**
 * 문서 구조 버전. 구조를 바꾸면 올리고 core/schema.ts 의 migrateExhibition 에 변환을 추가한다.
 *  v1 — 첫 프로토타입
 *  v2 — 벽 글(text), 층별 감상 순서(tourOrder), 작품 종류(media), 좌대 위 입체 작품,
 *       오디오(작품 해설 녹음, 배경 음악), 작품별 조명(light)
 */
export const SCHEMA_VERSION = 2;

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

/** 작품 종류: 사진·그림(벽), 영상(벽 액자에서 재생), 입체(조각 좌대에 올리는 3D 모델, GLB) */
export type ArtworkMedia = 'image' | 'video' | 'model';

export interface Artwork {
  id: ID;
  media: ArtworkMedia;
  source: ArtworkSource;
  /** 원본 이미지 픽셀 크기 (비율 계산용). 입체 작품은 미리보기 이미지 크기 */
  width: number;
  height: number;
  title: string;
  artist: string;
  year: string;
  description: string;
  /** 작품 해설 녹음 (업로드한 오디오 파일). 없으면 설명을 음성 합성으로 읽어 준다 */
  audioBlobId: ID | null;
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
/** 작품 조명: 기본(천장 조명), 스포트라이트(집중 조명), 끄기 */
export type FrameLight = 'normal' | 'spot' | 'off';

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
  light: FrameLight;
}

export interface ElevatorItem extends WallItemBase {
  kind: 'elevator';
}

export type TextSize = 'S' | 'M' | 'L';
export type TextAlign = 'left' | 'center';
/** 'auto' = 벽 색 밝기에 따라 어두운/밝은 글씨 자동 선택 */
export type TextColor = 'auto' | 'dark' | 'light';

/** 벽에 직접 붙이는 글 (전시 서문, 섹션 제목, 안내문) */
export interface TextItem extends WallItemBase {
  kind: 'text';
  title: string;
  body: string;
  /** 글이 차지하는 가로 폭 (m). 세로는 글 양에 따라 결정 */
  width: number;
  /** 글 블록 중심 높이 (m) */
  elevation: number;
  size: TextSize;
  align: TextAlign;
  color: TextColor;
}

export type WallItem = FrameItem | ElevatorItem | TextItem;

export type PropType = 'bench' | 'plant' | 'pedestal';

export interface Prop {
  id: ID;
  type: PropType;
  x: number;
  z: number;
  /** 라디안 */
  rotation: number;
  /** 조각 좌대 위에 올린 입체 작품 (좌대에만 쓰임) */
  artworkId: ID | null;
  /** 좌대 위 작품의 높이 (m) */
  artHeight: number;
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
  /** 큐레이터가 정한 감상 순서 (벽 항목 id). 비어 있으면 자동 순서 */
  tourOrder: ID[];
}

export interface ExhibitionAudio {
  /** 배경 음악 (업로드한 오디오 파일) */
  bgmBlobId: ID | null;
  /** 배경 음악 음량 0..1 */
  bgmVolume: number;
  /** 녹음이 없는 작품·벽 글을 음성 합성(TTS)으로 읽어 줄지 */
  tts: boolean;
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
  audio: ExhibitionAudio;
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
