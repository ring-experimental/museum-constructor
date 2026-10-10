import * as THREE from 'three';
import type { Stage } from '../three/Stage';
import type { VisitorController } from './VisitorController';

/**
 * VR(WebXR) 관람.
 *  - 컨트롤러로 바닥을 가리키고 트리거 → 그곳으로 순간이동
 *  - 작품을 가리키고 트리거 → 작품 앞으로, 엘리베이터 → 다른 층
 *  - 왼쪽 스틱: 이동 / 오른쪽 스틱: 30° 스냅 회전
 */

const SNAP = Math.PI / 6;
const MOVE_SPEED = 1.6;
const DEADZONE = 0.25;

export async function isVRSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

export class XRSupport {
  private controllers: THREE.XRTargetRaySpace[] = [];
  private raycaster = new THREE.Raycaster();
  private reticle: THREE.Mesh;
  private session: XRSession | null = null;
  private turnReady = true;
  private tmpQuat = new THREE.Quaternion();
  private tmpDir = new THREE.Vector3();
  private rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

  constructor(
    private readonly stage: Stage,
    private readonly ctl: VisitorController,
    private readonly onPresentChange: (presenting: boolean) => void,
  ) {
    const xr = stage.renderer.xr;
    for (let i = 0; i < 2; i++) {
      const c = xr.getController(i);
      const ray = new THREE.Line(this.rayGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
      ray.scale.z = 6;
      ray.name = 'xr-ray';
      ray.visible = false;
      c.add(ray);
      c.addEventListener('connected', () => (ray.visible = true));
      c.addEventListener('disconnected', () => (ray.visible = false));
      c.addEventListener('select', () => this.select(c));
      stage.rig.add(c);
      this.controllers.push(c);
    }
    const ring = new THREE.RingGeometry(0.16, 0.22, 40);
    ring.rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }));
    this.reticle.visible = false;
    this.reticle.renderOrder = 6;
    stage.scene.add(this.reticle);
  }

  get presenting() {
    return !!this.session;
  }

  async enter() {
    if (!navigator.xr || this.session) return;
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    this.session = session;
    session.addEventListener('end', () => {
      this.session = null;
      this.reticle.visible = false;
      this.ctl.setXR(null);
      this.stage.resize();
      this.onPresentChange(false);
    });
    await this.stage.renderer.xr.setSession(session);
    this.ctl.setXR(this.stage.rig);
    this.onPresentChange(true);
  }

  exit() {
    void this.session?.end();
  }

  private aim(c: THREE.Object3D) {
    c.updateMatrixWorld();
    this.raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyQuaternion(c.getWorldQuaternion(this.tmpQuat)).normalize();
    return this.ctl.pickWith(this.raycaster);
  }

  private select(c: THREE.Object3D) {
    if (!this.session) return;
    this.ctl.activate(this.aim(c));
  }

  /** 매 프레임: 바닥 겨냥 표시 + 스틱 이동/회전 */
  update(dt: number) {
    if (!this.session) return;
    this.reticle.visible = false;
    for (const c of this.controllers) {
      const hit = this.aim(c);
      if (hit?.kind === 'floor') {
        this.reticle.position.set(hit.point.x, 0.015, hit.point.z);
        this.reticle.visible = true;
        break;
      }
    }
    for (const source of this.session.inputSources) {
      const axes = source.gamepad?.axes;
      if (!axes || axes.length < 4) continue;
      const x = axes[2];
      const y = axes[3];
      if (source.handedness === 'right') {
        // 스냅 회전: 스틱을 한 번 젖힐 때마다 30°
        if (Math.abs(x) > 0.7 && this.turnReady) {
          this.ctl.turnBy(x > 0 ? -SNAP : SNAP);
          this.turnReady = false;
        } else if (Math.abs(x) < 0.3) this.turnReady = true;
      } else if (Math.hypot(x, y) > DEADZONE) {
        // 머리가 향한 방향 기준으로 수평 이동
        this.stage.camera.getWorldDirection(this.tmpDir);
        this.tmpDir.y = 0;
        if (this.tmpDir.lengthSq() < 1e-6) continue;
        this.tmpDir.normalize();
        const fx = this.tmpDir.x;
        const fz = this.tmpDir.z;
        // 오른쪽 = 전방을 시계방향 90°
        const rx = -fz;
        const rz = fx;
        const k = MOVE_SPEED * dt;
        this.ctl.moveBy((fx * -y + rx * x) * k, (fz * -y + rz * x) * k);
      }
    }
  }

  dispose() {
    this.exit();
    for (const c of this.controllers) {
      c.traverse((o) => {
        const l = o as THREE.Line;
        if (l.isLine) (l.material as THREE.Material).dispose();
      });
      c.removeFromParent();
    }
    this.rayGeo.dispose();
    this.reticle.geometry.dispose();
    (this.reticle.material as THREE.Material).dispose();
    this.reticle.removeFromParent();
  }
}
