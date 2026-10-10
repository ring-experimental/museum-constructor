import { toast } from '../components/Toast';
import { MAX_FLOORS, PROP_SPEC } from '../core/constants';
import { autoHang, createFloor, newElevator, newFrame, newProp, newText } from '../core/factory';
import { cellAt, faceId, isFilled, type WallFace } from '../core/grid';
import { uid } from '../core/ids';
import type { Artwork, ArtworkMedia, Exhibition, Floor } from '../core/types';
import { WALL_MEDIA } from '../core/schema';
import { readPhotoMeta } from '../storage/exif';
import { isModelFile, prepareModelFile } from '../three/modelArtwork';
import { isVideoFile, prepareVideoFile } from '../storage/videoFiles';
import { imageRepo, probeImageUrl } from '../storage/imageRepo';
import { cleanupFloor, currentFloor, selectedIds, selectionFromIds, useEditor } from './store';

const S = () => useEditor.getState();

/** 작품별로 걸린(올려진) 곳 수 — 벽 액자 + 조각 좌대 */
export function usageMap(doc: Exhibition): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string | null) => id && m.set(id, (m.get(id) ?? 0) + 1);
  for (const f of doc.floors) {
    for (const w of f.wallItems) if (w.kind === 'frame') add(w.artworkId);
    for (const p of f.props) add(p.artworkId);
  }
  return m;
}

/** 벽에 거는 작품인지(이미지) 좌대에 올리는 작품인지(입체) */
export const isWallMedia = (media: ArtworkMedia) => WALL_MEDIA.has(media);
/** 액자에 고를 수 있는 작품 종류 */
export const WALL_PICKER_MEDIA: ArtworkMedia[] = [...WALL_MEDIA];

/** 파일 선택창에서 받을 형식 */
export function acceptFor(media: ArtworkMedia[]) {
  const parts: string[] = [];
  if (media.includes('image')) parts.push('image/*');
  if (media.includes('video')) parts.push('video/mp4', 'video/webm', 'video/quicktime', '.mp4', '.webm', '.mov', '.m4v');
  if (media.includes('model')) parts.push('.glb', 'model/gltf-binary');
  return parts.join(',');
}

/** 같은 종류(벽/좌대) 중 아직 배치되지 않은 다음 작품 */
function nextUnplaced(doc: Exhibition, after: string | null): string | null {
  const used = usageMap(doc);
  const ref = doc.artworks.find((a) => a.id === after);
  const wall = ref ? isWallMedia(ref.media) : true;
  const list = doc.artworks.filter((a) => isWallMedia(a.media) === wall);
  const start = after ? list.findIndex((a) => a.id === after) + 1 : 0;
  for (let k = 0; k < list.length; k++) {
    const a = list[(start + k) % list.length];
    if (!used.has(a.id)) return a.id;
  }
  return null;
}

export function placeFrame(face: WallFace, artworkId: string | null = S().pendingArtworkId, offset = 0) {
  const frame = newFrame(face, artworkId, offset);
  if (artworkId) {
    const art = S().doc?.artworks.find((a) => a.id === artworkId);
    if (art) {
      const aspect = art.width / Math.max(1, art.height);
      frame.width = aspect >= 1.3 ? 1.35 : aspect <= 0.8 ? 0.85 : 1.05;
    }
  }
  S().mutateFloor((f) => {
    f.wallItems.push(frame);
  });
  S().select({ kind: 'wallItem', id: frame.id });
  // 연속 배치: 다음에 걸 작품으로 자동 이동
  if (artworkId && S().pendingArtworkId === artworkId) {
    const doc = S().doc!;
    S().setPending(nextUnplaced(doc, artworkId));
  }
  return frame.id;
}

export function placeText(face: WallFace) {
  const item = newText(face);
  S().mutateFloor((f) => {
    f.wallItems.push(item);
  });
  S().select({ kind: 'wallItem', id: item.id });
  S().setTab('selection');
  return item.id;
}

export function placeElevator(face: WallFace) {
  const f = currentFloor(S());
  const existing = f?.wallItems.find((w) => w.kind === 'elevator');
  if (existing) {
    S().mutateFloor((fl) => {
      const it = fl.wallItems.find((w) => w.id === existing.id)!;
      it.edge = face.edge;
      it.side = face.side;
      it.offset = 0;
    });
    S().select({ kind: 'wallItem', id: existing.id });
    toast('엘리베이터는 층마다 하나예요. 위치를 옮겼어요.');
    return;
  }
  const el = newElevator(face);
  S().mutateFloor((fl) => {
    fl.wallItems.push(el);
  });
  S().select({ kind: 'wallItem', id: el.id });
}

