import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ArtworkSource } from '../core/types';
import { imageRepo } from '../storage/imageRepo';

/**
 * 입체 작품(GLB) 로딩.
 * 모델을 '바닥 중심이 원점, 높이 1' 로 정규화해 두면, 좌대 위에서는 원하는 높이만큼 scale 만 하면 된다.
 */

/** 업로드할 수 있는 최대 크기 */
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

export function isModelFile(file: File) {
  return /\.glb$/i.test(file.name) || file.type === 'model/gltf-binary';
}

/** GLB 바이트 → 높이 1, 바닥 중심 원점으로 맞춘 오브젝트 */
export async function parseModel(buf: ArrayBuffer): Promise<THREE.Object3D> {
  const gltf = await loader.parseAsync(buf, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) throw new Error('모델에 보이는 형상이 없어요');
  const size = box.getSize(new THREE.Vector3());
  const h = size.y > 1e-6 ? size.y : Math.max(size.x, size.z, 1e-3);
  const inner = new THREE.Group();
  inner.add(scene);
  scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const root = new THREE.Group();
  root.add(inner);
  inner.scale.setScalar(1 / h);
  root.userData.footprint = Math.max(size.x, size.z) / h;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
  return root;
}

/** 작품 모델 (같은 파일은 한 번만 읽고, 쓰는 곳마다 clone) */
export function loadArtworkModel(source: ArtworkSource): Promise<THREE.Object3D> {
  if (source.kind !== 'upload') return Promise.reject(new Error('입체 작품은 업로드한 파일만 쓸 수 있어요'));
  let p = cache.get(source.blobId);
  if (!p) {
    p = imageRepo.get(source.blobId).then(async (rec) => {
      if (!rec) throw new Error('모델 파일을 찾을 수 없어요');
      return parseModel(await rec.blob.arrayBuffer());
    });
    p.catch(() => cache.delete(source.blobId));
    cache.set(source.blobId, p);
  }
  return p;
}

/** 모델 미리보기 이미지 (보관함 썸네일·목록 표지용) */
export async function renderModelThumbnail(model: THREE.Object3D, size = 512): Promise<Blob> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#efede8');
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.9;
    scene.add(new THREE.HemisphereLight('#ffffff', '#d9d4ca', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const obj = model.clone(true);
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.05;
    const dir = new THREE.Vector3(0.55, 0.42, 1).normalize();
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.lookAt(sphere.center);
    renderer.render(scene, cam);
    env.dispose();
    return await new Promise<Blob>((resolve, reject) =>
      renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('미리보기를 만들지 못했어요'))), 'image/jpeg', 0.88),
    );
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** 오브젝트가 가진 GPU 자원을 정리 (미리보기 렌더 뒤처럼 다시 안 쓸 때) */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/** GLB 파일을 검사하고 미리보기 이미지를 만든다 */
export async function prepareModelFile(file: File): Promise<{ blob: Blob; thumb: Blob; size: number }> {
  if (file.size > MODEL_MAX_BYTES) throw new Error(`3D 모델은 ${MODEL_MAX_BYTES / 1024 / 1024}MB 이하만 올릴 수 있어요`);
  const buf = await file.arrayBuffer();
  let model: THREE.Object3D;
  try {
    model = await parseModel(buf);
  } catch {
    throw new Error('GLB 3D 모델을 읽을 수 없어요 (텍스처가 포함된 .glb 파일인지 확인하세요)');
  }
  try {
    const thumb = await renderModelThumbnail(model);
    return { blob: new Blob([buf], { type: 'model/gltf-binary' }), thumb, size: 512 };
  } finally {
    disposeObject(model);
  }
}
