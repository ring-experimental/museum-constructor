import { describe, expect, it } from 'vitest';
import { createFloor, fillRect, newFrame, newText } from './factory';
import { edgeKey } from './grid';
import { autoTourOrder, isTourStop, moveInSequence, tourSequence } from './tour';

function gallery() {
  const f = createFloor('1F', 6, 5);
  fillRect(f, 1, 1, 4, 3);
  // 위쪽 벽 왼쪽→오른쪽 순서로 두 점, 오른쪽 벽에 한 점, 빈 액자와 빈 글 하나씩
  const a = newFrame({ edge: edgeKey('h', 2, 1), side: 1 }, 'art-a');
  const b = newFrame({ edge: edgeKey('h', 3, 1), side: 1 }, 'art-b');
  const c = newFrame({ edge: edgeKey('v', 5, 2), side: -1 }, 'art-c');
  const empty = newFrame({ edge: edgeKey('h', 1, 1), side: 1 }, null);
  const intro = newText({ edge: edgeKey('v', 1, 2), side: 1 });
  intro.title = '서문';
  const blank = newText({ edge: edgeKey('v', 1, 3), side: 1 });
  f.wallItems.push(c, intro, b, empty, a, blank);
  return { f, a, b, c, empty, intro, blank };
}

describe('tour order', () => {
  it('only includes hung frames and texts with content', () => {
    const { a, empty, intro, blank } = gallery();
    expect(isTourStop(a)).toBe(true);
    expect(isTourStop(empty)).toBe(false);
    expect(isTourStop(intro)).toBe(true);
    expect(isTourStop(blank)).toBe(false);
  });

  it('auto order follows the walls clockwise regardless of insertion order', () => {
    const { f, a, b, c, intro } = gallery();
    const seq = autoTourOrder(f);
    expect(seq).toHaveLength(4);
    // 시작 위치가 왼쪽 벽 앞이면: 왼쪽 벽(서문) → 위쪽 벽(a → b) → 오른쪽 벽(c)
    f.spawn = { x: 2.6, z: 5, yaw: -Math.PI / 2 };
    expect(autoTourOrder(f)).toEqual([intro.id, a.id, b.id, c.id]);
    // 시작 위치가 없으면 중심 위쪽(12시)부터 시계방향
    f.spawn = null;
    expect(seq[0]).toBe(b.id);
  });

  it('custom order wins, new stops are appended and stale ids dropped', () => {
    const { f, a, b, c, intro } = gallery();
    f.tourOrder = [intro.id, c.id, 'deleted-item', a.id];
    expect(tourSequence(f)).toEqual([intro.id, c.id, a.id, b.id]);
  });

  it('moves an entry within a sequence', () => {
    expect(moveInSequence(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveInSequence(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInSequence(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});
