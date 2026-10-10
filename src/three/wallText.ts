import * as THREE from 'three';
import { TEXT_SIZE_SPEC } from '../core/constants';
import type { TextItem } from '../core/types';
import { canvasFont, whenFontReady, wrapText } from './canvasText';

/** 텍스처 해상도 (1m 당 픽셀) */
const PX_PER_M = 600;
const MAX_PX = 2048;
const MAX_TITLE_LINES = 4;
const MAX_BODY_LINES = 40;

export const INK_DARK = '#1e1d1b';
export const INK_LIGHT = '#f5f3ee';

function luminance(hex: string) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** 벽 색에 맞는 글자 색 */
export function wallTextInk(item: Pick<TextItem, 'color'>, wallColor: string): string {
  if (item.color === 'dark') return INK_DARK;
  if (item.color === 'light') return INK_LIGHT;
  return luminance(wallColor) < 0.32 ? INK_LIGHT : INK_DARK;
}

export interface WallTextBlock {
  texture: THREE.CanvasTexture;
  /** 글 블록 실제 크기 (m) */
  width: number;
  height: number;
  dispose(): void;
}

interface Layout {
  scale: number;
  W: number;
  H: number;
  titleFont: string;
  bodyFont: string;
  titleLines: string[];
  bodyLines: string[];
  titleLH: number;
  bodyLH: number;
  gap: number;
}

function layout(g: CanvasRenderingContext2D, item: TextItem): Layout {
  const spec = TEXT_SIZE_SPEC[item.size];
  const scale = Math.min(PX_PER_M, MAX_PX / Math.max(0.2, item.width));
  const W = Math.max(8, Math.round(item.width * scale));
  const titleFont = canvasFont(700, spec.title * scale);
  const bodyFont = canvasFont(400, spec.body * scale);
  g.font = titleFont;
  const titleLines = item.title.trim() ? wrapText(g, item.title.trim(), W, MAX_TITLE_LINES) : [];
  g.font = bodyFont;
  const bodyLines = item.body.trim() ? wrapText(g, item.body.trim(), W, MAX_BODY_LINES) : [];
  const titleLH = spec.title * scale * 1.28;
  const bodyLH = spec.body * scale * 1.7;
  const gap = titleLines.length && bodyLines.length ? spec.title * scale * 0.55 : 0;
  let H = titleLines.length * titleLH + gap + bodyLines.length * bodyLH;
  H = Math.max(Math.round(spec.body * scale * 2), Math.ceil(H));
  // 세로가 너무 길면 텍스처 한도 안으로 (글자가 약간 작아 보이는 대신 잘리지 않게)
  return { scale, W, H: Math.min(MAX_PX, H), titleFont, bodyFont, titleLines, bodyLines, titleLH, bodyLH, gap };
}

function draw(canvas: HTMLCanvasElement, item: TextItem, ink: string, L: Layout) {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = ink;
  g.textBaseline = 'alphabetic';
  g.textAlign = item.align === 'center' ? 'center' : 'left';
  const x = item.align === 'center' ? L.W / 2 : 0;
  // 전체 높이가 캔버스보다 크면 세로로 살짝 압축
  const total = L.titleLines.length * L.titleLH + L.gap + L.bodyLines.length * L.bodyLH;
  const k = total > L.H ? L.H / total : 1;
  g.save();
  g.scale(1, k);
  let y = 0;
  g.font = L.titleFont;
  for (const line of L.titleLines) {
    y += L.titleLH;
    g.fillText(line, x, y - L.titleLH * 0.24);
  }
  y += L.gap;
  g.font = L.bodyFont;
  g.globalAlpha = 0.88;
  for (const line of L.bodyLines) {
    y += L.bodyLH;
    if (line) g.fillText(line, x, y - L.bodyLH * 0.3);
  }
  g.restore();
}

/**
 * 벽 글을 투명 캔버스 텍스처로 만든다.
 * 폰트가 늦게 로드되면 같은 크기의 캔버스에 다시 그리고 onRedraw 를 호출한다.
 */
export function createWallTextBlock(item: TextItem, ink: string, onRedraw?: () => void): WallTextBlock {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const L = layout(g, item);
  canvas.width = L.W;
  canvas.height = L.H;
  draw(canvas, item, ink, L);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let disposed = false;
  const pending = [whenFontReady(L.titleFont, item.title), whenFontReady(L.bodyFont, item.body)].filter(Boolean);
  if (pending.length)
    void Promise.all(pending).then(() => {
      if (disposed) return;
      // 폰트가 바뀌면 줄바꿈도 달라지므로 같은 캔버스 크기 안에서 다시 배치
      const L2 = layout(g, item);
      draw(canvas, item, ink, { ...L2, W: L.W, H: L.H });
      texture.needsUpdate = true;
      onRedraw?.();
    });
  return {
    texture,
    width: L.W / L.scale,
    height: L.H / L.scale,
    dispose() {
      disposed = true;
      texture.dispose();
    },
  };
}

/** 내용이 없는 벽 글인지 */
export const isEmptyText = (item: Pick<TextItem, 'title' | 'body'>) => !item.title.trim() && !item.body.trim();
