import { ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, Expand, Map as MapIcon, Play, X, ArrowUpDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { resolveSpawn } from '../core/grid';
import type { Artwork, Exhibition } from '../core/types';
import { href, navigate } from '../router';
import { exhibitionRepo } from '../storage/exhibitionRepo';
import { buildFloorScene, type FloorScene, type FrameInfo } from '../three/buildFloor';
import { Stage } from '../three/Stage';
import { Minimap } from '../viewer/Minimap';
import { VisitorController } from '../viewer/VisitorController';

interface Engine {
  stage: Stage;
  controller: VisitorController;
  floor: FloorScene | null;
  doors: Map<string, { open: number; target: number }>;
  transition: number;
  /** 정보 패널만큼 화면 중심을 옮기기 위한 오프셋 (px) */
  shift: { x: number; y: number; tx: number; ty: number };
}

/** 작품 패널이 차지하는 영역 (CSS 와 맞춤) */
function panelLayout(focused: boolean) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (!focused) return { availW: 1, availH: 1, sx: 0, sy: 0 };
  if (W <= 640) {
    const ph = Math.min(H * 0.46, 300) + 12;
    return { availW: 1, availH: (H - ph) / H, sx: 0, sy: ph / 2 };
  }
  const pw = Math.min(340, W - 32) + 16;
  return { availW: (W - pw) / W, availH: 1, sx: pw / 2, sy: 0 };
}

function applyPanelLayout(engine: Engine, focused: boolean) {
  const l = panelLayout(focused);
  engine.controller.availW = l.availW;
  engine.controller.availH = l.availH;
  engine.shift.tx = l.sx;
  engine.shift.ty = l.sy;
}