export function placeProp(x: number, z: number) {
  const st = S();
  const f = currentFloor(st);
  if (!f) return;
  const [i, j] = cellAt(x, z);
  if (!isFilled(f, i, j)) {
    toast('소품은 바닥 위에만 놓을 수 있어요');
    return;
  }
  // 좌대를 놓을 때 '다음에 올릴 입체 작품'이 있으면 함께 올린다
  const pending = st.pendingArtworkId ? st.doc?.artworks.find((a) => a.id === st.pendingArtworkId) : undefined;
  const artId = st.propType === 'pedestal' && pending?.media === 'model' ? pending.id : null;
  const prop = newProp(st.propType, x, z, st.propRotation, artId);
  st.mutateFloor((fl) => {
    fl.props.push(prop);
  });
  st.select({ kind: 'prop', id: prop.id });
  if (artId) S().setPending(nextUnplaced(S().doc!, artId));
}

/** 조각 좌대에 입체 작품을 올리거나(null 이면) 내린다 */
export function assignSculpture(propId: string, artworkId: string | null) {
  S().mutateFloor((f) => {
    const p = f.props.find((x) => x.id === propId);
    if (p && p.type === 'pedestal') p.artworkId = artworkId;
  });
  if (artworkId && S().pendingArtworkId === artworkId) S().setPending(nextUnplaced(S().doc!, artworkId));
}

export function deleteSelection() {
  const st = S();
  const sel = st.selection;
  if (!sel) return;
  if (sel.kind === 'multi') {
    const ids = new Set(sel.ids);
    st.mutateFloor((f) => {
      f.wallItems = f.wallItems.filter((w) => !ids.has(w.id));
      f.props = f.props.filter((p) => !ids.has(p.id));
    });
    toast(`${ids.size}개 항목을 지웠어요 (Ctrl+Z 로 되돌리기)`);
  } else if (sel.kind === 'wallItem') st.mutateFloor((f) => void (f.wallItems = f.wallItems.filter((w) => w.id !== sel.id)));
  else if (sel.kind === 'prop') st.mutateFloor((f) => void (f.props = f.props.filter((p) => p.id !== sel.id)));
  else if (sel.kind === 'spawn') st.mutateFloor((f) => void (f.spawn = null));
  else if (sel.kind === 'artwork') return removeArtwork(sel.id);
  st.select(null);
}

export function deleteItem(kind: 'wallItem' | 'prop', id: string) {
  const st = S();
  if (kind === 'wallItem') st.mutateFloor((f) => void (f.wallItems = f.wallItems.filter((w) => w.id !== id)));
  else st.mutateFloor((f) => void (f.props = f.props.filter((p) => p.id !== id)));
  const floor = currentFloor(S());
  if (floor && selectedIds(st.selection).includes(id)) st.select(selectionFromIds(floor, selectedIds(st.selection).filter((x) => x !== id)));
}

/** 선택한 소품들을 조금씩 옮긴다 (방향키) */
export function nudgeSelectedProps(dx: number, dz: number) {
  const ids = new Set(selectedIds(S().selection));
  S().mutateFloor((f) => {
    for (const p of f.props) {
      if (!ids.has(p.id)) continue;
      const nx = Math.round((p.x + dx) * 100) / 100;
      const nz = Math.round((p.z + dz) * 100) / 100;
      const [i, j] = cellAt(nx, nz);
      if (!isFilled(f as Floor, i, j)) continue;
      p.x = nx;
      p.z = nz;
    }
  });
}

/** 선택한 소품들을 각자 제자리에서 90° 회전 */
export function rotateSelectedProps() {
  const ids = new Set(selectedIds(S().selection));
  S().mutateFloor((f) => {
    for (const p of f.props) if (ids.has(p.id)) p.rotation = (p.rotation + Math.PI / 2) % (Math.PI * 2);
  });
}

function titleFromFile(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
}

