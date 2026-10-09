import type { LightingPreset } from '../core/types';

export interface LightingParams {
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  env: number;
  dir: number;
  ceilingPanel: string;
  wash: number;
  washColor: string;
  background: string;
  exposure: number;
}

export const LIGHTING: Record<LightingPreset, LightingParams> = {
  bright: {
    hemiSky: '#ffffff',
    hemiGround: '#e2ddd4',
    hemi: 2.6,
    env: 0.75,
    dir: 0.9,
    ceilingPanel: '#ffffff',
    wash: 0.1,
    washColor: '#fff8ee',
    background: '#e9e6e1',
    exposure: 1,
  },
  warm: {
    hemiSky: '#fff3e2',
    hemiGround: '#d9c9b2',
    hemi: 2.4,
    env: 0.6,
    dir: 0.7,
    ceilingPanel: '#fff6ea',
    wash: 0.17,
    washColor: '#ffd9a6',
    background: '#e5ddd1',
    exposure: 1,
  },
  dramatic: {
    hemiSky: '#c9c4bc',
    hemiGround: '#3a3632',
    hemi: 0.75,
    env: 0.16,
    dir: 0.1,
    ceilingPanel: '#3b3936',
    wash: 0.45,
    washColor: '#fff0dc',
    background: '#121212',
    exposure: 1.05,
  },
};
