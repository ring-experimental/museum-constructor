import { ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, Expand, Glasses, Headphones, Link2, Map as MapIcon, Music, Pause, Play, Rotate3d, Volume2, VolumeX, X, ArrowUpDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { ArtworkVideo } from '../components/ArtworkVideo';
import { ModelViewer } from '../components/ModelViewer';
import { toast } from '../components/Toast';
import { resolveSpawn } from '../core/grid';
import type { Artwork, Exhibition, TextItem } from '../core/types';
import { absoluteHref, href, navigate, replaceHash } from '../router';
import { exhibitionRepo } from '../storage/exhibitionRepo';
import { imageRepo } from '../storage/imageRepo';
import { AudioGuide, checkSpeechSupport, onSpeechUnavailable, type Narration } from '../viewer/audioGuide';
import { isVRSupported, XRSupport } from '../viewer/xrSupport';
import * as THREE from 'three';
import { getArtworkVideo } from '../three/artworkTextures';
import { buildFloorScene, type FloorScene, type StopInfo } from '../three/buildFloor';
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
  xr: XRSupport;
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

/** 자동 투어에서 한 지점에 머무는 시간 (글이 길수록 길게) */
function dwellMs(stop: StopInfo): number {
  let chars = 0;
  if (stop.kind === 'text') {
    const t = stop.item as TextItem;
    chars = t.title.length + t.body.length;
  } else if (stop.artwork) chars = stop.artwork.title.length + stop.artwork.description.length;
  return Math.round(Math.min(30000, Math.max(6000, 5000 + chars * 90)));
}

/** 해설로 들려줄 내용 (녹음이 있으면 녹음, 없으면 음성 합성용 글) */
async function narrationFor(stop: StopInfo, tts: boolean): Promise<Narration> {
  if (stop.kind === 'text') {
    const t = stop.item as TextItem;
    return { text: tts ? [t.title, t.body].filter((s) => s.trim()).join('. ') : '' };
  }
  const a = stop.artwork;
  if (!a) return { text: '' };
  const audioUrl = a.audioBlobId ? await imageRepo.getURL(a.audioBlobId, 'full') : null;
  const who = a.artist ? `${a.artist}${a.year ? `, ${a.year}` : ''}` : a.year;
  return { audioUrl, text: tts ? [a.title || '무제', who, a.description].filter((s) => s && s.trim()).join('. ') : '' };
}

function applyPanelLayout(engine: Engine, focused: boolean) {
  const l = panelLayout(focused);
  engine.controller.availW = l.availW;
  engine.controller.availH = l.availH;
  engine.shift.tx = l.sx;
  engine.shift.ty = l.sy;
}

/** 공유 링크의 작품 id 가 있는 층 */
function floorOfStop(doc: Exhibition, stopId: string): number {
  return doc.floors.findIndex((f) => f.wallItems.some((w) => w.id === stopId) || f.props.some((p) => p.id === stopId));
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 클립보드 권한이 없는 환경: 직접 복사하도록 보여 준다
    window.prompt('아래 링크를 복사하세요', text);
    return false;
  }
}

