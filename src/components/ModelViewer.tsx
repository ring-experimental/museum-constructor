import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ArtworkSource } from '../core/types';
import { loadArtworkModel } from '../three/modelArtwork';
import { Stage } from '../three/Stage';

/** 입체 작품을 돌려 보는 뷰어 (드래그 회전, 휠 확대) */
export function ModelViewer({ source, className }: { source: ArtworkSource; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const el = ref.current!;
    const stage = new Stage(el, { renderMode: 'always', fov: 35 });
    stage.setLighting('bright');
    stage.setBackground('#1b1b1d');
    const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.enablePan = false;
    const off = stage.onUpdate(() => controls.update());
    // 처음 만지면 자동 회전을 멈춘다
    const stop = () => (controls.autoRotate = false);
    stage.renderer.domElement.addEventListener('pointerdown', stop);
    let alive = true;
    loadArtworkModel(source)
      .then((tpl) => {
        if (!alive) return;
        const obj = tpl.clone(true);
        stage.scene.add(obj);
        // 정규화된 모델은 높이 1, 바닥 중심이 원점
        const box = new THREE.Box3().setFromObject(obj);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(stage.camera.fov / 2)) * 1.1;
        controls.target.copy(sphere.center);
        stage.camera.position.copy(sphere.center).add(new THREE.Vector3(0.5, 0.35, 1).normalize().multiplyScalar(dist));
        controls.minDistance = sphere.radius * 1.2;
        controls.maxDistance = dist * 3;
        controls.update();
        setState('ready');
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
      off();
      stage.renderer.domElement.removeEventListener('pointerdown', stop);
      controls.dispose();
      stage.dispose();
    };
  }, [source]);

  return (
    <div className={`model-viewer ${className ?? ''}`} ref={ref}>
      {state === 'loading' && <p className="model-viewer__msg">3D 작품을 불러오는 중…</p>}
      {state === 'error' && <p className="model-viewer__msg">3D 작품을 불러오지 못했어요</p>}
    </div>
  );
}