export async function addArtworksFromFiles(files: File[] | FileList) {
  const st = S();
  const doc = st.doc;
  if (!doc) return [];
  const all = [...files];
  const list = all.filter((f) => f.type.startsWith('image/') || isModelFile(f) || isVideoFile(f));
  if (!list.length) {
    toast('이미지(JPG, PNG, WebP 등), 영상(MP4, WebM), 3D 모델(.glb) 파일만 올릴 수 있어요', 'error');
    return [];
  }
  if (list.length < all.length) toast(`지원하지 않는 파일 ${all.length - list.length}개는 건너뛰었어요`);
  toast(`작품 ${list.length}점을 처리하는 중…`);
  const added: Artwork[] = [];
  for (const file of list) {
    try {
      if (isVideoFile(file)) {
        const v = await prepareVideoFile(file);
        const blobId = await imageRepo.putRaw(doc.id, file, v.poster, v.width, v.height);
        added.push({
          id: uid('art'),
          media: 'video',
          source: { kind: 'upload', blobId },
          width: v.width,
          height: v.height,
          title: titleFromFile(file.name),
          artist: doc.curator.slice(0, 60),
          year: '',
          description: '',
    audioBlobId: null,
        });
        continue;
      }
      if (isModelFile(file)) {
        const m = await prepareModelFile(file);
        const blobId = await imageRepo.putRaw(doc.id, m.blob, m.thumb, m.size, m.size);
        added.push({
          id: uid('art'),
          media: 'model',
          source: { kind: 'upload', blobId },
          width: m.size,
          height: m.size,
          title: titleFromFile(file.name),
          artist: doc.curator.slice(0, 60),
          year: '',
          description: '',
    audioBlobId: null,
        });
        continue;
      }
      // 저장 시 다시 인코딩하면서 원본 메타데이터는 지워지므로 먼저 읽어 둔다
      const meta = await readPhotoMeta(file);
      const r = await imageRepo.put(doc.id, file);
      added.push({
        id: uid('art'),
        media: 'image',
        source: { kind: 'upload', blobId: r.blobId },
        width: r.width,
        height: r.height,
        title: (meta.title ?? titleFromFile(file.name)).slice(0, 60),
        artist: (meta.artist ?? doc.curator).slice(0, 60),
        year: meta.year ?? '',
        description: meta.description ?? '',
        audioBlobId: null,
      });
    } catch (e) {
      toast(`${file.name}: ${(e as Error).message}`, 'error');
    }
  }
  if (added.length) {
    S().mutate((d) => {
      d.artworks.push(...added);
      if (!d.coverArtworkId) d.coverArtworkId = added[0].id;
    });
    if (!S().pendingArtworkId) S().setPending(added[0].id);
    const models = added.filter((a) => a.media === 'model').length;
    const videos = added.filter((a) => a.media === 'video').length;
    const extra = [videos && `영상 ${videos}점`, models && `입체 ${models}점은 조각 좌대에 올릴 수 있어요`].filter(Boolean).join(' · ');
    toast(extra ? `작품 ${added.length}점을 보관함에 추가했어요 (${extra})` : `사진 ${added.length}장을 작품 보관함에 추가했어요`, 'success');
  }
  return added;
}

export async function addArtworkFromUrl(url: string): Promise<{ ok: boolean; message?: string }> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, message: 'http:// 또는 https:// 로 시작하는 이미지 주소를 입력하세요' };
  const probe = await probeImageUrl(trimmed);
  if (!probe.ok) {
    return {
      ok: false,
      message:
        probe.reason === 'cors'
          ? '이 이미지는 원본 서버의 보안 정책(CORS) 때문에 3D 전시관에서 쓸 수 없어요. 이미지를 내려받아 ‘사진 업로드’로 올려 주세요.'
          : '이미지를 불러올 수 없어요. 주소가 이미지 파일을 가리키는지 확인하세요.',
    };
  }
  const art: Artwork = {
    id: uid('art'),
    media: 'image',
    source: { kind: 'url', url: trimmed },
    width: probe.width,
    height: probe.height,
    title: decodeURIComponent(trimmed.split('/').pop()?.split('?')[0] ?? '').replace(/\.[^.]+$/, '').slice(0, 60) || '외부 이미지',
    artist: S().doc?.curator ?? '',
    year: '',
    description: '',
    audioBlobId: null,
  };
  S().mutate((d) => {
    d.artworks.push(art);
    if (!d.coverArtworkId) d.coverArtworkId = art.id;
  });
  S().setPending(art.id);
  return { ok: true };
}

export function removeArtwork(id: string) {
  const st = S();
  const doc = st.doc;
  if (!doc) return;
  const used = usageMap(doc).get(id) ?? 0;
  if (used && !confirm(`이 작품은 액자 ${used}곳에 걸려 있어요. 보관함에서 삭제하면 액자는 빈 상태가 됩니다. 삭제할까요?`)) return;
  st.mutate((d) => {
    d.artworks = d.artworks.filter((a) => a.id !== id);
    for (const f of d.floors) {
      for (const w of f.wallItems) if (w.kind === 'frame' && w.artworkId === id) w.artworkId = null;
      for (const p of f.props) if (p.artworkId === id) p.artworkId = null;
    }
    if (d.coverArtworkId === id) d.coverArtworkId = d.artworks[0]?.id ?? null;
  });
  if (st.pendingArtworkId === id) st.setPending(null);
  if (st.selection?.kind === 'artwork' && st.selection.id === id) st.select(null);
}

