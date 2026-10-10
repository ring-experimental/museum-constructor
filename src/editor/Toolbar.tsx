import { ArrowUpDown, BrickWall, Eraser, Frame, MousePointer2, Armchair, Navigation, SquareDashed, Type } from 'lucide-react';
import { PROP_SPEC } from '../core/constants';
import type { PropType } from '../core/types';
import { useEditor, type Tool } from './store';

export const TOOLS: { id: Tool; label: string; key: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; hint: string }[] = [
  { id: 'select', label: '선택', key: '1', icon: MousePointer2, hint: '항목을 클릭해 선택하고 드래그해 옮겨요. 빈 곳을 드래그하면 화면이 이동해요.' },
  { id: 'room', label: '공간', key: '2', icon: SquareDashed, hint: '드래그해서 바닥(방)을 칠해요. 벽은 공간 둘레에 자동으로 세워져요. 우클릭 드래그 = 지우기' },
  { id: 'wall', label: '칸막이 벽', key: '3', icon: BrickWall, hint: '격자선 위를 클릭하거나 드래그해 칸막이 벽을 세우거나 없애요.' },
  { id: 'frame', label: '액자', key: '4', icon: Frame, hint: '벽 가까이를 클릭하면 액자가 걸려요. 보관함에서 작품을 고르면 그 작품이 순서대로 걸려요.' },
  { id: 'text', label: '벽 글', key: '5', icon: Type, hint: '벽 가까이를 클릭해 전시 서문·섹션 제목·안내문을 붙여요. 오른쪽에서 글을 입력해요.' },
  { id: 'elevator', label: '엘리베이터', key: '6', icon: ArrowUpDown, hint: '벽을 클릭해 엘리베이터를 설치해요. 관람객이 층을 오가는 곳이에요. (층마다 1개)' },
  { id: 'prop', label: '소품', key: '7', icon: Armchair, hint: '바닥을 클릭해 벤치·화분·조각 좌대를 놓아요. R 키로 회전.' },
  { id: 'spawn', label: '시작 위치', key: '8', icon: Navigation, hint: '관람객이 처음 서는 곳이에요. 클릭 후 드래그하면 바라보는 방향을 정해요.' },
  { id: 'erase', label: '지우개', key: '9', icon: Eraser, hint: '액자·벽 글·소품·칸막이 벽을 클릭해서 지워요.' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <nav className="toolbar" aria-label="편집 도구">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button key={t.id} className={`tool ${tool === t.id ? 'is-active' : ''}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id}>
            <Icon size={20} strokeWidth={1.7} />
            <span>{t.label}</span>
            <kbd>{t.key}</kbd>
          </button>
        );
      })}
    </nav>
  );
}

/** 도면 상단에 뜨는 현재 도구 안내 + 옵션 */
export function ToolOptions() {
  const tool = useEditor((s) => s.tool);
  const roomMode = useEditor((s) => s.roomMode);
  const setRoomMode = useEditor((s) => s.setRoomMode);
  const propType = useEditor((s) => s.propType);
  const setPropType = useEditor((s) => s.setPropType);
  const rotateProp = useEditor((s) => s.rotateProp);
  const pending = useEditor((s) => s.pendingArtworkId);
  const doc = useEditor((s) => s.doc);
  const setPending = useEditor((s) => s.setPending);
  const t = TOOLS.find((x) => x.id === tool)!;
  const pendingArt = pending ? doc?.artworks.find((a) => a.id === pending) : null;

  return (
    <div className="tool-options">
      <p className="tool-options__hint">{t.hint}</p>
      {tool === 'room' && (
        <div className="seg" role="group" aria-label="공간 모드">
          <button className={roomMode === 'add' ? 'is-active' : ''} onClick={() => setRoomMode('add')}>
            추가
          </button>
          <button className={roomMode === 'remove' ? 'is-active' : ''} onClick={() => setRoomMode('remove')}>
            지우기
          </button>
        </div>
      )}
      {tool === 'prop' && (
        <>
          <div className="seg" role="group" aria-label="소품 종류">
            {(Object.keys(PROP_SPEC) as PropType[]).map((k) => (
              <button key={k} className={propType === k ? 'is-active' : ''} onClick={() => setPropType(k)}>
                {PROP_SPEC[k].label}
              </button>
            ))}
          </div>
          <button className="btn btn--sm" onClick={() => rotateProp(Math.PI / 2)}>
            회전 (R)
          </button>
          {propType === 'pedestal' && pendingArt?.media === 'model' && (
            <span className="tool-options__pending">
              올릴 입체 작품: <strong>{pendingArt.title || '무제'}</strong>
              <button className="link-btn" onClick={() => setPending(null)}>
                빈 좌대로
              </button>
            </span>
          )}
        </>
      )}
      {tool === 'frame' && (
        <span className="tool-options__pending">
          {pendingArt && pendingArt.media !== 'model' ? (
            <>
              다음에 걸 작품: <strong>{pendingArt.title || '무제'}</strong>
              <button className="link-btn" onClick={() => setPending(null)}>
                빈 액자로
              </button>
            </>
          ) : (
            '빈 액자가 걸려요. 아래 보관함에서 작품을 고르면 그 작품부터 순서대로 걸려요.'
          )}
        </span>
      )}
    </div>
  );
}
