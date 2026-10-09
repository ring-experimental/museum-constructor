import { useEffect, useRef } from 'react';
import { CELL } from '../core/constants';
import { computeWallEdges, isFaceValid, wallItemPose } from '../core/grid';
import type { Floor } from '../core/types';

/** 관람 모드 미니맵. 클릭하면 그 위치로 이동 */
export function Minimap({
  floor,
  getPlayer,
  onPick,
}: {
  floor: Floor;
  getPlayer: () => { x: number; z: number; yaw: number };
  onPick: (x: number, z: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useRef({ scale: 1, ox: 0, oz: 0 });

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const edges = computeWallEdges(floor);
    const items = floor.wallItems.filter((w) => isFaceValid(floor, w));
    let minI = floor.cols,
      minJ = floor.rows,
      maxI = 0,
      maxJ = 0;
    for (let j = 0; j < floor.rows; j++)
      for (let i = 0; i < floor.cols; i++)
        if (floor.cells[j * floor.cols + i]) {
          minI = Math.min(minI, i);
          minJ = Math.min(minJ, j);
          maxI = Math.max(maxI, i + 1);
          maxJ = Math.max(maxJ, j + 1);
        }
    if (maxI <= minI) {
      minI = minJ = 0;
      maxI = floor.cols;
      maxJ = floor.rows;
    }
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const pad = 12;
      const ww = (maxI - minI) * CELL;
      const wh = (maxJ - minJ) * CELL;
      const scale = Math.min((W - pad * 2) / ww, (H - pad * 2) / wh);
      const ox = (W - ww * scale) / 2 - minI * CELL * scale;
      const oz = (H - wh * scale) / 2 - minJ * CELL * scale;
      layout.current = { scale, ox, oz };
      const X = (x: number) => ox + x * scale;
      const Z = (z: number) => oz + z * scale;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let j = 0; j < floor.rows; j++)
        for (let i = 0; i < floor.cols; i++)
          if (floor.cells[j * floor.cols + i]) g.fillRect(X(i * CELL), Z(j * CELL), CELL * scale + 0.5, CELL * scale + 0.5);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.lineCap = 'square';
      g.beginPath();
      for (const e of edges) {
        if (e.dir === 'h') {
          g.moveTo(X(e.i * CELL), Z(e.j * CELL));
          g.lineTo(X((e.i + 1) * CELL), Z(e.j * CELL));
        } else {
          g.moveTo(X(e.i * CELL), Z(e.j * CELL));
          g.lineTo(X(e.i * CELL), Z((e.j + 1) * CELL));
        }
      }
      g.stroke();
      for (const it of items) {
        const p = wallItemPose(it);
        const half = it.kind === 'frame' ? it.width / 2 : 0.9;
        g.strokeStyle = it.kind === 'frame' ? '#ff8a5c' : '#9fb4ff';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(X(p.x - p.rx * half + p.nx * 0.25), Z(p.z - p.rz * half + p.nz * 0.25));
        g.lineTo(X(p.x + p.rx * half + p.nx * 0.25), Z(p.z + p.rz * half + p.nz * 0.25));
        g.stroke();
      }
      const pl = getPlayer();
      const px = X(pl.x);
      const pz = Z(pl.z);
      // 시야 부채꼴
      const fx = -Math.sin(pl.yaw);
      const fz = -Math.cos(pl.yaw);
      const ang = Math.atan2(fz, fx);
      const grad = g.createRadialGradient(px, pz, 0, px, pz, 34);
      grad.addColorStop(0, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px, pz);
      g.arc(px, pz, 34, ang - 0.55, ang + 0.55);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(px, pz, 4.5, 0, Math.PI * 2);
      g.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [floor, getPlayer]);

  return (
    <canvas
      ref={ref}
      className="minimap"
      aria-label="미니맵 (클릭해서 이동)"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const { scale, ox, oz } = layout.current;
        onPick((e.clientX - r.left - ox) / scale, (e.clientY - r.top - oz) / scale);
      }}
    />
  );
}
