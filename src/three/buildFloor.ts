import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, FRAME_STYLE_SPEC, PEDESTAL_TOP, PROP_SPEC, WALL_THICKNESS } from '../core/constants';
import { buildColliders, type Colliders } from '../core/collision';
import { computeWallEdges, facingCell, isFaceValid, isFilled, mergeWallRuns, wallItemPose, type FacePose } from '../core/grid';
import { tourSequence } from '../core/tour';
import type { Artwork, Exhibition, Floor, FrameItem, FrameStyle, Prop, PropType, TextItem, WallSide } from '../core/types';
import { ArtworkSlot, updateSlotsLod } from './artworkSlot';
import { frameDims, imageGeometry, matGeometry, moldingGeometry, panelGeometry } from './frameGeometry';
import { acquireCaptionTexture, floorIndicatorTexture, releaseCaptionTexture } from './labels';
import { LIGHTING } from './lighting';
import { loadArtworkModel } from './modelArtwork';
import { getLoadedModel, instanceModel, loadModel, withoutSculpture, type ModelName } from './models';
import { aoStripTexture, contactShadowTexture, statusTexture, wallWashTexture } from './proceduralTextures';
import { createLightCone, createSpotLight, MAX_REAL_SPOTS, spotSpec, type SpotRequest } from './spotlights';
import { applyTextureSet, createFloorMaterial, createWallMaterial, floorSetFor, TEXTURE_TILE } from './surfaceMaterials';
import { createWallTextBlock, isEmptyText, wallTextInk } from './wallText';

export interface BuildOptions {
  mode: 'visit' | 'preview';
  /** 미리보기에서 강조할 항목들 */
  selectedIds?: ReadonlySet<string>;
  /** 텍스처 로드 등 비동기 변화가 생겼을 때 (on-demand 렌더링용) */
  onChange?: () => void;
}

/** 관람객이 다가가 감상하는 지점 (작품 액자, 벽 글, 좌대 위 입체 작품) */
export interface StopInfo {
  id: string;
  kind: 'frame' | 'text' | 'object';
  item: FrameItem | TextItem | Prop;
  artwork: Artwork | null;
  pose: FacePose;
  center: THREE.Vector3;
  /** 감상할 때 화면에 함께 담아야 하는 크기 (m, 명제표 포함) */
  viewW: number;
  viewH: number;
}

export interface ElevatorInfo {
  id: string;
  pose: FacePose;
  center: THREE.Vector3;
  doorL: THREE.Object3D | null;
  doorR: THREE.Object3D | null;
  doorBase: [number, number];
  root: THREE.Object3D;
}

export interface FloorScene {
  group: THREE.Group;
  /** 감상 지점 (작품·벽 글) */
  stops: StopInfo[];
  elevators: ElevatorInfo[];
  pickables: THREE.Object3D[];
  floorMesh: THREE.Mesh;
  colliders: Colliders;
  /** 카메라 위치에 따라 가까운 작품만 고해상도 텍스처로 */
  updateLod(cameraPosition: THREE.Vector3): void;
  dispose(): void;
}

