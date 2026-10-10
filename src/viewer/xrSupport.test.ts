import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { XRSupport } from './xrSupport';

/** XRSupport 가 쓰는 만큼만 흉내 낸 Stage·컨트롤러·XR 세션 */
function setup() {
  const controllers = [new THREE.Group(), new THREE.Group()];
  const camera = new THREE.PerspectiveCamera();
  const rig = new THREE.Group();
  rig.add(camera);
  const scene = new THREE.Scene();
  scene.add(rig);
  const stage = {
    scene,
    rig,
    camera,
    resize: vi.fn(),
    renderer: { xr: { getController: (i: number) => controllers[i], setSession: vi.fn(async () => undefined), isPresenting: false } },
  };
  const ctl = {
    xrActive: false,
    setXR: vi.fn(),
    moveBy: vi.fn(),
    turnBy: vi.fn(),
    activate: vi.fn(),
    pickWith: vi.fn(() => ({ kind: 'floor', id: undefined, point: new THREE.Vector3(3, 0, 4) })),
  };
  const listeners: Record<string, () => void> = {};
  const inputSources: { handedness: string; gamepad: { axes: number[] } }[] = [];
  const session = { inputSources, addEventListener: (t: string, fn: () => void) => (listeners[t] = fn), end: vi.fn(async () => listeners.end?.()) };
  vi.stubGlobal('navigator', { xr: { requestSession: vi.fn(async () => session), isSessionSupported: async () => true } });
  const onPresent = vi.fn();
  // 테스트 대역은 실제 타입의 일부만 구현한다
  const xr = new XRSupport(stage as never, ctl as never, onPresent);
  return { xr, ctl, stage, controllers, inputSources, onPresent, session };
}

describe('XRSupport', () => {
  it('enters VR by handing the camera rig to the controller, and restores on exit', async () => {
    const { xr, ctl, stage, onPresent, session } = setup();
    await xr.enter();
    expect(ctl.setXR).toHaveBeenCalledWith(stage.rig);
    expect(onPresent).toHaveBeenLastCalledWith(true);
    await session.end();
    expect(ctl.setXR).toHaveBeenLastCalledWith(null);
    expect(onPresent).toHaveBeenLastCalledWith(false);
    vi.unstubAllGlobals();
  });

  it('snap-turns once per stick flick (right stick right = turn right)', async () => {
    const { xr, ctl, inputSources } = setup();
    await xr.enter();
    inputSources.push({ handedness: 'right', gamepad: { axes: [0, 0, 0.9, 0] } });
    xr.update(0.016);
    xr.update(0.016);
    expect(ctl.turnBy).toHaveBeenCalledTimes(1);
    expect(ctl.turnBy.mock.calls[0][0]).toBeLessThan(0);
    inputSources[0].gamepad.axes[2] = 0;
    xr.update(0.016);
    inputSources[0].gamepad.axes[2] = -0.9;
    xr.update(0.016);
    expect(ctl.turnBy).toHaveBeenCalledTimes(2);
    expect(ctl.turnBy.mock.calls[1][0]).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('moves where the head looks with the left stick', async () => {
    const { xr, ctl, inputSources, stage } = setup();
    await xr.enter();
    // 머리가 +x 쪽(오른쪽)을 바라봄
    stage.camera.lookAt(10, 0, 0);
    stage.scene.updateMatrixWorld(true);
    inputSources.push({ handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } });
    xr.update(0.5);
    const [dx, dz] = ctl.moveBy.mock.calls[0];
    expect(dx).toBeGreaterThan(0.5);
    expect(Math.abs(dz)).toBeLessThan(1e-6);
    vi.unstubAllGlobals();
  });

  it('selecting with a controller activates what it points at', async () => {
    const { xr, ctl, controllers } = setup();
    await xr.enter();
    controllers[1].dispatchEvent({ type: 'select' } as never);
    expect(ctl.activate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'floor' }));
    vi.unstubAllGlobals();
  });
});
