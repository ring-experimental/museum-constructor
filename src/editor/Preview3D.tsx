import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL } from '../core/constants';
import { filledCells, floorCentroid } from '../core/grid';
import { buildFloorScene, type FloorScene } from '../three/buildFloor';
import { Stage } from '../three/Stage';
import { useEditor } from './store';

/** 편집 중인 층을 위에서 내려다보는 실시간 3D 미리보기 (천장 제거) */
export function Preview3D() {
  const ref = useRef<HTMLDivElement>(null);
  const engine = useRef<{ stage: Stage; controls: OrbitControls; scene: FloorScene | null; floorId: string | null } | null>(null);
  const doc = useEditor((s) => s.doc);
  const floorIndex = useEditor((s) => s.floorIndex);
  const selection = useEditor((s) => s.selection);

  useEffect(() => {
    const el = ref.current!;
    const stage = new Stage(el, { renderMode: 'demand', fov: 45 });
    const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 3;
    controls.maxDistance = 120;
    controls.addEventListener('change', stage.invalidate);
    const off = stage.onUpdate(() => {
      if (controls.update()) stage.invalidate();
    });

    // 클릭으로 액자 선택
    let down: { x: number; y: number } | null = null;
    const dom = stage.renderer.domElement;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const sc = engine.current?.scene;
      if (!sc) return;
      const r = dom.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
      const hit = ray.intersectObjects(sc.pickables, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.kind) o = o.parent;
      if (o?.userData.id) useEditor.getState().select({ kind: 'wallItem', id: o.userData.id });
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);

    engine.current = { stage, controls, scene: null, floorId: null };
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      off();
      engine.current?.scene?.dispose();
      controls.dispose();
      stage.dispose();
      engine.current = null;
    };
  }, []);

  // 문서 변경 → 디바운스 후 재구성
  useEffect(() => {
    const e = engine.current;
    if (!e || !doc) return;
    const idx = Math.min(floorIndex, doc.floors.length - 1);
    const floor = doc.floors[idx];
    if (!floor) return;
    const t = setTimeout(() => {
      e.scene?.dispose();
      e.stage.setLighting(doc.theme.lighting === 'dramatic' ? 'dramatic' : doc.theme.lighting);
      e.stage.setBackground('#e7e4de');
      const sc = buildFloorScene(doc, idx, {
        mode: 'preview',
        selectedId: selection && 'id' in selection ? selection.id : null,
        onChange: e.stage.invalidate,
      });
      e.stage.scene.add(sc.group);
      e.scene = sc;
      if (e.floorId !== floor.id) {
        e.floorId = floor.id;
        // 칠해진 바닥 전체가 화면에 들어오도록 거리 계산
        const c = floorCentroid(floor);
        let r = 0;
        for (const [i, j] of filledCells(floor)) r = Math.max(r, Math.hypot((i + 0.5) * CELL - c.x, (j + 0.5) * CELL - c.z) + CELL * 0.75);
        if (!r) r = (Math.max(floor.cols, floor.rows) * CELL) / 2;
        const cam = e.stage.camera;
        const vfov = THREE.MathUtils.degToRad(cam.fov);
        const dist = (r / Math.sin(vfov / 2)) * Math.max(1, 1 / cam.aspect) * 0.85;
        const dir = new THREE.Vector3(0.3, 0.78, 0.55).normalize();
        e.controls.target.set(c.x, 0, c.z);
        cam.position.set(c.x + dir.x * dist, dir.y * dist, c.z + dir.z * dist);
        e.controls.update();
      }
      e.stage.invalidate();
    }, 90);
    return () => clearTimeout(t);
  }, [doc, floorIndex, selection]);

  return <div className="preview3d" ref={ref} aria-label="3D 미리보기 (드래그: 회전, 휠: 확대)" />;
}