/** 박스류 지오메트리에 면 방향 기준 월드 UV 부여 (타일 텍스처용) */
function applyWorldUV(g: THREE.BufferGeometry, tile: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const nx = Math.abs(nor.getX(k));
    const ny = Math.abs(nor.getY(k));
    let u: number;
    let v: number;
    if (ny > 0.5) {
      u = x;
      v = z;
    } else if (nx > 0.5) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[k * 2] = u / tile;
    uv[k * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function quadsGeometry(quads: number[][], up: boolean, tile: number) {
  // quads: [x0, z0, x1, z1, y]
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [x0, z0, x1, z1, y] of quads) {
    const tri = up
      ? [x0, z0, x0, z1, x1, z1, x0, z0, x1, z1, x1, z0]
      : [x0, z0, x1, z1, x0, z1, x0, z0, x1, z0, x1, z1];
    for (let k = 0; k < 6; k++) {
      pos.push(tri[k * 2], y, tri[k * 2 + 1]);
      uv.push(tri[k * 2] / tile, -tri[k * 2 + 1] / tile);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(nonIndexed, false);
  list.forEach((g) => g.dispose());
  nonIndexed.forEach((g) => g.dispose());
  return merged;
}

function darken(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

const PROP_MODEL: Record<PropType, ModelName> = { bench: 'bench', plant: 'plant', pedestal: 'pedestal' };

export function buildFloorScene(ex: Exhibition, floorIndex: number, opts: BuildOptions): FloorScene {
  const floor: Floor = ex.floors[floorIndex];
  const preset = LIGHTING[ex.theme.lighting];
  const group = new THREE.Group();
  group.name = `floor:${floor.name}`;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const changed = () => !disposed && opts.onChange?.();

  const H = floor.wallHeight;
  const T = WALL_THICKNESS;
  const parts = new Set(floor.partitions);
  const edges = computeWallEdges(floor);
  const runs = mergeWallRuns(edges);

  // ── 바닥 / 천장 ─────────────────────────────────────────
  const floorQuads: number[][] = [];
  const ceilQuads: number[][] = [];
  const panelQuads: number[][] = [];
  // 선형 조명 슬롯 (칸마다 x 방향으로 이어지는 띠)
  for (let j = 0; j < floor.rows; j++) {
    for (let i = 0; i < floor.cols; i++) {
      if (!isFilled(floor, i, j)) continue;
      const x0 = i * CELL;
      const z0 = j * CELL;
      floorQuads.push([x0, z0, x0 + CELL, z0 + CELL, 0]);
      ceilQuads.push([x0, z0, x0 + CELL, z0 + CELL, H]);
      panelQuads.push([x0, z0 + CELL / 2 - 0.09, x0 + CELL, z0 + CELL / 2 + 0.09, H - 0.01]);
    }
  }
  const floorMat = createFloorMaterial(ex.theme.floorStyle);
  const floorMesh = new THREE.Mesh(quadsGeometry(floorQuads, true, TEXTURE_TILE[floorSetFor(ex.theme.floorStyle)]), floorMat);
  floorMesh.name = 'floor';
  floorMesh.userData.kind = 'floor';
  group.add(floorMesh);

  if (opts.mode === 'visit') {
    const ceil = new THREE.Mesh(quadsGeometry(ceilQuads, false, 2), new THREE.MeshStandardMaterial({ color: '#f5f4f1', roughness: 0.95 }));
    ceil.name = 'ceiling';
    group.add(ceil);
    const panels = new THREE.Mesh(quadsGeometry(panelQuads, false, 2), new THREE.MeshBasicMaterial({ color: preset.ceilingPanel }));
    panels.name = 'ceiling-panels';
    group.add(panels);
  }

  // ── 벽 / 걸레받이 ──────────────────────────────────────
  const wallGeos: THREE.BufferGeometry[] = [];
  const baseGeos: THREE.BufferGeometry[] = [];
  const wallH = H;
  for (const r of runs) {
    const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const cx = (r.x1 + r.x2) / 2;
    const cz = (r.z1 + r.z2) / 2;
    const horizontal = r.dir === 'h';
    const w = new THREE.BoxGeometry(horizontal ? len + T : T, wallH, horizontal ? T : len + T);
    w.translate(cx, wallH / 2, cz);
    wallGeos.push(w);
    const bh = 0.09;
    const b = new THREE.BoxGeometry(horizontal ? len + T + 0.024 : T + 0.024, bh, horizontal ? T + 0.024 : len + T + 0.024);
    b.translate(cx, bh / 2, cz);
    baseGeos.push(b);
  }
  const wallGeo = merge(wallGeos);
  if (wallGeo) {
    applyWorldUV(wallGeo, TEXTURE_TILE.wall_plaster);
    const walls = new THREE.Mesh(wallGeo, createWallMaterial(ex.theme.wallColor));
    walls.name = 'walls';
    walls.userData.kind = 'wall';
    group.add(walls);
  }
  const baseGeo = merge(baseGeos);
  if (baseGeo) {
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: darken(ex.theme.wallColor, 0.78), roughness: 0.7 }));
    base.name = 'baseboards';
    group.add(base);
  }

  // ── 벽-바닥 AO 띠 ──────────────────────────────────────
  const aoGeos: THREE.BufferGeometry[] = [];
  const AO_W = 0.55;
  for (const e of edges) {
    for (const side of [1, -1] as WallSide[]) {
      const [ci, cj] = facingCell({ edge: e.key, side });
      if (!isFilled(floor, ci, cj)) continue;
      const g = new THREE.PlaneGeometry(CELL, AO_W);
      // Plane: XY → 바닥(XZ)으로 눕히고 v=1(위쪽)이 벽 쪽이 되게
      g.rotateX(-Math.PI / 2); // v=1 쪽이 로컬 -Z
      g.translate(0, 0, AO_W / 2); // v=1 이 z=0(벽면), 방 안쪽(+Z)으로 펼침
      const pose = wallItemPose({ id: '', kind: 'elevator', edge: e.key, side, offset: 0 });
      g.rotateY(pose.rotY);
      g.translate(pose.x, 0.004, pose.z);
      aoGeos.push(g);
    }
  }
  const aoGeo = merge(aoGeos);
  if (aoGeo) {
    // 캔버스 위쪽(진한 쪽)이 v=1 → 벽 쪽
    const ao = new THREE.Mesh(
      aoGeo,
      new THREE.MeshBasicMaterial({ map: aoStripTexture(), transparent: true, depthWrite: false, opacity: opts.mode === 'visit' ? 1 : 0.7 }),
    );
    ao.renderOrder = 1;
    ao.name = 'ao';
    group.add(ao);
  }

  // ── 액자 ───────────────────────────────────────────────
  const stops: StopInfo[] = [];
  const pickables: THREE.Object3D[] = [];
  const moldingByStyle = new Map<FrameStyle, THREE.BufferGeometry[]>();
  const matGeos: THREE.BufferGeometry[] = [];
  const washGeos: THREE.BufferGeometry[] = [];
  const spotWashGeos: THREE.BufferGeometry[] = [];
  const spotRequests: SpotRequest[] = [];
  const lightMatrices: THREE.Matrix4[] = [];
  const artMap = new Map(ex.artworks.map((a) => [a.id, a]));
  const selectionBoxes: THREE.Object3D[] = [];
  const slots: ArtworkSlot[] = [];

  for (const it of floor.wallItems) {
    if (it.kind !== 'frame') continue;
    if (!isFaceValid(floor, it, parts)) continue;
    const art = it.artworkId ? (artMap.get(it.artworkId) ?? null) : null;
    if (!art && opts.mode === 'visit') continue;
    const aspect = art ? art.width / Math.max(1, art.height) : 4 / 3;
    const imageW = it.width;
    const imageH = it.width / aspect;
    const d = frameDims(it.frameStyle, imageW, imageH, it.mat);
    const pose = wallItemPose(it);
    const M = new THREE.Matrix4().compose(
      new THREE.Vector3(pose.x, it.elevation, pose.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.rotY),
      new THREE.Vector3(1, 1, 1),
    );

    if (it.frameStyle === 'none') {
      const g = panelGeometry(d);
      g.applyMatrix4(M);
      if (!moldingByStyle.has('none')) moldingByStyle.set('none', []);
      moldingByStyle.get('none')!.push(g);
    } else {
      const g = moldingGeometry(d);
      g.applyMatrix4(M);
      if (!moldingByStyle.has(it.frameStyle)) moldingByStyle.set(it.frameStyle, []);
      moldingByStyle.get(it.frameStyle)!.push(g);
      const mg = matGeometry(d);
      mg.applyMatrix4(M);
      matGeos.push(mg);
    }

    // 작품 이미지
    const imgMat = new THREE.MeshBasicMaterial({ map: statusTexture(art ? 'loading' : 'empty'), toneMapped: false });
    const img = new THREE.Mesh(imageGeometry(d), imgMat);
    img.applyMatrix4(M);
    img.userData = { kind: 'frame', id: it.id };
    group.add(img);
    pickables.push(img);
    if (art) {
      const slot = new ArtworkSlot(art.source, imgMat, imageW / imageH, new THREE.Vector3(0, 0, d.matZ).applyMatrix4(M), changed, art.media);
      // 편집 미리보기에서는 영상을 재생하지 않고 대표 이미지만
      if (!(art.media === 'video' && opts.mode === 'preview')) slots.push(slot);
      cleanups.push(() => slot.dispose());
    }

    // 캡션 (명제표)
    if (art && it.showCaption) {
      const capTex = acquireCaptionTexture(art.title, art.artist, art.year);
      cleanups.push(() => releaseCaptionTexture(capTex));
      const edgeMat = new THREE.MeshStandardMaterial({ color: '#f4f2ed', roughness: 0.8 });
      const faceMat = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.85 });
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.129, 0.008), [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, edgeMat]);
      const localX = d.outerW / 2 + 0.12 + 0.11;
      const localY = Math.min(1.42, it.elevation) - it.elevation;
      plaque.position.set(localX, localY, 0.004);
      plaque.applyMatrix4(M);
      plaque.userData = { kind: 'frame', id: it.id };
      group.add(plaque);
      pickables.push(plaque);
    }

    const center = new THREE.Vector3(0, 0, d.matZ).applyMatrix4(M);
    const light = it.light ?? 'normal';
    if (light !== 'off') {
      // 벽에 떨어지는 빛 (스포트라이트는 작품 둘레로 좁고 밝게)
      const spot = light === 'spot';
      const ww = spot ? d.outerW * 1.2 + 0.45 : d.outerW * 1.45 + 0.9;
      const wh = spot ? d.outerH * 1.2 + 0.45 : d.outerH * 1.45 + 0.9;
      const wg = new THREE.PlaneGeometry(ww, wh);
      wg.translate(0, spot ? 0.05 : 0.12, 0.003);
      wg.applyMatrix4(M);
      (spot ? spotWashGeos : washGeos).push(wg);

      // 천장 트랙 조명
      lightMatrices.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(pose.x + pose.nx * 1.3, H, pose.z + pose.nz * 1.3),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.rotY),
          new THREE.Vector3(1, 1, 1),
        ),
      );
      if (spot) spotRequests.push({ from: new THREE.Vector3(pose.x + pose.nx * 1.3, H - 0.16, pose.z + pose.nz * 1.3), to: center.clone(), radius: Math.hypot(d.outerW, d.outerH) / 2 + 0.15 });
    }

    stops.push({ id: it.id, kind: 'frame', item: it, artwork: art, pose, center, viewW: d.outerW + (it.showCaption ? 0.9 : 0), viewH: d.outerH });

    if (opts.selectedIds?.has(it.id)) {
      selectionBoxes.push(outline([-d.outerW / 2 - 0.03, -d.outerH / 2 - 0.03, 0], [d.outerW / 2 + 0.03, d.outerH / 2 + 0.03, d.depth + 0.03], M));
    }
  }

  // ── 작품별 스포트라이트 ─────────────────────────────────
  const spotWashGeo = merge(spotWashGeos);
  if (spotWashGeo) {
    const sw = new THREE.Mesh(
      spotWashGeo,
      new THREE.MeshBasicMaterial({
        map: wallWashTexture(),
        color: preset.washColor,
        transparent: true,
        opacity: spotSpec(ex.theme.lighting).wash,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sw.renderOrder = 2;
    sw.name = 'spot-wash';
    group.add(sw);
  }
  spotRequests.forEach((req, k) => {
    if (opts.mode === 'visit') group.add(createLightCone(req, preset.washColor, ex.theme.lighting));
    // 실제 조명은 몇 개만 (많으면 셰이더가 무거워진다)
    if (k < MAX_REAL_SPOTS) {
      const sl = createSpotLight(req, preset.washColor, ex.theme.lighting);
      group.add(sl, sl.target);
      cleanups.push(() => sl.dispose());
    }
  });

  // ── 벽 글 ─────────────────────────────────────────────
  for (const it of floor.wallItems) {
    if (it.kind !== 'text' || !isFaceValid(floor, it, parts)) continue;
    const empty = isEmptyText(it);
    if (empty && opts.mode === 'visit') continue;
    const pose = wallItemPose(it);
    const block = empty
      ? createWallTextBlock({ ...it, title: '벽 글 (내용 없음)', body: '' }, '#a39e94', changed)
      : createWallTextBlock(it, wallTextInk(it, ex.theme.wallColor), changed);
    cleanups.push(() => block.dispose());
    // 바닥/천장을 뚫지 않게 중심 높이 보정
    const half = block.height / 2;
    const y = half * 2 > H - 0.5 ? H / 2 : THREE.MathUtils.clamp(it.elevation, 0.3 + half, H - 0.2 - half);
    const M = new THREE.Matrix4().compose(
      new THREE.Vector3(pose.x, y, pose.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.rotY),
      new THREE.Vector3(1, 1, 1),
    );
    const geo = new THREE.PlaneGeometry(block.width, block.height);
    geo.translate(0, 0, 0.004);
    const mat = new THREE.MeshStandardMaterial({ map: block.texture, transparent: true, roughness: 0.92, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.applyMatrix4(M);
    mesh.renderOrder = 3;
    mesh.userData = { kind: 'text', id: it.id };
    group.add(mesh);
    pickables.push(mesh);
    if (!empty) {
      const wg = new THREE.PlaneGeometry(block.width * 1.3 + 0.8, block.height * 1.3 + 0.8);
      wg.translate(0, 0.08, 0.003);
      wg.applyMatrix4(M);
      washGeos.push(wg);
      const center = new THREE.Vector3(0, 0, 0.004).applyMatrix4(M);
      stops.push({ id: it.id, kind: 'text', item: it, artwork: null, pose, center, viewW: block.width + 0.3, viewH: block.height + 0.3 });
    }
    if (opts.selectedIds?.has(it.id)) {
      selectionBoxes.push(outline([-block.width / 2 - 0.05, -half - 0.05, 0], [block.width / 2 + 0.05, half + 0.05, 0.04], M));
    }
  }

  for (const [style, list] of moldingByStyle) {
    const g = merge(list);
    if (!g) continue;
    const spec = FRAME_STYLE_SPEC[style];
    const mat = new THREE.MeshStandardMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness });
    if (style === 'oak') applyTextureSet(mat, 'frame_oak');
    const m = new THREE.Mesh(g, mat);
    m.name = `frames:${style}`;
    group.add(m);
  }
  const matGeo = merge(matGeos);
  if (matGeo) {
    const m = new THREE.Mesh(matGeo, new THREE.MeshStandardMaterial({ color: '#f7f6f2', roughness: 0.92 }));
    m.name = 'mats';
    group.add(m);
  }
  const washGeo = merge(washGeos);
  if (washGeo) {
    const wash = new THREE.Mesh(
      washGeo,
      new THREE.MeshBasicMaterial({
        map: wallWashTexture(),
        color: preset.washColor,
        transparent: true,
        opacity: preset.wash,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    wash.renderOrder = 2;
    wash.name = 'wall-wash';
    group.add(wash);
  }

  // ── 좌대 위 입체 작품 ──────────────────────────────────
  function addSculpture(p: Prop, art: Artwork) {
    const holder = new THREE.Group();
    holder.position.set(p.x, PEDESTAL_TOP, p.z);
    holder.rotation.y = p.rotation;
    holder.userData = { kind: 'object', id: p.id };
    group.add(holder);
    // 모델이 로드되기 전에도 클릭되도록 보이지 않는 판정 상자
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, PEDESTAL_TOP + p.artHeight, 0.6), new THREE.MeshBasicMaterial());
    hit.position.y = (p.artHeight - PEDESTAL_TOP) / 2;
    hit.visible = false;
    holder.add(hit);
    pickables.push(holder);
    void loadArtworkModel(art.source)
      .then((tpl) => {
        if (disposed) return;
        const obj = tpl.clone(true);
        obj.traverse((o) => (o.userData.shared = true));
        obj.scale.setScalar(p.artHeight);
        holder.add(obj);
        changed();
      })
      .catch(() => {
        if (disposed) return;
        // 모델을 못 읽으면 자리 표시
        const ph = new THREE.Mesh(new THREE.BoxGeometry(0.3, p.artHeight, 0.3), new THREE.MeshStandardMaterial({ color: '#c9c3b8', roughness: 0.8 }));
        ph.position.y = p.artHeight / 2;
        holder.add(ph);
        changed();
      });
    const s = Math.sin(p.rotation);
    const c = Math.cos(p.rotation);
    const pose: FacePose = { x: p.x, z: p.z, nx: s, nz: c, rx: c, rz: -s, rotY: p.rotation };
    const center = new THREE.Vector3(p.x, PEDESTAL_TOP + p.artHeight / 2, p.z);
    stops.push({ id: p.id, kind: 'object', item: p, artwork: art, pose, center, viewW: Math.max(0.8, p.artHeight * 1.2), viewH: p.artHeight + 0.5 });
  }

  // ── 비동기 모델 (조명, 소품, 엘리베이터) ────────────────
  const whenModel = (name: ModelName, fn: (tpl: THREE.Object3D) => void) => {
    const tpl = getLoadedModel(name);
    if (tpl) fn(tpl);
    else
      void loadModel(name).then((t) => {
        if (disposed) return;
        fn(t);
        changed();
      });
  };

  if (lightMatrices.length && opts.mode === 'visit') {
    whenModel('track_light', (tpl) => {
      const inst = instanceModel(tpl, lightMatrices);
      inst.name = 'track-lights';
      group.add(inst);
    });
  }

  // 소품 (입체 작품을 올린 좌대는 기본 장식 조각을 뺀 모델로)
  const byType = new Map<PropType | 'plinth', THREE.Matrix4[]>();
  const shadowGeos: THREE.BufferGeometry[] = [];
  for (const p of floor.props) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, 0, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation),
      new THREE.Vector3(1, 1, 1),
    );
    const art = p.type === 'pedestal' && p.artworkId ? artMap.get(p.artworkId) : undefined;
    const key = art?.media === 'model' ? 'plinth' : p.type;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(m);
    if (art?.media === 'model') addSculpture(p, art);
    const spec = PROP_SPEC[p.type];
    const sg = new THREE.PlaneGeometry(spec.w * 1.25 + 0.2, spec.d * 1.25 + 0.2);
    sg.rotateX(-Math.PI / 2);
    sg.translate(0, 0.006, 0);
    sg.applyMatrix4(m);
    shadowGeos.push(sg);
    if (opts.selectedIds?.has(p.id)) {
      selectionBoxes.push(outline([-spec.w / 2, 0, -spec.d / 2], [spec.w / 2, 1.2, spec.d / 2], m));
    }
  }
  const shadowGeo = merge(shadowGeos);
  if (shadowGeo) {
    const sh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }));
    sh.renderOrder = 1;
    sh.name = 'contact-shadows';
    group.add(sh);
  }
  for (const [type, mats] of byType) {
    whenModel(type === 'plinth' ? 'pedestal' : PROP_MODEL[type], (tpl) => {
      const inst = instanceModel(type === 'plinth' ? withoutSculpture(tpl) : tpl, mats);
      inst.name = `props:${type}`;
      group.add(inst);
    });
  }

  // 엘리베이터
  const elevators: ElevatorInfo[] = [];
  for (const it of floor.wallItems) {
    if (it.kind !== 'elevator' || !isFaceValid(floor, it, parts)) continue;
    const pose = wallItemPose(it);
    const holder = new THREE.Group();
    // 엘리베이터 모델 원점 = 벽 표면 하단 중앙
    holder.position.set(pose.x, 0, pose.z);
    holder.rotation.y = pose.rotY;
    holder.userData = { kind: 'elevator', id: it.id };
    group.add(holder);
    pickables.push(holder);
    const info: ElevatorInfo = {
      id: it.id,
      pose,
      center: new THREE.Vector3(pose.x, 1.2, pose.z),
      doorL: null,
      doorR: null,
      doorBase: [0, 0],
      root: holder,
    };
    elevators.push(info);
    whenModel('elevator', (tpl) => {
      const obj = tpl.clone(true);
      obj.traverse((o) => (o.userData.shared = true));
      holder.add(obj);
      info.doorL = obj.getObjectByName('DoorL') ?? null;
      info.doorR = obj.getObjectByName('DoorR') ?? null;
      info.doorBase = [info.doorL?.position.x ?? 0, info.doorR?.position.x ?? 0];
      const ind = tpl.getObjectByName('Indicator');
      if (ind) {
        // 템플릿은 씬에 붙지 않으므로 월드 = 모델 로컬 좌표
        tpl.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(ind);
        const c = bb.getCenter(new THREE.Vector3());
        const w = Math.max(0.12, (bb.max.x - bb.min.x) * 0.92);
        const h = Math.max(0.04, (bb.max.y - bb.min.y) * 0.85);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: floorIndicatorTexture(floor.name), toneMapped: false }));
        plane.position.set(c.x, c.y, bb.max.z + 0.002);
        holder.add(plane);
      }
    });
    if (opts.selectedIds?.has(it.id)) {
      selectionBoxes.push(outline([-1, 0, 0], [1, 2.75, 0.15], new THREE.Matrix4().compose(holder.position, holder.quaternion, new THREE.Vector3(1, 1, 1))));
    }
  }

  for (const s of selectionBoxes) {
    s.userData.helper = true;
    group.add(s);
  }

  const colliders = buildColliders(floor, runs);

  // 감상 순서대로 정렬 (순서 밖 항목은 뒤로)
  const rank = new Map(tourSequence(floor).map((id, k) => [id, k]));
  stops.sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));

  const updateLod = (cam: THREE.Vector3) => {
    if (!disposed && slots.length) updateSlotsLod(slots, cam);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanups.forEach((c) => c());
    group.traverse((o) => {
      if (o.userData.shared) return;
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) m.dispose();
    });
    group.removeFromParent();
  };

  return { group, stops, elevators, pickables, floorMesh, colliders, updateLod, dispose };
}

/** 미리보기 선택 강조용 외곽선 박스 */
function outline(min: number[], max: number[], m: THREE.Matrix4): THREE.LineSegments {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const edges = new THREE.EdgesGeometry(g);
  g.dispose();
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ff5a1f', depthTest: false }));
  line.renderOrder = 10;
  line.applyMatrix4(m);
  return line;
}
