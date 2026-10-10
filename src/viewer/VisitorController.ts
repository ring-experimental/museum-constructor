import * as THREE from 'three';
import { EYE_HEIGHT, PLAYER_RADIUS } from '../core/constants';
import { isPathBlocked, resolveCircle, type Colliders } from '../core/collision';
import type { FloorScene, StopInfo } from '../three/buildFloor';

export interface ControllerEvents {
  onStopClick(stop: StopInfo): void;
  onElevatorClick(id: string): void;
  onMoveStart(): void;
  onNearElevator(id: string | null): void;
}

type Mode = { kind: 'free' } | { kind: 'walkTo'; x: number; z: number } | { kind: 'tween'; t: number; dur: number; from: Pose; to: Pose; fade: boolean; done?: () => void };

interface Pose {
  x: number;
  z: number;
  y: number;
  yaw: number;
  pitch: number;
}

const WALK_SPEED = 2.4;
const RUN_SPEED = 4.2;
const LOOK_SPEED = 0.0042;
const MAX_PITCH = 1.15;

function angleLerp(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * 1인칭 관람 컨트롤러.
 * - 드래그로 둘러보기 (포인터락 없이 접근성 우선)
 * - WASD / 방향키 이동, Shift 달리기
 * - 바닥 클릭 → 해당 위치로 걸어가기
 * - 작품 클릭 → 작품 앞으로 이동해 감상
 */
export class VisitorController {
  x = 0;
  z = 0;
  y = EYE_HEIGHT;
  yaw = 0;
  pitch = 0;
  private mode: Mode = { kind: 'free' };
  private keys = new Set<string>();
  private pointer: { id: number; x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private raycaster = new THREE.Raycaster();
  private colliders: Colliders = { segments: [], boxes: [] };
  private floor: FloorScene | null = null;
  private nearElevator: string | null = null;
  /** 0..1 화면 페이드 (방 사이 순간이동 시) */
  fade = 0;
  enabled = true;
  readonly cursor: THREE.Mesh;
  /** VR 관람 중: 위치·방향은 카메라 받침대(rig)로 옮기고, 머리 움직임은 기기가 맡는다 */
  private xr: { rig: THREE.Object3D } | null = null;

  get xrActive() {
    return !!this.xr;
  }

  setXR(rig: THREE.Object3D | null) {
    if (!rig && this.xr) {
      this.xr.rig.position.set(0, 0, 0);
      this.xr.rig.rotation.set(0, 0, 0);
    }
    this.xr = rig ? { rig } : null;
    this.mode = { kind: 'free' };
    this.pitch = 0;
    this.apply();
  }

  /** VR: 받침대를 세계 좌표로 이동 (벽·소품 충돌 반영) */
  moveBy(dx: number, dz: number) {
    [this.x, this.z] = resolveCircle(this.x + dx, this.z + dz, PLAYER_RADIUS, this.colliders);
    this.apply();
  }

  /** VR: 제자리 회전 (스냅 턴) */
  turnBy(dYaw: number) {
    this.yaw += dYaw;
    this.apply();
  }

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly events: ControllerEvents,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    const ring = new THREE.RingGeometry(0.18, 0.24, 40);
    ring.rotateX(-Math.PI / 2);
    this.cursor = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false }));
    this.cursor.renderOrder = 5;
  }

  setFloor(floor: FloorScene) {
    this.floor = floor;
    this.colliders = floor.colliders;
    floor.group.add(this.cursor);
    this.mode = { kind: 'free' };
  }

  teleport(x: number, z: number, yaw: number, pitch = 0) {
    [this.x, this.z] = resolveCircle(x, z, PLAYER_RADIUS, this.colliders);
    this.yaw = yaw;
    this.pitch = pitch;
    this.y = EYE_HEIGHT;
    this.mode = { kind: 'free' };
    this.apply();
  }

  get busy() {
    return this.mode.kind === 'tween';
  }

  /** 정보 패널이 가리는 부분을 뺀, 작품이 보일 화면 비율 */
  availW = 1;
  availH = 1;

  /** 작품(또는 벽 글) 정면에서 화면에 알맞게 들어오는 위치 */
  viewPoseFor(stop: StopInfo): Pose {
    const { pose, center } = stop;
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.availH);
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect * this.availW);
    const needH = stop.viewH * 1.45;
    const needW = stop.viewW * 1.3;
    let dist = Math.max(needH / 2 / Math.tan(vfov / 2), needW / 2 / Math.tan(hfov / 2));
    dist = THREE.MathUtils.clamp(dist, 1.2, 6);
    // 방 안으로 너무 들어가 벽에 부딪히면 거리를 줄인다
    let x = pose.x + pose.nx * dist;
    let z = pose.z + pose.nz * dist;
    for (let k = 0; k < 8 && isPathBlocked(pose.x + pose.nx * 0.3, pose.z + pose.nz * 0.3, x, z, this.colliders); k++) {
      dist *= 0.8;
      x = pose.x + pose.nx * dist;
      z = pose.z + pose.nz * dist;
    }
    [x, z] = resolveCircle(x, z, PLAYER_RADIUS, this.colliders);
    const yaw = Math.atan2(pose.nx, pose.nz);
    const eyeY = THREE.MathUtils.clamp(center.y, 1.35, 1.9);
    const pitch = Math.atan2(center.y - eyeY, Math.hypot(center.x - x, center.z - z));
    return { x, z, y: eyeY, yaw, pitch };
  }

  focusStop(stop: StopInfo, done?: () => void) {
    const to = this.viewPoseFor(stop);
    if (this.xr) {
      // VR 에서는 움직이는 카메라가 멀미를 부르므로 바로 옮긴다
      this.teleport(to.x, to.z, to.yaw);
      done?.();
      return;
    }
    const blocked = isPathBlocked(this.x, this.z, to.x, to.z, this.colliders);
    const dist = Math.hypot(to.x - this.x, to.z - this.z);
    this.tweenTo(to, blocked || dist > 14, done);
  }

  tweenTo(to: Pose, fade: boolean, done?: () => void) {
    const from: Pose = { x: this.x, z: this.z, y: this.y, yaw: this.yaw, pitch: this.pitch };
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = fade ? 0.9 : THREE.MathUtils.clamp(dist / 3.2, 0.45, 2.2);
    this.mode = { kind: 'tween', t: 0, dur, from, to, fade, done };
  }

  private stopAuto() {
    if (this.mode.kind !== 'free') this.mode = { kind: 'free' };
  }

  update(dt: number) {
    const m = this.mode;
    if (m.kind === 'tween') {
      m.t += dt / m.dur;
      const t = Math.min(1, m.t);
      if (m.fade) {
        // 0~0.45 페이드아웃, 0.55~1 페이드인. 중간에 위치 교체
        this.fade = t < 0.45 ? t / 0.45 : t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
        if (t >= 0.5) Object.assign(this, { x: m.to.x, z: m.to.z, y: m.to.y, yaw: m.to.yaw, pitch: m.to.pitch });
      } else {
        const e = ease(t);
        this.x = THREE.MathUtils.lerp(m.from.x, m.to.x, e);
        this.z = THREE.MathUtils.lerp(m.from.z, m.to.z, e);
        this.y = THREE.MathUtils.lerp(m.from.y, m.to.y, e);
        this.yaw = angleLerp(m.from.yaw, m.to.yaw, e);
        this.pitch = THREE.MathUtils.lerp(m.from.pitch, m.to.pitch, e);
      }
      if (t >= 1) {
        this.fade = 0;
        this.mode = { kind: 'free' };
        m.done?.();
      }
    } else if (this.enabled) {
      let fwd = 0;
      let strafe = 0;
      let turn = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
      if (this.keys.has('KeyA')) strafe -= 1;
      if (this.keys.has('KeyD')) strafe += 1;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) turn += 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyE')) turn -= 1;
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
      if (turn) this.yaw += turn * 1.8 * dt;
      let mx = 0;
      let mz = 0;
      if (fwd || strafe) {
        this.stopAuto();
        const len = Math.hypot(fwd, strafe);
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        // 전방 = (-sin, -cos), 오른쪽 = (cos, -sin)
        mx = ((-sin * fwd + cos * strafe) / len) * speed * dt;
        mz = ((-cos * fwd - sin * strafe) / len) * speed * dt;
        // 고개를 서서히 수평으로
        this.pitch *= Math.pow(0.2, dt);
      } else if (m.kind === 'walkTo') {
        const dx = m.x - this.x;
        const dz = m.z - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.08) this.mode = { kind: 'free' };
        else {
          const step = Math.min(d, WALK_SPEED * 1.15 * dt);
          mx = (dx / d) * step;
          mz = (dz / d) * step;
          const targetYaw = Math.atan2(-dx, -dz);
          this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * 4));
        }
      }
      if (mx || mz) {
        const [nx, nz] = resolveCircle(this.x + mx, this.z + mz, PLAYER_RADIUS, this.colliders);
        const progressed = Math.hypot(nx - this.x, nz - this.z);
        this.x = nx;
        this.z = nz;
        if (m.kind === 'walkTo' && progressed < Math.hypot(mx, mz) * 0.2) this.mode = { kind: 'free' };
      }
      // 시선 높이는 천천히 기본값으로
      this.y = THREE.MathUtils.lerp(this.y, EYE_HEIGHT, Math.min(1, dt * 2));
    }

    // 걷기 목표 커서
    const cm = this.cursor.material as THREE.MeshBasicMaterial;
    if (this.mode.kind === 'walkTo') {
      this.cursor.position.set(this.mode.x, 0.012, this.mode.z);
      cm.opacity = Math.min(0.85, cm.opacity + dt * 4);
    } else cm.opacity = Math.max(0, cm.opacity - dt * 3);

    this.apply();
    this.checkElevator();
  }

  private checkElevator() {
    if (!this.floor) return;
    let near: string | null = null;
    for (const e of this.floor.elevators) {
      const dx = this.x - (e.pose.x + e.pose.nx * 0.6);
      const dz = this.z - (e.pose.z + e.pose.nz * 0.6);
      if (Math.hypot(dx, dz) < 2.0) near = e.id;
    }
    if (near !== this.nearElevator) {
      this.nearElevator = near;
      this.events.onNearElevator(near);
    }
  }

  private apply() {
    if (this.xr) {
      this.xr.rig.position.set(this.x, 0, this.z);
      this.xr.rig.rotation.set(0, this.yaw, 0);
      return;
    }
    this.camera.position.set(this.x, this.y, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private pick(clientX: number, clientY: number) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.pickWith(this.raycaster);
  }

  /** 광선이 처음 닿는 바닥·작품·엘리베이터 (VR 컨트롤러 겨냥에도 사용) */
  pickWith(raycaster: THREE.Raycaster) {
    if (!this.floor) return null;
    const targets = [...this.floor.pickables, this.floor.floorMesh, ...this.floor.group.children.filter((c) => c.name === 'walls')];
    const hits = raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      return { kind: o.userData.kind as string, id: o.userData.id as string | undefined, point: h.point };
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || this.pointer) return;
    this.dom.setPointerCapture(e.pointerId);
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId || this.busy) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
    if (p.moved) {
      const k = e.pointerType === 'touch' ? 1.4 : 1;
      this.yaw += dx * LOOK_SPEED * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * LOOK_SPEED * k, -MAX_PITCH, MAX_PITCH);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    this.pointer = null;
    if (p.moved || this.busy || !this.enabled) return;
    this.activate(this.pick(e.clientX, e.clientY));
  };

  /** 클릭(또는 VR 컨트롤러 선택)한 곳에 따라 감상·엘리베이터·걷기 */
  activate(hit: ReturnType<VisitorController['pickWith']>) {
    if (!hit) return;
    if ((hit.kind === 'frame' || hit.kind === 'text' || hit.kind === 'object') && hit.id) {
      const f = this.floor?.stops.find((x) => x.id === hit.id);
      if (f) this.events.onStopClick(f);
    } else if (hit.kind === 'elevator' && hit.id) {
      this.events.onElevatorClick(hit.id);
    } else if (hit.kind === 'floor') {
      if (this.xr) this.teleport(hit.point.x, hit.point.z, this.yaw);
      else this.mode = { kind: 'walkTo', x: hit.point.x, z: hit.point.z };
      this.events.onMoveStart();
    }
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled || this.busy) return;
    e.preventDefault();
    // 휠 = 앞뒤로 조금씩 이동
    const step = -Math.sign(e.deltaY) * 0.5;
    const tx = this.x - Math.sin(this.yaw) * step;
    const tz = this.z - Math.cos(this.yaw) * step;
    [this.x, this.z] = resolveCircle(tx, tz, PLAYER_RADIUS, this.colliders);
    this.events.onMoveStart();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      if (e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code) && !e.code.startsWith('Shift')) this.events.onMoveStart();
      this.keys.add(e.code);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
    this.cursor.removeFromParent();
  }
}