export function VisitPage({ id, initialFloor, initialArt, from }: { id: string; initialFloor?: number; initialArt?: string; from?: string }) {
  const [doc, setDoc] = useState<Exhibition | null | undefined>(undefined);
  const [floorIndex, setFloorIndex] = useState(initialFloor ?? 0);
  const [entered, setEntered] = useState(from === 'editor');
  const [focused, setFocused] = useState<StopInfo | null>(null);
  const [stops, setStops] = useState<StopInfo[]>([]);
  const [nearElevator, setNearElevator] = useState<string | null>(null);
  const [elevatorPanel, setElevatorPanel] = useState(false);
  const [help, setHelp] = useState(true);
  const [showMap, setShowMap] = useState(() => !matchMedia('(max-width: 640px)').matches);
  const [lightbox, setLightbox] = useState<Artwork | null>(null);
  const [touring, setTouring] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  /** 카메라 이동이 끝나 감상 위치에 도착한 지점 */
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  /** 층을 옮긴 뒤 이어서 투어할지 */
  const continueTourRef = useRef(false);
  /** 자동 넘김: 현재 지점에서 이미 흐른 시간 (일시정지 후 이어가기) */
  const elapsedRef = useRef<{ id: string; ms: number }>({ id: '', ms: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const arrivalRef = useRef<'elevator' | 'spawn'>('spawn');
  /** 공유 링크로 들어왔을 때 입장 후 바로 보여 줄 작품 */
  const pendingArtRef = useRef<string | null>(initialArt ?? null);
  const [sharedTitle, setSharedTitle] = useState<string | null>(null);
  /** 감상 중인 영상 작품의 소리 */
  const [videoSound, setVideoSound] = useState(false);
  const guideRef = useRef<AudioGuide | null>(null);
  guideRef.current ??= new AudioGuide();
  /** 음성 해설 켜짐 */
  const [guideOn, setGuideOn] = useState(false);
  /** 브라우저 음성 합성 API 를 쓸 수 있는 환경인지 (아니면 음성 해설 기능을 막는다) */
  const [speechOk, setSpeechOk] = useState(false);
  /** 해설이 끝난 지점 (spoken = 실제로 들려줬는지) */
  const [narrated, setNarrated] = useState<{ id: string; spoken: boolean } | null>(null);
  const [bgmOn, setBgmOn] = useState(true);
  const [hasBgm, setHasBgm] = useState(false);
  const [vrSupported, setVrSupported] = useState(false);
  const [vrPresenting, setVrPresenting] = useState(false);
  /** VR 에서 엘리베이터를 가리키면 다음 층으로 (패널을 띄울 수 없으므로) */
  const nextFloorRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    exhibitionRepo.get(id).then((d) => {
      if (!alive) return;
      setDoc(d ?? null);
      if (!d) return;
      const artFloor = initialArt ? floorOfStop(d, initialArt) : -1;
      if (artFloor >= 0) {
        setFloorIndex(artFloor);
        const fl = d.floors[artFloor];
        const item = fl.wallItems.find((w) => w.id === initialArt);
        const prop = fl.props.find((p) => p.id === initialArt);
        const artId = item?.kind === 'frame' ? item.artworkId : prop?.artworkId;
        const art = artId ? d.artworks.find((a) => a.id === artId) : undefined;
        setSharedTitle(item?.kind === 'text' ? item.title || '벽 글' : (art?.title ?? null) || '작품');
      } else {
        pendingArtRef.current = null;
        if ((initialFloor ?? 0) >= d.floors.length) setFloorIndex(0);
      }
    });
    return () => {
      alive = false;
    };
  }, [id, initialFloor, initialArt]);

  const goToStop = useCallback((s: StopInfo) => {
    const engine = engineRef.current;
    if (!engine) return;
    applyPanelLayout(engine, true);
    setFocused(s);
    setArrivedId(null);
    engine.controller.focusStop(s, () => setArrivedId(s.id));
  }, []);

  // 엔진 생성 (문서 로드 후 1회)
  useEffect(() => {
    if (!doc || !containerRef.current) return;
    const stage = new Stage(containerRef.current, { renderMode: 'always', fov: 62, xr: true });
    stage.setLighting(doc.theme.lighting);
    const controller = new VisitorController(stage.camera, stage.renderer.domElement, {
      onStopClick: (f) => {
        setHelp(false);
        goToStop(f);
      },
      onElevatorClick: () => (controller.xrActive ? nextFloorRef.current() : setElevatorPanel(true)),
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
    const xr = new XRSupport(stage, controller, (presenting) => {
      setVrPresenting(presenting);
      if (presenting) {
        setFocused(null);
        setTouring(false);
        setHelp(false);
      }
    });
    const engine: Engine = { stage, controller, floor: null, doors: new Map(), transition: 0, shift: { x: 0, y: 0, tx: 0, ty: 0 }, xr };
    engineRef.current = engine;
    let lodTimer = 0;
    const eye = new THREE.Vector3();
    stage.onUpdate((dt) => {
      controller.update(dt);
      xr.update(dt);
      // 가까운 작품만 고해상도로 (0.25초마다)
      lodTimer -= dt;
      if (lodTimer <= 0) {
        lodTimer = 0.25;
        engine.floor?.updateLod(stage.camera.getWorldPosition(eye));
      }
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
      if (stage.renderer.xr.isPresenting || (Math.abs(sh.x) < 0.5 && Math.abs(sh.y) < 0.5 && sh.tx === 0 && sh.ty === 0)) {
        if (cam.view) cam.clearViewOffset();
      } else {
        const w = stage.renderer.domElement.clientWidth;
        const h = stage.renderer.domElement.clientHeight;
        cam.setViewOffset(w, h, sh.x, sh.y, w, h);
      }
    });
    return () => {
      xr.dispose();
      engine.floor?.dispose();
      controller.dispose();
      stage.dispose();
      engineRef.current = null;
    };
  }, [doc, goToStop]);

  useEffect(() => {
    let alive = true;
    void isVRSupported().then((ok) => alive && setVrSupported(ok));
    return () => {
      alive = false;
    };
  }, []);

  const enterVR = async () => {
    try {
      await engineRef.current?.xr.enter();
    } catch {
      toast('VR 기기에 연결하지 못했어요. 헤드셋이 켜져 있는지 확인해 주세요.', 'error');
    }
  };

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
    setStops(scene.stops);
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
    // 투어 중 층을 옮겼다면 새 층의 첫 지점부터 이어서
    if (continueTourRef.current) {
      continueTourRef.current = false;
      const first = scene.stops[0];
      if (first) {
        setTouring(true);
        const t = setTimeout(() => goToStop(first), 700);
        return () => clearTimeout(t);
      }
    }
  }, [doc, floorIndex, goToStop]);

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

  useEffect(() => {
    nextFloorRef.current = () => {
      if (doc && doc.floors.length > 1) goFloor((floorIndex + 1) % doc.floors.length, engineRef.current?.floor?.elevators[0]?.id);
    };
  }, [doc, floorIndex, goFloor]);

  // 패널이 닫히면 화면 중심 복귀
  useEffect(() => {
    const engine = engineRef.current;
    if (engine && !focused) applyPanelLayout(engine, false);
  }, [focused]);

  // 공유 링크: 입장하면 그 작품 앞으로
  useEffect(() => {
    const target = pendingArtRef.current;
    if (!entered || !target) return;
    const s = stops.find((x) => x.id === target);
    if (!s) return;
    pendingArtRef.current = null;
    const t = setTimeout(() => {
      setHelp(false);
      goToStop(s);
    }, 350);
    return () => clearTimeout(t);
  }, [entered, stops, goToStop]);

  // 지금 보고 있는 작품을 주소창에 반영 (새로고침·주소 복사로 공유 가능)
  useEffect(() => {
    if (!doc) return;
    replaceHash(href.visit(id, { floor: floorIndex || undefined, from, art: focused?.id ?? pendingArtRef.current ?? undefined }));
  }, [doc, id, floorIndex, from, focused]);

  // 영상 작품: 감상 중일 때만 소리 (영상은 가까이 가야 재생되므로 잠시 뒤에도 다시 적용)
  useEffect(() => {
    const art = focused?.artwork;
    if (!art || art.media !== 'video') return;
    const apply = () => {
      const v = getArtworkVideo(art.source);
      if (v) v.muted = !videoSound || !!lightbox;
    };
    apply();
    const t = setInterval(apply, 400);
    return () => {
      clearInterval(t);
      const v = getArtworkVideo(art.source);
      if (v) v.muted = true;
    };
  }, [focused, videoSound, lightbox]);

  // 배경 음악 준비
  useEffect(() => {
    const guide = guideRef.current!;
    const blobId = doc?.audio.bgmBlobId;
    if (!doc || !blobId) {
      guide.setBgm(null, 0);
      setHasBgm(false);
      return;
    }
    let alive = true;
    void imageRepo.getURL(blobId, 'full').then((url) => {
      if (!alive) return;
      guide.setBgm(url, doc.audio.bgmVolume);
      setHasBgm(!!url);
    });
    return () => {
      alive = false;
    };
  }, [doc]);

  // 입장하면 배경 음악 (브라우저가 자동 재생을 막으면 버튼으로 켜도록)
  useEffect(() => {
    if (!entered || !hasBgm) return;
    let alive = true;
    void guideRef.current!.setBgmPlaying(bgmOn).then((playing) => {
      if (alive && bgmOn && !playing) setBgmOn(false);
    });
    return () => {
      alive = false;
    };
  }, [entered, hasBgm, bgmOn]);

  useEffect(() => () => guideRef.current?.dispose(), []);

  // 음성 합성 지원 확인. 읽다가 엔진이 동작하지 않는 것이 드러나면 기능을 끈다
  useEffect(() => {
    let alive = true;
    void checkSpeechSupport().then((ok) => alive && setSpeechOk(ok));
    const off = onSpeechUnavailable(() => {
      if (!alive) return;
      setSpeechOk(false);
      setGuideOn(false);
      toast('이 브라우저에서는 음성 해설(음성 합성)을 쓸 수 없어 꺼 두었어요', 'error');
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // 음성 해설: 작품 앞에 도착하면 들려준다
  useEffect(() => {
    const guide = guideRef.current!;
    if (!guideOn || !speechOk || !focused || !doc) {
      guide.stopNarration();
      return;
    }
    if (arrivedId !== focused.id) return;
    let alive = true;
    void narrationFor(focused, doc.audio.tts)
      .then((n) => guide.narrate(n))
      .then((spoken) => alive && setNarrated({ id: focused.id, spoken }));
    return () => {
      alive = false;
      guide.stopNarration();
    };
  }, [guideOn, speechOk, focused, arrivedId, doc]);

  const shareStop = async (s: StopInfo) => {
    const ok = await copyText(absoluteHref(href.visit(id, { art: s.id })));
    if (ok) toast('이 작품으로 바로 오는 링크를 복사했어요', 'success');
  };

  const focusIndex = focused ? stops.findIndex((f) => f.id === focused.id) : -1;
  const step = useCallback(
    (dir: 1 | -1) => {
      if (!stops.length) return;
      if (focusIndex < 0) return goToStop(stops[0]);
      goToStop(stops[(focusIndex + dir + stops.length) % stops.length]);
    },
    [stops, focusIndex, goToStop],
  );

  const startTour = () => {
    if (!stops.length) return;
    setTouring(true);
    setAutoPlay(true);
    setHelp(false);
    goToStop(stops[0]);
  };

  /** 투어의 다음 지점으로 (층 끝이면 다음 층, 전시 끝이면 종료) */
  const advance = useCallback(() => {
    if (!doc) return;
    if (focusIndex >= 0 && focusIndex < stops.length - 1) return goToStop(stops[focusIndex + 1]);
    if (floorIndex < doc.floors.length - 1) {
      continueTourRef.current = true;
      goFloor(floorIndex + 1, engineRef.current?.floor?.elevators[0]?.id);
      return;
    }
    setTouring(false);
    setFocused(null);
    toast('모든 작품을 감상했어요. 관람해 주셔서 감사합니다.', 'success');
  }, [doc, focusIndex, stops, floorIndex, goFloor, goToStop]);

  // 음성 해설을 켰다면 해설이 끝난 뒤 잠깐 쉬고 넘어간다
  const guideActive = guideOn && speechOk;
  const narrating = guideActive && !!focused && narrated?.id !== focused.id;
  const stopDelay = focused ? (guideActive && narrated?.id === focused.id && narrated.spoken ? 2500 : dwellMs(focused)) : 0;

  // 자동 넘김 타이머 (도착한 뒤부터, 일시정지하면 남은 시간 보존)
  useEffect(() => {
    if (!touring || !autoPlay || !focused || arrivedId !== focused.id || lightbox || narrating) return;
    if (elapsedRef.current.id !== focused.id) elapsedRef.current = { id: focused.id, ms: 0 };
    const started = performance.now();
    const t = setTimeout(advance, Math.max(0, stopDelay - elapsedRef.current.ms));
    return () => {
      clearTimeout(t);
      if (elapsedRef.current.id === focused.id) elapsedRef.current.ms += performance.now() - started;
    };
  }, [touring, autoPlay, focused, arrivedId, lightbox, advance, narrating, stopDelay]);

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
      if (touring && e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        setAutoPlay((v) => !v);
      }
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) setShowMap((v) => !v);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [focused, elevatorPanel, lightbox, step, touring]);

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
  const text = focused?.kind === 'text' ? (focused.item as TextItem) : null;
  const workCount = stops.filter((s) => s.kind === 'frame').length;

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
                {floor?.name} · 작품 {workCount}점
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
              {vrSupported && (
                <button className={`hud-icon ${vrPresenting ? 'is-active' : ''}`} onClick={() => (vrPresenting ? engineRef.current?.xr.exit() : enterVR())} aria-label="VR로 보기" title="VR 헤드셋으로 관람 (컨트롤러로 가리키고 트리거: 이동·감상 / 스틱: 이동·회전)">
                  <Glasses size={18} />
                </button>
              )}
              <button className={`hud-icon ${help ? 'is-active' : ''}`} onClick={() => setHelp((v) => !v)} aria-label="조작 도움말" title="조작 도움말">
                <CircleHelp size={18} />
              </button>
              {speechOk && (
                <button
                  className={`hud-icon ${guideOn ? 'is-active' : ''}`}
                  onClick={() => setGuideOn((v) => !v)}
                  aria-pressed={guideOn}
                  aria-label="음성 해설"
                  title={guideOn ? '음성 해설 끄기' : '음성 해설 켜기 — 작품 앞에 서면 설명을 들려줘요'}
                >
                  <Headphones size={18} />
                </button>
              )}
              {hasBgm && (
                <button className={`hud-icon ${bgmOn ? 'is-active' : ''}`} onClick={() => setBgmOn((v) => !v)} aria-pressed={bgmOn} aria-label="배경 음악" title={bgmOn ? '배경 음악 끄기' : '배경 음악 켜기'}>
                  <Music size={18} />
                </button>
              )}
            </div>
          </div>

          {!focused && stops.length > 0 && (
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
                {touring ? '순서대로 감상' : text ? '벽 글' : focused.kind === 'object' ? '입체 작품' : '작품'} {focusIndex + 1} / {stops.length}
              </p>
              {text ? (
                <>
                  <h2>{text.title || '안내'}</h2>
                  {text.body && <p className="art-panel__desc art-panel__desc--text">{text.body}</p>}
                </>
              ) : (
                <>
                  <h2>{art?.title || '무제'}</h2>
                  <p className="art-panel__artist">
                    {art?.artist}
                    {art?.year && <span> · {art.year}</span>}
                  </p>
                  {art?.description && <p className="art-panel__desc">{art.description}</p>}
                </>
              )}
              {touring && (
                <div className="tour-bar">
                  <button className="icon-btn" onClick={() => setAutoPlay((v) => !v)} aria-label={autoPlay ? '자동 넘김 일시정지 (스페이스)' : '자동 넘김 재생 (스페이스)'} title={autoPlay ? '일시정지 (스페이스)' : '자동 넘김 (스페이스)'}>
                    {autoPlay ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <div className="tour-bar__track" aria-hidden>
                    <i
                      key={`${focused.id}:${stopDelay}`}
                      style={{
                        animationDuration: `${stopDelay}ms`,
                        animationPlayState: autoPlay && arrivedId === focused.id && !lightbox && !narrating ? 'running' : 'paused',
                      }}
                    />
                  </div>
                  <span className="tour-bar__label">{!autoPlay ? '일시정지' : narrating ? '해설 중' : '자동 넘김'}</span>
                </div>
              )}
              <div className="art-panel__actions">
                <button className="btn btn--ghost" onClick={() => step(-1)} aria-label="이전">
                  <ChevronLeft size={18} />
                </button>
                {art && (
                  <button className="btn" onClick={() => setLightbox(art)}>
                    {art.media === 'model' ? <Rotate3d size={16} /> : <Expand size={16} />} {art.media === 'model' ? '돌려 보기' : '크게 보기'}
                  </button>
                )}
                <button className="btn btn--ghost" onClick={() => step(1)} aria-label="다음">
                  <ChevronRight size={18} />
                </button>
              </div>
              {art?.media === 'video' && (
                <button className="btn btn--sm art-panel__sound" onClick={() => setVideoSound((v) => !v)} aria-pressed={videoSound}>
                  {videoSound ? <Volume2 size={15} /> : <VolumeX size={15} />} {videoSound ? '영상 소리 끄기' : '영상 소리 켜기'}
                </button>
              )}
              <button className="link-btn art-panel__share" onClick={() => shareStop(focused)}>
                <Link2 size={14} /> {text ? '이 글' : '이 작품'} 링크 복사
              </button>
              {touring && focusIndex === stops.length - 1 && floorIndex < doc.floors.length - 1 && (
                <button
                  className="btn btn--primary art-panel__next-floor"
                  onClick={() => {
                    continueTourRef.current = true;
                    goFloor(floorIndex + 1, engineRef.current?.floor?.elevators[0]?.id);
                  }}
                >
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
            {sharedTitle && (
              <p className="welcome__shared">
                공유받은 작품 <strong>〈{sharedTitle}〉</strong> 앞에서 관람을 시작해요
              </p>
            )}
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
          {lightbox.media === 'video' ? (
            <div onClick={(e) => e.stopPropagation()}>
              <ArtworkVideo source={lightbox.source} className="lightbox__img" />
            </div>
          ) : lightbox.media === 'model' ? (
            <div className="lightbox__model" onClick={(e) => e.stopPropagation()}>
              <ModelViewer source={lightbox.source} />
              <p className="lightbox__hint">드래그해서 돌려 보고, 휠로 확대해요</p>
            </div>
          ) : (
            <ArtworkImage source={lightbox.source} variant="full" alt={lightbox.title} className="lightbox__img" />
          )}
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
