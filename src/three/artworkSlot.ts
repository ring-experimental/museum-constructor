import * as THREE from 'three';
import type { ArtworkMedia, ArtworkSource } from '../core/types';
import { acquireArtworkTexture, fitTextureToAspect, releaseArtworkTexture, type TexLevel } from './artworkTextures';
import { statusTexture } from './proceduralTextures';

/** 가까이 있는 작품 몇 점까지 고해상도로 둘지 */
const MAX_FULL = 10;
/** 이 거리(m) 안으로 들어오면 고해상도로 올리고 */
const NEAR = 7;
/** 이 거리 밖으로 나가면 다시 작은 텍스처로 (사이 구간은 그대로 → 경계에서 깜빡이지 않게) */
const FAR = 11;

/**
 * 액자 한 점의 이미지 텍스처를 관리한다.
 * 처음엔 작은 텍스처(thumb)를 걸고, 관람객이 가까이 오면 고해상도(full)로 바꿔 끼운다.
 */
export class ArtworkSlot {
  private held = new Set<TexLevel>();
  private fitted = new Map<TexLevel, THREE.Texture>();
  /** 비동기 로드가 끝났을 때 아직 유효한 요청인지 확인하는 세대 번호 */
  private gen: Record<TexLevel, number> = { thumb: 0, full: 0 };
  private want: TexLevel = 'thumb';
  private shown: TexLevel | null = null;
  private disposed = false;

  constructor(
    private readonly src: ArtworkSource,
    private readonly mat: THREE.MeshBasicMaterial,
    private readonly aspect: number,
    readonly center: THREE.Vector3,
    private readonly changed: () => void,
    private readonly media: ArtworkMedia = 'image',
  ) {
    this.request('thumb');
  }

  get level() {
    return this.shown;
  }

  private request(level: TexLevel) {
    if (this.held.has(level)) {
      if (this.fitted.has(level) && this.want === level) this.show(level);
      return;
    }
    this.held.add(level);
    const token = ++this.gen[level];
    acquireArtworkTexture(this.src, level, this.media)
      .then((tex) => {
        if (this.disposed || token !== this.gen[level]) return;
        this.fitted.set(level, fitTextureToAspect(tex, this.aspect));
        // 원하는 단계거나, 아직 아무것도 안 보이면 바로 표시
        if (this.want === level || this.shown === null) {
          this.show(level);
          if (level === 'thumb' && this.want === 'thumb') this.drop('full');
        }
      })
      .catch(() => {
        if (this.disposed || token !== this.gen[level]) return;
        // 고해상도 실패는 작은 텍스처로 버틴다. 작은 텍스처도 실패하면 오류 표시
        if (level === 'thumb' && this.shown === null) {
          this.mat.map = statusTexture('error');
          this.mat.needsUpdate = true;
          this.changed();
        }
      });
  }

  private drop(level: TexLevel) {
    if (!this.held.has(level)) return;
    this.held.delete(level);
    this.gen[level]++;
    const f = this.fitted.get(level);
    this.fitted.delete(level);
    if (f?.userData.isClone) f.dispose();
    releaseArtworkTexture(this.src, level);
    if (this.shown === level) this.shown = null;
  }

  private show(level: TexLevel) {
    const f = this.fitted.get(level);
    if (!f || this.disposed) return;
    this.mat.map = f;
    this.mat.needsUpdate = true;
    this.shown = level;
    this.changed();
  }

  setWant(level: TexLevel) {
    if (level === this.want) return;
    this.want = level;
    if (level === 'full') {
      this.request('full');
      return;
    }
    // 작은 텍스처가 준비될 때까지는 고해상도를 내리지 않는다 (빈 화면 방지)
    if (!this.fitted.has('thumb')) {
      if (!this.held.has('thumb')) this.request('thumb');
      return;
    }
    this.show('thumb');
    this.drop('full');
  }

  dispose() {
    this.drop('full');
    this.drop('thumb');
    this.disposed = true;
  }
}

/** 카메라와의 거리로 작품마다 원하는 해상도를 정한다 */
export function updateSlotsLod(slots: ArtworkSlot[], cam: THREE.Vector3) {
  const ranked = slots.map((s) => ({ s, d: s.center.distanceTo(cam) })).sort((a, b) => a.d - b.d);
  ranked.forEach(({ s, d }, k) => {
    if (k < MAX_FULL && d < NEAR) s.setWant('full');
    else if (k >= MAX_FULL || d > FAR) s.setWant('thumb');
  });
}
