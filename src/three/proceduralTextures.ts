import * as THREE from 'three';

/**
 * 조명/그림자 표현용 기술적(technical) 그라디언트 텍스처.
 * 디자인 에셋이 아니라 렌더링 보조용이므로 코드로 생성한다.
 */

const cache = new Map<string, THREE.Texture>();

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = false) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** 벽에 떨어지는 스포트라이트 빛 웅덩이 (알파) */
export function wallWashTexture() {
  return make('wash', 256, 256, (g) => {
    const r = g.createRadialGradient(128, 118, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    r.addColorStop(0.7, 'rgba(255,255,255,0.18)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}

/** 벽과 바닥이 만나는 곳의 부드러운 앰비언트 오클루전 띠 (v=0 이 벽 쪽) */
export function aoStripTexture() {
  return make('ao', 4, 128, (g) => {
    const l = g.createLinearGradient(0, 0, 0, 128);
    l.addColorStop(0, 'rgba(0,0,0,0.42)');
    l.addColorStop(0.25, 'rgba(0,0,0,0.2)');
    l.addColorStop(0.6, 'rgba(0,0,0,0.05)');
    l.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = l;
    g.fillRect(0, 0, 4, 128);
  });
}

/** 소품 아래 접지 그림자 */
export function contactShadowTexture() {
  return make('contact', 128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
}

/** 이미지가 없거나 불러오지 못한 액자에 표시 */
export function statusTexture(kind: 'empty' | 'error' | 'loading') {
  return make(
    `status:${kind}`,
    512,
    384,
    (g) => {
      g.fillStyle = kind === 'error' ? '#3a2f2f' : '#d9d6d0';
      g.fillRect(0, 0, 512, 384);
      g.strokeStyle = kind === 'error' ? '#c97b7b' : '#a8a49c';
      g.lineWidth = 6;
      g.setLineDash([18, 12]);
      g.strokeRect(24, 24, 464, 336);
      g.setLineDash([]);
      g.fillStyle = kind === 'error' ? '#f1d0d0' : '#6f6b63';
      g.textAlign = 'center';
      g.font = '600 38px Pretendard, system-ui, sans-serif';
      const msg = kind === 'empty' ? '이미지 없음' : kind === 'error' ? '이미지를 불러올 수 없음' : '불러오는 중…';
      g.fillText(msg, 256, 200);
      if (kind === 'error') {
        g.font = '400 24px Pretendard, system-ui, sans-serif';
        g.fillText('URL 또는 CORS 설정을 확인하세요', 256, 244);
      }
    },
    true,
  );
}
