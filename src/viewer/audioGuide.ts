/**
 * 관람 중 소리: 배경 음악 + 작품 해설(녹음 파일 또는 음성 합성).
 * 해설이 나오는 동안은 배경 음악을 줄인다(ducking).
 */

export interface Narration {
  /** 업로드한 해설 녹음 주소 */
  audioUrl?: string | null;
  /** 녹음이 없을 때 음성 합성으로 읽을 글 */
  text: string;
}

const DUCK = 0.25;

/**
 * 해설 음성은 브라우저 기본 음성 합성 API(Web Speech API, speechSynthesis)를 쓴다.
 * 음성을 직접 고르지 않고 언어(ko-KR)만 알려 주면 브라우저가 기본 음성을 고른다.
 */
const SPEECH_LANG = 'ko-KR';

/** 다시 시도해도 소용없는 오류 (엔진 없음·고장·오디오 장치 없음) → 음성 해설을 막는다 */
const FATAL_SPEECH_ERRORS = new Set(['synthesis-unavailable', 'synthesis-failed', 'audio-hardware']);

let speechBroken = false;
const brokenListeners = new Set<() => void>();
let supportPromise: Promise<boolean> | null = null;

function hasSpeechApi() {
  return !speechBroken && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

/**
 * 이 환경에서 음성 해설을 쓸 수 있는지.
 * API 가 있고, 브라우저(OS)가 제공하는 음성이 하나라도 있어야 한다. 음성 목록은 비동기로 채워진다.
 */
export function checkSpeechSupport(): Promise<boolean> {
  if (!hasSpeechApi()) return Promise.resolve(false);
  supportPromise ??= new Promise<boolean>((resolve) => {
    const has = () => speechSynthesis.getVoices().length > 0;
    if (has()) return resolve(true);
    const t = setTimeout(() => resolve(has()), 1500);
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(t);
        resolve(has());
      },
      { once: true },
    );
  });
  return supportPromise.then((ok) => ok && !speechBroken);
}

/** 실제로 읽어 보다가 엔진이 동작하지 않는 것이 확인되면 알림 (기능을 끄도록) */
export function onSpeechUnavailable(fn: () => void) {
  brokenListeners.add(fn);
  return () => {
    brokenListeners.delete(fn);
  };
}

function markSpeechBroken() {
  if (speechBroken) return;
  speechBroken = true;
  brokenListeners.forEach((fn) => fn());
}

/** 문장 단위로 끊어 읽는다 (일부 브라우저는 긴 문장을 중간에 멈춘다) */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export class AudioGuide {
  private bgm: HTMLAudioElement | null = null;
  private bgmVolume = 0.35;
  private narr: HTMLAudioElement | null = null;
  private token = 0;
  private ducked = false;

  setBgm(url: string | null, volume: number) {
    if (this.bgm && this.bgm.src !== url) {
      this.bgm.pause();
      this.bgm = null;
    }
    this.bgmVolume = volume;
    if (url && !this.bgm) {
      this.bgm = new Audio(url);
      this.bgm.loop = true;
    }
    this.applyVolume();
  }

  get hasBgm() {
    return !!this.bgm;
  }

  /** 배경 음악 재생/정지. 자동 재생이 막히면 false */
  async setBgmPlaying(on: boolean): Promise<boolean> {
    if (!this.bgm) return false;
    if (!on) {
      this.bgm.pause();
      return false;
    }
    try {
      await this.bgm.play();
      return true;
    } catch {
      return false;
    }
  }

  private applyVolume() {
    if (this.bgm) this.bgm.volume = this.bgmVolume * (this.ducked ? DUCK : 1);
  }

  private duck(on: boolean) {
    this.ducked = on;
    this.applyVolume();
  }

  /** 해설을 들려준다. 끝까지 들려줬으면 true, 들려줄 수 없거나 중간에 멈추면 false */
  async narrate(n: Narration): Promise<boolean> {
    this.stopNarration();
    const my = ++this.token;
    this.duck(true);
    try {
      if (n.audioUrl) return await this.playRecording(n.audioUrl, my);
      if (n.text.trim()) return await this.speak(n.text, my);
      return false;
    } finally {
      if (my === this.token) this.duck(false);
    }
  }

  private playRecording(url: string, my: number): Promise<boolean> {
    return new Promise((resolve) => {
      const a = new Audio(url);
      this.narr = a;
      a.addEventListener('ended', () => resolve(my === this.token), { once: true });
      a.addEventListener('error', () => resolve(false), { once: true });
      a.addEventListener('pause', () => !a.ended && resolve(false), { once: true });
      a.play().catch(() => resolve(false));
    });
  }

  private async speak(text: string, my: number): Promise<boolean> {
    if (!(await checkSpeechSupport()) || my !== this.token) return false;
    for (const s of sentences(text)) {
      if (my !== this.token) return false;
      const ok = await new Promise<boolean>((resolve) => {
        const u = new SpeechSynthesisUtterance(s);
        u.lang = SPEECH_LANG;
        u.onend = () => resolve(true);
        u.onerror = (e) => {
          if (FATAL_SPEECH_ERRORS.has(e.error)) markSpeechBroken();
          resolve(false);
        };
        speechSynthesis.speak(u);
      });
      if (!ok) return false;
    }
    return my === this.token;
  }

  stopNarration() {
    this.token++;
    if (this.narr) {
      this.narr.pause();
      this.narr = null;
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.duck(false);
  }

  dispose() {
    this.stopNarration();
    this.bgm?.pause();
    this.bgm = null;
  }
}
