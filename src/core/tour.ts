import { floorCentroid, isFaceValid, routeAngle, wallItemPose } from './grid';
import type { Floor, ID, Prop, WallItem } from './types';

/** 감상 순서에 들어가는 벽 항목인지 (작품이 걸린 액자, 내용이 있는 벽 글) */
export function isTourStop(item: WallItem): boolean {
  if (item.kind === 'frame') return !!item.artworkId;
  if (item.kind === 'text') return !!(item.title.trim() || item.body.trim());
  return false;
}

/** 감상 순서에 들어가는 소품인지 (입체 작품을 올린 조각 좌대) */
export function isSculptureStop(p: Prop): boolean {
  return p.type === 'pedestal' && !!p.artworkId;
}

/** 자동 순서: 시작 위치에서 출발해 벽을 따라 시계방향 (같은 벽에서는 왼쪽부터, 좌대는 놓인 방향대로) */
export function autoTourOrder(floor: Floor): ID[] {
  const parts = new Set(floor.partitions);
  const angleOf = routeAngle(floor);
  const c = floorCentroid(floor);
  const points = [
    ...floor.wallItems.filter((w) => isTourStop(w) && isFaceValid(floor, w, parts)).map((w) => ({ id: w.id, ...wallItemPose(w) })),
    ...floor.props.filter(isSculptureStop).map((p) => ({ id: p.id, x: p.x, z: p.z })),
  ];
  return points
    .map((p, k) => ({ id: p.id, a: angleOf(p.x, p.z), r: Math.hypot(p.x - c.x, p.z - c.z), k }))
    .sort((a, b) => a.a - b.a || b.r - a.r || a.k - b.k)
    .map((x) => x.id);
}

/**
 * 실제 감상 순서. 큐레이터가 정한 순서(tourOrder)를 먼저 따르고,
 * 거기 없는 새 항목은 자동 순서대로 뒤에 붙인다.
 */
export function tourSequence(floor: Floor): ID[] {
  const auto = autoTourOrder(floor);
  const custom = floor.tourOrder ?? [];
  if (!custom.length) return auto;
  const valid = new Set(auto);
  const seen = new Set<ID>();
  const out: ID[] = [];
  for (const id of custom) {
    if (valid.has(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const id of auto) if (!seen.has(id)) out.push(id);
  return out;
}

/** 감상 순서에서 한 항목을 옮긴 새 순서 */
export function moveInSequence(seq: ID[], from: number, to: number): ID[] {
  const out = seq.slice();
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}