export function VisitPage({ id, initialFloor, from }: { id: string; initialFloor?: number; from?: string }) {
  const [doc, setDoc] = useState<Exhibition | null | undefined>(undefined);
  const [floorIndex, setFloorIndex] = useState(initialFloor ?? 0);
  const [entered, setEntered] = useState(from === 'editor');
  const [focused, setFocused] = useState<FrameInfo | null>(null);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [nearElevator, setNearElevator] = useState<string | null>(null);
  const [elevatorPanel, setElevatorPanel] = useState(false);
  const [help, setHelp] = useState(true);
  const [showMap, setShowMap] = useState(() => !matchMedia('(max-width: 640px)').matches);
  const [lightbox, setLightbox] = useState<Artwork | null>(null);
  const [touring, setTouring] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const arrivalRef = useRef<'elevator' | 'spawn'>('spawn');

  useEffect(() => {
    let alive = true;
    exhibitionRepo.get(id).then((d) => {
      if (!alive) return;
      setDoc(d ?? null);
      if (d && (initialFloor ?? 0) >= d.floors.length) setFloorIndex(0);
    });
    return () => {
      alive = false;
    };
  }, [id, initialFloor]);

  // 엔진 생성 (문서 로드 후 1회)
  useEffect(() => {
    if (!doc || !containerRef.current) return;
    const stage = new Stage(containerRef.current, { renderMode: 'always', fov: 62 });
    stage.setLighting(doc.theme.lighting);
    const controller = new VisitorController(stage.camera, stage.renderer.domElement, {
      onFrameClick: (f) => {
        setFocused(f);
        setHelp(false);
        applyPanelLayout(engine, true);
        controller.focusFrame(f);
      },
      onElevatorClick: () => setElevatorPanel(true),
      onMoveStart: () => {
        setFocused(null);
        setTouring(false);
        setHelp(false);
      },
      onNearElevator: (eid) => {
        setNearElevator(eid);
        if (!eid) setElevatorPanel(false);
      },
    });
    const engine: Engine = { stage, controller, floor: null, doors: new Map(), transition: 0, shift: { x: 0, y: 0, tx: 0, ty: 0 } };
    engineRef.current = engine;
    stage.onUpdate((dt) => {
      controller.update(dt);
      // 엘리베이터 문 애니메이션
      for (const e of engine.floor?.elevators ?? []) {
        const st = engine.doors.get(e.id);
        if (!st || !e.doorL || !e.doorR) continue;
        st.open += (st.target - st.open) * Math.min(1, dt * 3.2);
        e.doorL.position.x = e.doorBase[0] - st.open * 0.44;
        e.doorR.position.x = e.doorBase[1] + st.open * 0.44;
      }
      if (fadeRef.current) fadeRef.current.style.opacity = String(Math.max(controller.fade, engine.transition));
      // 패널 쪽으로 가려지지 않게 투영 중심 이동
      const sh = engine.shift;
      const k = Math.min(1, dt * 5);
      sh.x += (sh.tx - sh.x) * k;
      sh.y += (sh.ty - sh.y) * k;
      const cam = stage.camera;
      if (Math.abs(sh.x) < 0.5 && Math.abs(sh.y) < 0.5 && sh.tx === 0 && sh.ty === 0) {
        if (cam.view) cam.clearViewOffset();
      } else {
        const w = stage.renderer.domElement.clientWidth;
        const h = stage.renderer.domElement.clientHeight;
        cam.setViewOffset(w, h, sh.x, sh.y, w, h);
      }
    });
    return () => {
      engine.floor?.dispose();
      controller.dispose();
      stage.dispose();
      engineRef.current = null;
    };
  }, [doc]);

  // 층 구성
  useEffect(() => {
    const engine = engineRef.current;
    if (!doc || !engine) return;
    const idx = Math.min(floorIndex, doc.floors.length - 1);
    const floor = doc.floors[idx];
    if (!floor) return;
    engine.floor?.dispose();
    const scene = buildFloorScene(doc, idx, { mode: 'visit' });
    engine.stage.scene.add(scene.group);
    engine.floor = scene;
    engine.doors = new Map(scene.elevators.map((e) => [e.id, { open: 0, target: 0 }]));
    engine.controller.setFloor(scene);
    setFrames(scene.frames);
    setFocused(null);
    setElevatorPanel(false);
    const elev = scene.elevators[0];
    if (arrivalRef.current === 'elevator' && elev) {
      const p = elev.pose;
      engine.controller.teleport(p.x + p.nx * 1.7, p.z + p.nz * 1.7, Math.atan2(-p.nx, -p.nz));
      // 도착 시 문이 열려 있다가 닫힘
      const st = engine.doors.get(elev.id)!;
      st.open = 1;
      st.target = 0;
    } else {
      const s = resolveSpawn(floor);
      engine.controller.teleport(s.x, s.z, s.yaw);
    }
    arrivalRef.current = 'spawn';
  }, [doc, floorIndex]);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine) engine.controller.enabled = entered && !lightbox;
  }, [entered, lightbox, doc]);

  const goFloor = useCallback(
    (target: number, viaElevatorId?: string | null) => {
      const engine = engineRef.current;
      if (!engine || !doc || target === floorIndex) return;
      setElevatorPanel(false);
      setFocused(null);
      setTouring(false);
      const st = viaElevatorId ? engine.doors.get(viaElevatorId) : undefined;
      if (st) st.target = 1;
      arrivalRef.current = 'elevator';
      const start = performance.now();
      const delay = st ? 650 : 0;
      const fadeOut = () => {
        const t = Math.min(1, (performance.now() - start - delay) / 350);
        engine.transition = Math.max(0, t);
        if (t < 1) requestAnimationFrame(fadeOut);
        else {
          setFloorIndex(target);
          const t0 = performance.now();
          const fadeIn = () => {
            const k = Math.min(1, (performance.now() - t0) / 450);
            engine.transition = 1 - k;
            if (k < 1) requestAnimationFrame(fadeIn);
          };
          setTimeout(() => requestAnimationFrame(fadeIn), 120);
        }
      };
      requestAnimationFrame(fadeOut);
    },
    [doc, floorIndex],
  );

  // 패널이 닫히면 화면 중심 복귀
  useEffect(() => {
    const engine = engineRef.current;
    if (engine && !focused) applyPanelLayout(engine, false);
  }, [focused]);

  const focusIndex = focused ? frames.findIndex((f) => f.id === focused.id) : -1;
  const step = useCallback(
    (dir: 1 | -1) => {
      const engine = engineRef.current;
      if (!engine || !frames.length) return;
      const next = frames[(Math.max(0, focusIndex) + dir + frames.length) % frames.length];
      applyPanelLayout(engine, true);
      if (focusIndex < 0) {
        setFocused(frames[0]);
        engine.controller.focusFrame(frames[0]);
        return;
      }
      setFocused(next);
      engine.controller.focusFrame(next);
    },
    [frames, focusIndex],
  );

  const startTour = () => {
    const engine = engineRef.current;
    if (!engine || !frames.length) return;
    setTouring(true);
    setHelp(false);
    applyPanelLayout(engine, true);
    setFocused(frames[0]);
    engine.controller.focusFrame(frames[0]);
  };

  // 감상 패널 키보드: ← → 이전/다음, Esc 닫기
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (lightbox) {
        if (e.code === 'Escape') {
          setLightbox(null);
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.code === 'Escape') {
        if (focused || elevatorPanel) {
          setFocused(null);
          setTouring(false);
          setElevatorPanel(false);
          e.stopImmediatePropagation();
        }
        return;
      }
      if (focused && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        step(e.code === 'ArrowRight' ? 1 : -1);
      }
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) setShowMap((v) => !v);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [focused, elevatorPanel, lightbox, step]);

  useEffect(() => {
    if (!entered) return;
    const t = setTimeout(() => setHelp(false), 9000);
    return () => clearTimeout(t);
  }, [entered]);

  const getPlayer = useCallback(() => {
    const c = engineRef.current?.controller;
    return c ? { x: c.x, z: c.z, yaw: c.yaw } : { x: 0, z: 0, yaw: 0 };
  }, []);

  const totalWorks = useMemo(() => (doc ? doc.floors.reduce((n, f) => n + f.wallItems.filter((w) => w.kind === 'frame' && w.artworkId).length, 0) : 0), [doc]);

  const exit = () => navigate(from === 'editor' ? href.editor(id) : href.visitList());

  if (doc === undefined) return <div className="visit visit--loading">전시관을 준비하는 중…</div>;
  if (doc === null)
    return (
      <div className="visit visit--loading">
        <p>전시를 찾을 수 없습니다.</p>
        <a className="btn" href={href.visitList()}>
          목록으로
        </a>
      </div>
    );

  const floor = doc.floors[Math.min(floorIndex, doc.floors.length - 1)];
  const art = focused?.artwork;

  return (
    <div className={`visit ${focused ? 'visit--focused' : ''}`}>
      <div className="visit__canvas" ref={containerRef} />
      <div className="visit__fade" ref={fadeRef} />

      {entered && (
        <>
          <div className="hud hud--top-left">
            <button className="hud-btn" onClick={exit} aria-label="나가기">
              <ArrowLeft size={18} />
              <span>{from === 'editor' ? '편집으로' : '나가기'}</span>
            </button>
            <div className="hud-title">
              <strong>{doc.title}</strong>
              <span>
                {floor?.name} · 작품 {frames.length}점
              </span>
            </div>
          </div>

          {doc.floors.length > 1 && (
            <div className="hud hud--top-right floor-switch" role="group" aria-label="층 이동">
              {[...doc.floors.keys()].reverse().map((k) => (
                <button key={doc.floors[k].id} className={k === floorIndex ? 'is-active' : ''} onClick={() => goFloor(k)}>
                  {doc.floors[k].name}
                </button>
              ))}
            </div>
          )}

          <div className="hud hud--bottom-left">
            {showMap && floor && <Minimap floor={floor} getPlayer={getPlayer} onPick={(x, z) => engineRef.current?.controller.tweenTo({ x, z, y: 1.6, yaw: engineRef.current.controller.yaw, pitch: 0 }, true)} />}
            <div className="hud-row">
              <button className={`hud-icon ${showMap ? 'is-active' : ''}`} onClick={() => setShowMap((v) => !v)} aria-label="미니맵 (M)" title="미니맵 (M)">
                <MapIcon size={18} />
              </button>
              <button className={`hud-icon ${help ? 'is-active' : ''}`} onClick={() => setHelp((v) => !v)} aria-label="조작 도움말" title="조작 도움말">
                <CircleHelp size={18} />
              </button>
            </div>
          </div>

          {!focused && frames.length > 0 && (
            <div className="hud hud--bottom-right">
              <button className="btn btn--primary btn--pill" onClick={startTour}>
                <Play size={16} /> 작품 순서대로 감상
              </button>
            </div>
          )}

          {help && !focused && (
            <div className="help-card" role="note">
              <div>
                <kbd>드래그</kbd> 둘러보기
              </div>
              <div>
                <kbd>W A S D</kbd> <kbd>방향키</kbd> 이동
              </div>
              <div>
                <kbd>바닥 클릭</kbd> 그곳으로 걷기
              </div>
              <div>
                <kbd>작품 클릭</kbd> 가까이서 감상
              </div>
              <div>
                <kbd>M</kbd> 미니맵
              </div>
            </div>
          )}

          {nearElevator && !elevatorPanel && doc.floors.length > 1 && (
            <button className="elevator-hint" onClick={() => setElevatorPanel(true)}>
              <ArrowUpDown size={16} /> 엘리베이터 타기
            </button>
          )}

          {elevatorPanel && (
            <div className="elevator-panel" role="dialog" aria-label="엘리베이터">
              <div className="elevator-panel__head">
                <strong>엘리베이터</strong>
                <button className="icon-btn" onClick={() => setElevatorPanel(false)} aria-label="닫기">
                  <X size={18} />
                </button>
              </div>
              <div className="elevator-panel__floors">
                {[...doc.floors.keys()].reverse().map((k) => (
                  <button key={doc.floors[k].id} disabled={k === floorIndex} onClick={() => goFloor(k, nearElevator ?? engineRef.current?.floor?.elevators[0]?.id)}>
                    {doc.floors[k].name}
                    {k === floorIndex && <small>현재 층</small>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {focused && (
            <aside className="art-panel" aria-label="작품 정보">
              <button className="icon-btn art-panel__close" onClick={() => (setFocused(null), setTouring(false))} aria-label="닫기">
                <X size={18} />
              </button>
              <p className="art-panel__index">
                {touring ? '작품 감상' : '작품'} {focusIndex + 1} / {frames.length}
              </p>
              <h2>{art?.title || '무제'}</h2>
              <p className="art-panel__artist">
                {art?.artist}
                {art?.year && <span> · {art.year}</span>}
              </p>
              {art?.description && <p className="art-panel__desc">{art.description}</p>}
              <div className="art-panel__actions">
                <button className="btn btn--ghost" onClick={() => step(-1)} aria-label="이전 작품">
                  <ChevronLeft size={18} />
                </button>
                <button className="btn" onClick={() => art && setLightbox(art)}>
                  <Expand size={16} /> 크게 보기
                </button>
                <button className="btn btn--ghost" onClick={() => step(1)} aria-label="다음 작품">
                  <ChevronRight size={18} />
                </button>
              </div>
              {touring && focusIndex === frames.length - 1 && floorIndex < doc.floors.length - 1 && (
                <button className="btn btn--primary art-panel__next-floor" onClick={() => goFloor(floorIndex + 1)}>
                  {doc.floors[floorIndex + 1].name}로 이동해 계속 감상
                </button>
              )}
            </aside>
          )}
        </>
      )}

      {!entered && (
        <div className="welcome">
          <div className="welcome__card">
            <p className="eyebrow">초대장</p>
            <h1>{doc.title || '제목 없는 전시'}</h1>
            {doc.subtitle && <p className="welcome__sub">{doc.subtitle}</p>}
            {doc.description && <p className="welcome__desc">{doc.description}</p>}
            <dl className="welcome__meta">
              {doc.curator && (
                <div>
                  <dt>기획</dt>
                  <dd>{doc.curator}</dd>
                </div>
              )}
              <div>
                <dt>규모</dt>
                <dd>
                  {doc.floors.length}개 층 · 작품 {totalWorks}점
                </dd>
              </div>
            </dl>
            {doc.status === 'draft' && <p className="badge badge--draft">아직 공개되지 않은 초안 전시입니다</p>}
            <div className="welcome__actions">
              <button className="btn btn--primary btn--lg" onClick={() => setEntered(true)} autoFocus>
                전시관 입장하기
              </button>
              <a className="btn btn--ghost" href={href.visitList()}>
                목록으로
              </a>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="작품 크게 보기">
          <ArtworkImage source={lightbox.source} variant="full" alt={lightbox.title} className="lightbox__img" />
          <div className="lightbox__caption">
            <strong>{lightbox.title || '무제'}</strong>
            {lightbox.artist && <span> — {lightbox.artist}</span>}
          </div>
          <button className="icon-btn lightbox__close" aria-label="닫기">
            <X size={22} />
          </button>
        </div>
      )}
    </div>
  );
}
