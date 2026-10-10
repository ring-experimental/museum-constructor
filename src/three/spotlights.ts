import * as THREE from 'three';
import type { LightingPreset } from '../core/types';

/**
 * 작품별 스포트라이트.
 * 실제 SpotLight 는 벽·바닥에 자연스러운 빛 웅덩이를 만들지만 셰이더 비용이 커서 층마다 몇 개로 제한하고,
 * 그 밖에는 빛줄기(볼류메트릭 느낌의 원뿔)와 벽면 빛 웅덩이(가짜 조명)로 표현한다.
 */

/** 층마다 실제 SpotLight 최대 개수 */
export const MAX_REAL_SPOTS = 6;

const SPOT_SPEC: Record<LightingPreset, { intensity: number; cone: number; wash: number }> = {
  bright: { intensity: 14, cone: 0.035, wash: 0.22 },
  warm: { intensity: 13, cone: 0.05, wash: 0.3 },
  dramatic: { intensity: 11, cone: 0.11, wash: 0.65 },
};

export function spotSpec(preset: LightingPreset) {
  return SPOT_SPEC[preset];
}

export interface SpotRequest {
  /** 천장 조명 위치 */
  from: THREE.Vector3;
  /** 작품 중심 */
  to: THREE.Vector3;
  /** 비출 범위 반지름 (m) */
  radius: number;
}

/** 실제 스포트라이트 (그림자 없음) */
export function createSpotLight(req: SpotRequest, color: string, preset: LightingPreset): THREE.SpotLight {
  const dist = req.from.distanceTo(req.to);
  const angle = Math.min(Math.PI / 3, Math.atan((req.radius * 1.25) / dist));
  const light = new THREE.SpotLight(color, SPOT_SPEC[preset].intensity, dist * 3, angle, 0.55, 2);
  light.position.copy(req.from);
  light.target.position.copy(req.to);
  light.castShadow = false;
  light.name = 'artwork-spot';
  return light;
}

const coneVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vV = uv.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vV;
  void main() {
    // 원뿔 가장자리(시선과 비스듬한 면)와 아래쪽으로 갈수록 옅게
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float a = pow(facing, 2.2) * smoothstep(0.0, 0.85, vV) * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** 조명에서 작품으로 떨어지는 은은한 빛줄기 */
export function createLightCone(req: SpotRequest, color: string, preset: LightingPreset): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(req.to, req.from);
  const len = dir.length() * 0.92;
  const geo = new THREE.CylinderGeometry(0.05, req.radius, len, 32, 1, true);
  // 원기둥은 y 축 방향: 위(+y, v=1)가 조명 쪽
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: coneVertex,
    fragmentShader: coneFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: SPOT_SPEC[preset].cone } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(req.from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  mesh.renderOrder = 4;
  mesh.name = 'light-cone';
  return mesh;
}
