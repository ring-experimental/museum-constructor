import type { FloorStyle, FrameStyle, LightingPreset, PropType } from './types';

/** 그리드 한 칸 = 2m. 액자 한 점이 편하게 걸리는 벽 한 구간(bay) 크기 */
export const CELL = 2;
export const WALL_THICKNESS = 0.2;
export const DEFAULT_WALL_HEIGHT = 4;
export const EYE_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.32;

export const MIN_GRID = 3;
export const MAX_GRID = 40;
export const MAX_FLOORS = 8;

export const FRAME_DEFAULTS = {
  width: 1.1,
  elevation: 1.55,
  frameStyle: 'black' as FrameStyle,
  mat: 0.08,
  showCaption: true,
};

export const FRAME_STYLE_SPEC: Record<
  FrameStyle,
  { label: string; border: number; depth: number; color: string; metalness: number; roughness: number }
> = {
  none: { label: '액자 없음', border: 0, depth: 0.03, color: '#ffffff', metalness: 0, roughness: 0.8 },
  black: { label: '블랙', border: 0.035, depth: 0.045, color: '#1d1d1f', metalness: 0.1, roughness: 0.55 },
  white: { label: '화이트', border: 0.035, depth: 0.045, color: '#f3f1ec', metalness: 0, roughness: 0.6 },
  oak: { label: '오크 원목', border: 0.05, depth: 0.05, color: '#a9784a', metalness: 0, roughness: 0.6 },
  brass: { label: '브라스', border: 0.03, depth: 0.04, color: '#b08d57', metalness: 1, roughness: 0.35 },
};

export const FLOOR_STYLE_SPEC: Record<FloorStyle, { label: string; color: string; roughness: number }> = {
  oak: { label: '오크 마루', color: '#8a6a4c', roughness: 0.55 },
  concrete: { label: '폴리싱 콘크리트', color: '#8b8986', roughness: 0.45 },
  marble: { label: '화이트 마블', color: '#d6d2cb', roughness: 0.25 },
  dark: { label: '다크 테라조', color: '#33322f', roughness: 0.5 },
};

export const LIGHTING_SPEC: Record<LightingPreset, { label: string; description: string }> = {
  bright: { label: '밝은 화이트', description: '균일하고 밝은 갤러리 조명' },
  warm: { label: '따뜻한 조명', description: '아늑한 웜톤 조명' },
  dramatic: { label: '드라마틱', description: '어두운 공간에 작품만 비추는 조명' },
};

export const WALL_COLOR_PRESETS = ['#f4f2ee', '#ffffff', '#e9e4da', '#d9dde0', '#3f4a45', '#5b2d2a', '#1f2a3a', '#2a2a2c'];

export const PROP_SPEC: Record<PropType, { label: string; w: number; d: number; color: string }> = {
  bench: { label: '벤치', w: 1.8, d: 0.5, color: '#b98a5a' },
  plant: { label: '화분', w: 0.7, d: 0.7, color: '#4f7a4a' },
  pedestal: { label: '조각 좌대', w: 0.5, d: 0.5, color: '#d8d4cc' },
};

export const ELEVATOR_WIDTH = 1.96;
