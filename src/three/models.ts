import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { publicUrl } from '../publicUrl';

/**
 * Blender 로 제작한 소품 모델 (tools/blender/build_props.py → public/assets/models).
 * 로딩에 실패하면 단순한 대체 도형을 쓴다.
 */
export type ModelName = 'bench' | 'plant' | 'pedestal' | 'track_light' | 'elevator';

const URLS: Record<ModelName, string> = {
  bench: publicUrl('assets/models/bench.glb'),
  plant: publicUrl('assets/models/plant.glb'),
  pedestal: publicUrl('assets/models/pedestal.glb'),
  track_light: publicUrl('assets/models/track_light.glb'),
  elevator: publicUrl('assets/models/elevator.glb'),
};

const loader = new GLTFLoader();
const cache = new Map<ModelName, Promise<THREE.Object3D>>();
const ready = new Map<ModelName, THREE.Object3D>();

function std(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function fallback(name: ModelName): THREE.Object3D {
  const g = new THREE.Group();
  switch (name) {
    case 'bench': {
      const wood = std('#b98a5a');
      const metal = std('#2b2b2b', { metalness: 0.6, roughness: 0.45 });
      g.add(box(1.8, 0.06, 0.5, wood, 0, 0.42, 0));
      g.add(box(0.04, 0.39, 0.44, metal, -0.72, 0.195, 0));
      g.add(box(0.04, 0.39, 0.44, metal, 0.72, 0.195, 0));
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.45, 24), std('#ece8e1', { roughness: 0.85 }));
      pot.position.y = 0.225;
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), std('#3f6b3a', { flatShading: true }));
      leaves.position.y = 1.0;
      leaves.scale.set(1, 1.2, 1);
      g.add(pot, leaves);
      break;
    }
    case 'pedestal': {
      g.add(box(0.5, 0.95, 0.5, std('#f2f0ec', { roughness: 0.8 }), 0, 0.475, 0));
      const sc = new THREE.Mesh(new THREE.TorusKnotGeometry(0.1, 0.035, 96, 12), std('#8c6239', { metalness: 1, roughness: 0.3 }));
      sc.name = 'Sculpture';
      sc.position.y = 1.12;
      g.add(sc);
      break;
    }
    case 'track_light': {
      const body = std('#1a1a1a');
      g.add(box(0.08, 0.05, 0.08, body, 0, -0.025, 0));
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 16), body);
      head.position.set(0, -0.14, -0.02);
      head.rotation.x = -Math.PI / 2 + 1.0;
      g.add(head);
      break;
    }
    case 'elevator': {
      const clad = std('#5d5953');
      const steel = std('#b8bcc0', { metalness: 1, roughness: 0.35 });
      g.add(box(0.45, 2.7, 0.08, clad, -0.725, 1.35, 0.04));
      g.add(box(0.45, 2.7, 0.08, clad, 0.725, 1.35, 0.04));
      g.add(box(1.0, 0.5, 0.08, clad, 0, 2.45, 0.04));
      const l = box(0.5, 2.2, 0.03, steel, -0.25, 1.1, 0.035);
      l.name = 'DoorL';
      const r = box(0.5, 2.2, 0.03, steel, 0.25, 1.1, 0.035);
      r.name = 'DoorR';
      const cab = box(1.0, 2.2, 0.005, new THREE.MeshStandardMaterial({ color: '#fff4e0', emissive: '#fff4e0', emissiveIntensity: 1 }), 0, 1.1, 0.005);
      cab.name = 'CabLight';
      g.add(l, r, cab);
      break;
    }
  }
  return g;
}

function prepare(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
  return root;
}

export function loadModel(name: ModelName): Promise<THREE.Object3D> {
  let p = cache.get(name);
  if (!p) {
    p = loader
      .loadAsync(URLS[name])
      .then((gltf) => prepare(gltf.scene))
      .catch((err) => {
        console.warn(`[models] ${name}.glb 로드 실패 — 대체 도형 사용`, err);
        return prepare(fallback(name));
      })
      .then((obj) => {
        ready.set(name, obj);
        return obj;
      });
    cache.set(name, p);
  }
  return p;
}

export function preloadModels() {
  return Promise.all((Object.keys(URLS) as ModelName[]).map(loadModel));
}

/** 이미 로드된 모델 (없으면 null) */
export function getLoadedModel(name: ModelName): THREE.Object3D | null {
  return ready.get(name) ?? null;
}

const plinthCache = new WeakMap<THREE.Object3D, THREE.Object3D>();

/** 기본 장식 조각을 뺀 좌대 (사용자 입체 작품을 올릴 때) */
export function withoutSculpture(template: THREE.Object3D): THREE.Object3D {
  let c = plinthCache.get(template);
  if (!c) {
    c = template.clone(true);
    const remove: THREE.Object3D[] = [];
    c.traverse((o) => {
      if (/sculpt/i.test(o.name)) remove.push(o);
    });
    remove.forEach((o) => o.removeFromParent());
    plinthCache.set(template, c);
  }
  return c;
}

/**
 * 같은 모델을 여러 번 배치할 때 InstancedMesh 로 묶어 드로우콜을 줄인다.
 */
export function instanceModel(template: THREE.Object3D, matrices: THREE.Matrix4[]): THREE.Group {
  const group = new THREE.Group();
  if (!matrices.length) return group;
  template.updateMatrixWorld(true);
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    const local = mesh.matrixWorld;
    const tmp = new THREE.Matrix4();
    matrices.forEach((m, k) => inst.setMatrixAt(k, tmp.multiplyMatrices(m, local)));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.userData.shared = true;
    group.add(inst);
  });
  return group;
}
