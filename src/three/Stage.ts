import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { LightingPreset } from '../core/types';
import { setMaxAnisotropy } from './artworkTextures';
import { LIGHTING } from './lighting';

export interface StageOptions {
  /** 'demand' 는 invalidate() 를 호출할 때만 렌더 (편집기 미리보기용) */
  renderMode: 'always' | 'demand';
  fov?: number;
}

/** 렌더러 + 씬 + 조명 + 리사이즈 + 렌더 루프 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight('#ffffff', 0.5);
  private readonly env: THREE.Texture;
  private readonly ro: ResizeObserver;
  private readonly timer = new THREE.Timer();
  private frameRequested = true;
  private updaters = new Set<(dt: number) => void>();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: StageOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 62, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;

    this.sun.position.set(6, 12, 4);
    this.scene.add(this.hemi, this.sun);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    this.renderer.setAnimationLoop(this.tick);
  }

  setLighting(preset: LightingPreset) {
    const p = LIGHTING[preset];
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemi;
    this.sun.intensity = p.dir;
    this.scene.environmentIntensity = p.env;
    this.scene.background = new THREE.Color(p.background);
    this.renderer.toneMappingExposure = p.exposure;
    this.invalidate();
  }

  setBackground(color: string) {
    this.scene.background = new THREE.Color(color);
    this.invalidate();
  }

  onUpdate(fn: (dt: number) => void) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  invalidate = () => {
    this.frameRequested = true;
  };

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private tick = (time: number) => {
    if (this.disposed) return;
    this.timer.update(time);
    const dt = Math.min(0.05, this.timer.getDelta());
    for (const u of this.updaters) u(dt);
    if (this.opts.renderMode === 'always' || this.frameRequested) {
      this.frameRequested = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