export function assignArtwork(frameId: string, artworkId: string | null) {
  S().mutateFloor((f) => {
    const w = f.wallItems.find((x) => x.id === frameId);
    if (w && w.kind === 'frame') w.artworkId = artworkId;
  });
  // 방금 건 작품이 '다음에 걸 작품'이었다면 다음 미배치 작품으로
  if (artworkId && S().pendingArtworkId === artworkId) S().setPending(nextUnplaced(S().doc!, artworkId));
}

export function autoHangUnplaced() {
  const st = S();
  const doc = st.doc;
  const floor = currentFloor(st);
  if (!doc || !floor) return;
  const used = usageMap(doc);
  const unplaced = doc.artworks.filter((a) => !used.has(a.id) && isWallMedia(a.media));
  if (!unplaced.length) {
    const models = doc.artworks.filter((a) => !used.has(a.id) && !isWallMedia(a.media)).length;
    toast(models ? `남은 ${models}점은 입체 작품이에요. 소품 도구로 조각 좌대를 놓으면 올라가요.` : '모든 작품이 이미 걸려 있어요');
    return;
  }
  let placed = 0;
  st.mutateFloor((f) => {
    placed = autoHang(f as Floor, unplaced);
  });
  if (placed === 0) toast('이 층에 비어 있는 벽이 없어요. 공간을 넓히거나 칸막이 벽을 추가해 보세요.', 'error');
  else if (placed < unplaced.length) toast(`${placed}점을 걸었어요. 벽이 부족해 ${unplaced.length - placed}점이 남았어요.`);
  else toast(`${placed}점을 빈 벽에 걸었어요`, 'success');
  st.setPending(null);
}

export function addFloor(duplicateCurrent: boolean) {
  const st = S();
  const doc = st.doc;
  if (!doc) return;
  if (doc.floors.length >= MAX_FLOORS) {
    toast(`층은 최대 ${MAX_FLOORS}개까지 만들 수 있어요`, 'error');
    return;
  }
  const cur = currentFloor(st);
  const name = `${doc.floors.length + 1}F`;
  let fl: Floor;
  if (duplicateCurrent && cur) {
    fl = structuredClone(cur);
    fl.id = uid('fl');
    fl.name = name;
    // 구조만 복제: 액자는 비우고 엘리베이터와 소품은 유지
    fl.wallItems = fl.wallItems.filter((w) => w.kind === 'elevator').map((w) => ({ ...w, id: uid('el') }));
    fl.props = fl.props.map((p) => ({ ...p, id: uid('pr') }));
    fl.tourOrder = [];
  } else {
    fl = createFloor(name, cur?.cols ?? 12, cur?.rows ?? 10);
  }
  st.mutate((d) => {
    d.floors.push(fl);
  });
  st.setFloorIndex(doc.floors.length);
}

export function removeFloor(index: number) {
  const st = S();
  const doc = st.doc;
  if (!doc || doc.floors.length <= 1) return;
  const f = doc.floors[index];
  if (!confirm(`${f.name} 층을 삭제할까요? (Ctrl+Z 로 되돌릴 수 있어요)`)) return;
  st.mutate((d) => {
    d.floors.splice(index, 1);
  });
  st.setFloorIndex(Math.max(0, index - 1));
}

export function moveFloor(index: number, dir: -1 | 1) {
  const st = S();
  const doc = st.doc;
  if (!doc) return;
  const to = index + dir;
  if (to < 0 || to >= doc.floors.length) return;
  st.mutate((d) => {
    const [f] = d.floors.splice(index, 1);
    d.floors.splice(to, 0, f);
  });
  st.setFloorIndex(to);
}

export function resizeFloor(cols: number, rows: number) {
  let removed: [number, number] = [0, 0];
  S().mutateFloor((f) => {
    const old = f.cells.slice();
    const oc = f.cols;
    const or = f.rows;
    f.cells = new Array(cols * rows).fill(0);
    for (let j = 0; j < Math.min(rows, or); j++) for (let i = 0; i < Math.min(cols, oc); i++) f.cells[j * cols + i] = old[j * oc + i];
    f.cols = cols;
    f.rows = rows;
    removed = cleanupFloor(f);
  });
  reportCleanup(removed);
}

export function reportCleanup([items, props]: [number, number]) {
  if (items || props) {
    const parts = [items ? `벽 항목 ${items}개` : '', props ? `소품 ${props}개` : ''].filter(Boolean).join(', ');
    toast(`벽/바닥이 사라져 ${parts}가 함께 제거됐어요 (Ctrl+Z 로 되돌리기)`);
  }
}

export function existingItemOnFace(floor: Floor, face: WallFace) {
  const id = faceId(face);
  return floor.wallItems.find((w) => faceId(w) === id && Math.abs(w.offset) < 0.45) ?? null;
}

export function propFootprint(type: keyof typeof PROP_SPEC) {
  return PROP_SPEC[type];
}
