import { useMemo } from 'react';
import { CELL } from '../core/constants';
import { computeWallEdges, isFaceValid, wallItemPose } from '../core/grid';
import type { Floor } from '../core/types';

/** 도면 미니 썸네일 (데이터로부터 그리는 다이어그램) */
export function PlanThumb({ floor, className, highlight = '#ff5a1f' }: { floor: Floor; className?: string; highlight?: string }) {
  const data = useMemo(() => {
    const filled: [number, number][] = [];
    let minI = Infinity,
      minJ = Infinity,
      maxI = -Infinity,
      maxJ = -Infinity;
    for (let j = 0; j < floor.rows; j++)
      for (let i = 0; i < floor.cols; i++)
        if (floor.cells[j * floor.cols + i]) {
          filled.push([i, j]);
          minI = Math.min(minI, i);
          minJ = Math.min(minJ, j);
          maxI = Math.max(maxI, i);
          maxJ = Math.max(maxJ, j);
        }
    if (!filled.length) {
      minI = minJ = 0;
      maxI = floor.cols - 1;
      maxJ = floor.rows - 1;
    }
    const edges = computeWallEdges(floor);
    const items = floor.wallItems.filter((w) => isFaceValid(floor, w)).map((w) => ({ w, p: wallItemPose(w) }));
    return { filled, edges, items, box: [minI, minJ, maxI + 1, maxJ + 1] };
  }, [floor]);
  const [x0, y0, x1, y1] = data.box;
  const pad = 0.6;
  return (
    <svg className={className} viewBox={`${x0 * CELL - pad} ${y0 * CELL - pad} ${(x1 - x0) * CELL + pad * 2} ${(y1 - y0) * CELL + pad * 2}`} aria-hidden>
      {data.filled.map(([i, j]) => (
        <rect key={`${i}:${j}`} x={i * CELL} y={j * CELL} width={CELL + 0.02} height={CELL + 0.02} fill="currentColor" opacity={0.08} />
      ))}
      {data.edges.map((e) =>
        e.dir === 'h' ? (
          <line key={e.key} x1={e.i * CELL - 0.1} y1={e.j * CELL} x2={(e.i + 1) * CELL + 0.1} y2={e.j * CELL} stroke="currentColor" strokeWidth={0.28} />
        ) : (
          <line key={e.key} x1={e.i * CELL} y1={e.j * CELL - 0.1} x2={e.i * CELL} y2={(e.j + 1) * CELL + 0.1} stroke="currentColor" strokeWidth={0.28} />
        ),
      )}
      {data.items.map(({ w, p }) => {
        const half = w.kind === 'frame' ? w.width / 2 : 0.9;
        return (
          <line
            key={w.id}
            x1={p.x - p.rx * half + p.nx * 0.18}
            y1={p.z - p.rz * half + p.nz * 0.18}
            x2={p.x + p.rx * half + p.nx * 0.18}
            y2={p.z + p.rz * half + p.nz * 0.18}
            stroke={w.kind === 'frame' ? highlight : '#5a6b8c'}
            strokeWidth={0.22}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
