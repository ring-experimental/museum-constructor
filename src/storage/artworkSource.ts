import type { ArtworkSource } from '../core/types';
import { publicUrl } from '../publicUrl';
import { imageRepo, loadImg } from './imageRepo';

/**
 * 샘플 전시용 이미지.
 * public/assets/samples/sample-01.jpg … 파일이 있으면 그것을 쓰고,
 * 없으면 개발용 임시 플레이스홀더를 캔버스로 그린다. (최종 에셋은 외부 제작)
 */
export const SAMPLE_COUNT = 12;
export const SAMPLE_ASPECTS = [4 / 3, 3 / 4, 1, 3 / 2, 2 / 3, 16 / 9, 4 / 5, 5 / 4, 3 / 2, 1, 2 / 3, 4 / 3];
export const SAMPLE_TITLES = [
  '새벽의 수평선',
  '정적의 방',
  '빛의 입자',
  '안개가 머무는 숲',
  '나선의 시간',
  '하늘을 담은 땅',
  '고요한 정물',
  '황금빛 들판',
  '비 내리는 밤',
  '가을의 한 잎',
  '눈 내린 골목',
  '파도의 기록',
];

/** 이전 버전의 임시 제목 (이미 만들어진 샘플 전시를 새 제목으로 옮기는 데 사용) */
export const LEGACY_SAMPLE_TITLES = [
  '새벽의 수평선',
  '정적의 방',
  '빛의 입자',
  '도시의 오후',
  '흔들리는 숲',
  '바다로 가는 길',
  '창가의 정물',
  '겨울 산책',
  '붉은 지붕들',
  '구름의 기록',
  '골목의 그림자',
  '마지막 빛',
];

export const sampleFileUrl = (index: number) => publicUrl(`assets/samples/sample-${String(index + 1).padStart(2, '0')}.jpg`);

const sampleResolved = new Map<number, Promise<string>>();

function placeholderDataUrl(index: number): string {
  const aspect = SAMPLE_ASPECTS[index % SAMPLE_ASPECTS.length];
  const long = 1200;
  const w = aspect >= 1 ? long : Math.round(long * aspect);
  const h = aspect >= 1 ? Math.round(long / aspect) : long;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  let seed = (index + 1) * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const hue = (index * 47) % 360;
  const bg = g.createLinearGradient(0, 0, w * rnd(), h);
  bg.addColorStop(0, `hsl(${hue}, 35%, ${30 + rnd() * 20}%)`);
  bg.addColorStop(1, `hsl(${(hue + 40) % 360}, 45%, ${60 + rnd() * 20}%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 5; k++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.15 + rnd() * 0.35) * Math.max(w, h);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    const hh = (hue + rnd() * 90 - 45 + 360) % 360;
    rg.addColorStop(0, `hsla(${hh}, 55%, ${50 + rnd() * 30}%, 0.55)`);
    rg.addColorStop(1, `hsla(${hh}, 55%, 50%, 0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = `600 ${Math.round(Math.min(w, h) * 0.035)}px Pretendard, system-ui, sans-serif`;
  g.fillText(`SAMPLE ${String(index + 1).padStart(2, '0')}`, Math.round(w * 0.04), Math.round(h - h * 0.05));
  return c.toDataURL('image/jpeg', 0.9);
}

function resolveSample(index: number): Promise<string> {
  let p = sampleResolved.get(index);
  if (!p) {
    const url = sampleFileUrl(index);
    p = loadImg(url, true)
      .then(() => url)
      .catch(() => placeholderDataUrl(index));
    sampleResolved.set(index, p);
  }
  return p;
}

export async function resolveArtworkUrl(source: ArtworkSource, variant: 'full' | 'thumb' = 'full'): Promise<string | null> {
  switch (source.kind) {
    case 'upload':
      return imageRepo.getURL(source.blobId, variant);
    case 'url':
      return source.url;
    case 'sample':
      return resolveSample(source.index);
  }
}

/** 텍스처/캔버스용으로 이미지를 로드 (외부 URL 은 CORS 필요) */
export async function loadArtworkImage(source: ArtworkSource, variant: 'full' | 'thumb' = 'full'): Promise<HTMLImageElement> {
  const url = await resolveArtworkUrl(source, variant);
  if (!url) throw new Error('이미지를 찾을 수 없습니다');
  const img = await loadImg(url, source.kind === 'url');
  return img;
}

export const sourceKey = (s: ArtworkSource) => (s.kind === 'upload' ? `u:${s.blobId}` : s.kind === 'url' ? `l:${s.url}` : `s:${s.index}`);
