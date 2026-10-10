import * as THREE from 'three';
import { canvasFont } from './canvasText';

const cache = new Map<string, { tex: THREE.CanvasTexture; refs: number }>();

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    const next = cur + ch;
    if (g.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = ch.trimStart();
      if (lines.length === maxLines) break;
    } else cur = next;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && lines.join('').length < text.length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  return lines;
}

/** 작품 옆 캡션(명제표) 텍스처. 내용이 같으면 공유 */
export function acquireCaptionTexture(title: string, artist: string, year: string): THREE.CanvasTexture {
  const key = `${title}\u0000${artist}\u0000${year}`;
  const hit = cache.get(key);
  if (hit) {
    hit.refs++;
    return hit.tex;
  }
  const W = 512;
  const H = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf7';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#16161a';
  g.font = canvasFont(700, 40);
  const titleLines = wrap(g, title || '무제', W - 64, 2);
  let y = 72;
  for (const l of titleLines) {
    g.fillText(l, 32, y);
    y += 50;
  }
  g.fillStyle = '#4a4a50';
  g.font = canvasFont(500, 30);
  if (artist) {
    g.fillText(wrap(g, artist, W - 64, 1)[0] ?? '', 32, y + 8);
    y += 44;
  }
  if (year) {
    g.fillStyle = '#7a7a80';
    g.font = canvasFont(400, 28);
    g.fillText(year, 32, y + 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, { tex, refs: 1 });
  return tex;
}

export function releaseCaptionTexture(tex: THREE.Texture) {
  for (const [k, v] of cache) {
    if (v.tex === tex) {
      v.refs--;
      if (v.refs <= 0) {
        v.tex.dispose();
        cache.delete(k);
      }
      return;
    }
  }
}

/** 엘리베이터 층 표시 */
export function floorIndicatorTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0d0f';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#ffb347';
  g.font = canvasFont(700, 60);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
