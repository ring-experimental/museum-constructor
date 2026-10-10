import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 브라우저 음성 합성(Web Speech API)·오디오를 흉내 내는 가짜 */
class FakeUtterance {
  voice: unknown = null;
  lang = '';
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

function installSpeech(voices: { lang: string; name: string }[], opts: { error?: string } = {}) {
  const spoken: FakeUtterance[] = [];
  let current: FakeUtterance | null = null;
  const synth = {
    getVoices: () => voices,
    speak(u: FakeUtterance) {
      spoken.push(u);
      current = u;
      // 다음 틱에 끝(또는 실패)
      setTimeout(() => (opts.error ? u.onerror?.({ error: opts.error }) : u.onend?.()), 5);
    },
    cancel() {
      current?.onerror?.({ error: 'interrupted' });
      current = null;
    },
    addEventListener() {},
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return spoken;
}

class FakeAudio {
  volume = 1;
  loop = false;
  paused = true;
  ended = false;
  private handlers: Record<string, (() => void)[]> = {};
  constructor(public src = '') {}
  addEventListener(type: string, fn: () => void) {
    (this.handlers[type] ??= []).push(fn);
  }
  emit(type: string) {
    for (const fn of this.handlers[type] ?? []) fn();
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
}

let audios: FakeAudio[] = [];

beforeEach(() => {
  vi.resetModules();
  audios = [];
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor(src?: string) {
        super(src);
        audios.push(this);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('AudioGuide', () => {
  it('reads with the browser default voice (only the language is hinted) and ducks the music meanwhile', async () => {
    // 한국어 음성이 따로 없어도 브라우저 기본 음성으로 읽는다
    const spoken = installSpeech([{ lang: 'en-US', name: 'en' }]);
    const { AudioGuide } = await import('./audioGuide');
    const g = new AudioGuide();
    g.setBgm('bgm.mp3', 0.4);
    const bgm = audios[0];
    const p = g.narrate({ text: '새벽의 수평선. 샘플 작가, 2026. 바다 위의 첫 햇살입니다.' });
    await new Promise((r) => setTimeout(r, 1));
    expect(bgm.volume).toBeCloseTo(0.1);
    expect(await p).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual(['새벽의 수평선.', '샘플 작가, 2026.', '바다 위의 첫 햇살입니다.']);
    expect(spoken.every((u) => u.voice === null && u.lang === 'ko-KR')).toBe(true);
    expect(bgm.volume).toBeCloseTo(0.4);
  });

  it('is unavailable without the speech API or without any voice', async () => {
    const m1 = await import('./audioGuide');
    expect(await m1.checkSpeechSupport()).toBe(false);
    expect(await new m1.AudioGuide().narrate({ text: '안녕하세요.' })).toBe(false);

    vi.resetModules();
    const spoken = installSpeech([]);
    const m2 = await import('./audioGuide');
    expect(await m2.checkSpeechSupport()).toBe(false);
    expect(await new m2.AudioGuide().narrate({ text: '안녕하세요.' })).toBe(false);
    expect(spoken).toEqual([]);
  });

  it('turns the feature off for good when the speech engine fails', async () => {
    installSpeech([{ lang: 'ko-KR', name: 'Heami' }], { error: 'synthesis-failed' });
    const { AudioGuide, checkSpeechSupport, onSpeechUnavailable } = await import('./audioGuide');
    expect(await checkSpeechSupport()).toBe(true);
    const off = vi.fn();
    onSpeechUnavailable(off);
    expect(await new AudioGuide().narrate({ text: '실패합니다.' })).toBe(false);
    expect(off).toHaveBeenCalledTimes(1);
    expect(await checkSpeechSupport()).toBe(false);
  });

  it('keeps the feature when speech is only blocked or stopped midway', async () => {
    installSpeech([{ lang: 'ko-KR', name: 'Heami' }], { error: 'not-allowed' });
    const m1 = await import('./audioGuide');
    const off = vi.fn();
    m1.onSpeechUnavailable(off);
    expect(await new m1.AudioGuide().narrate({ text: '사용자 동작 전에는 막혀요.' })).toBe(false);
    expect(off).not.toHaveBeenCalled();
    expect(await m1.checkSpeechSupport()).toBe(true);

    vi.resetModules();
    installSpeech([{ lang: 'ko-KR', name: 'Heami' }]);
    const m2 = await import('./audioGuide');
    const g = new m2.AudioGuide();
    const p = g.narrate({ text: '첫 문장. 두 번째 문장.' });
    await new Promise((r) => setTimeout(r, 1));
    g.stopNarration();
    expect(await p).toBe(false);
    expect(await m2.checkSpeechSupport()).toBe(true);
  });

  it('prefers the uploaded recording over speech', async () => {
    const spoken = installSpeech([{ lang: 'ko-KR', name: 'Heami' }]);
    const { AudioGuide } = await import('./audioGuide');
    const g = new AudioGuide();
    const p = g.narrate({ audioUrl: 'blob:rec', text: '읽으면 안 됨.' });
    await new Promise((r) => setTimeout(r, 1));
    const rec = audios.find((a) => a.src === 'blob:rec')!;
    rec.ended = true;
    rec.emit('ended');
    expect(await p).toBe(true);
    expect(spoken).toEqual([]);
  });
});
