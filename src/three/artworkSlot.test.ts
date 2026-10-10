import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 텍스처 캐시는 브라우저 캔버스를 쓰므로 가짜로 바꾼다
const refs = new Map<string, number>();
const pending: { key: string; resolve: (t: THREE.Texture) => void; reject: (e: Error) => void }[] = [];
vi.mock('./artworkTextures', () => ({
  acquireArtworkTexture: (_src: unknown, level: string) => {
    refs.set(level, (refs.get(level) ?? 0) + 1);
    return new Promise<THREE.Texture>((resolve, reject) => pending.push({ key: level, resolve, reject }));
  },
  releaseArtworkTexture: (_src: unknown, level: string) => refs.set(level, (refs.get(level) ?? 0) - 1),
  fitTextureToAspect: (t: THREE.Texture) => t,
}));
vi.mock('./proceduralTextures', () => ({ statusTexture: () => new THREE.Texture() }));

const { ArtworkSlot, updateSlotsLod } = await import('./artworkSlot');

function tex(level: string) {
  const t = new THREE.Texture();
  t.name = level;
  return t;
}
async function settle(level: string, ok = true) {
  const i = pending.findIndex((p) => p.key === level);
  const p = pending.splice(i, 1)[0];
  if (ok) p.resolve(tex(level));
  else p.reject(new Error('fail'));
  await Promise.resolve();
  await Promise.resolve();
}

function makeSlot(z = 0) {
  const mat = new THREE.MeshBasicMaterial();
  const slot = new ArtworkSlot({ kind: 'sample', index: 0 }, mat, 1, new THREE.Vector3(0, 1.5, z), () => {});
  return { slot, mat };
}

beforeEach(() => {
  refs.clear();
  pending.length = 0;
});

describe('ArtworkSlot', () => {
  it('shows the thumbnail first and swaps to full resolution when near', async () => {
    const { slot, mat } = makeSlot();
    await settle('thumb');
    expect(mat.map?.name).toBe('thumb');
    slot.setWant('full');
    expect(mat.map?.name).toBe('thumb'); // 로드되기 전엔 그대로
    await settle('full');
    expect(mat.map?.name).toBe('full');
    expect(slot.level).toBe('full');
  });

  it('drops full resolution again when walking away', async () => {
    const { slot, mat } = makeSlot();
    await settle('thumb');
    slot.setWant('full');
    await settle('full');
    slot.setWant('thumb');
    expect(mat.map?.name).toBe('thumb');
    expect(refs.get('full')).toBe(0);
  });

  it('ignores a full texture that arrives after leaving', async () => {
    const { slot, mat } = makeSlot();
    await settle('thumb');
    slot.setWant('full');
    slot.setWant('thumb');
    await settle('full');
    expect(mat.map?.name).toBe('thumb');
    expect(refs.get('full')).toBe(0);
  });

  it('keeps the thumbnail if full resolution fails, releases everything on dispose', async () => {
    const { slot, mat } = makeSlot();
    await settle('thumb');
    slot.setWant('full');
    await settle('full', false);
    expect(mat.map?.name).toBe('thumb');
    slot.dispose();
    expect(refs.get('thumb')).toBe(0);
    expect(refs.get('full')).toBe(0);
  });

  it('upgrades only nearby slots, with hysteresis', async () => {
    const near = makeSlot(-3);
    const mid = makeSlot(-9);
    const far = makeSlot(-30);
    for (let k = 0; k < 3; k++) await settle('thumb');
    const cam = new THREE.Vector3(0, 1.6, 0);
    updateSlotsLod([near.slot, mid.slot, far.slot], cam);
    expect(pending.filter((p) => p.key === 'full')).toHaveLength(1);
    await settle('full');
    expect(near.mat.map?.name).toBe('full');
    // 8m 떨어지면(7~11m 사이) 그대로 유지
    cam.set(0, 1.6, 5);
    updateSlotsLod([near.slot, mid.slot, far.slot], cam);
    expect(near.mat.map?.name).toBe('full');
    cam.set(0, 1.6, 20);
    updateSlotsLod([near.slot, mid.slot, far.slot], cam);
    expect(near.mat.map?.name).toBe('thumb');
  });
});
