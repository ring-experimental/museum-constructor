/** 영상 작품 업로드: 형식·길이 확인과 대표 이미지(포스터) 만들기 */

export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 15 * 60;
const POSTER_MAX = 640;

export function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

function once<T extends keyof HTMLMediaElementEventMap>(el: HTMLMediaElement, ok: T, timeoutMs = 15000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    el.addEventListener(
      ok,
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      'error',
      () => {
        clearTimeout(t);
        reject(new Error('media error'));
      },
      { once: true },
    );
  });
}

export async function prepareVideoFile(file: File): Promise<{ poster: Blob; width: number; height: number; duration: number }> {
  if (file.size > VIDEO_MAX_BYTES) throw new Error(`영상은 ${VIDEO_MAX_BYTES / 1024 / 1024}MB 이하만 올릴 수 있어요`);
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    video.src = url;
    try {
      await once(video, 'loadeddata');
    } catch {
      throw new Error('이 브라우저에서 재생할 수 없는 영상 형식이에요 (MP4 H.264 또는 WebM 을 권장해요)');
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > VIDEO_MAX_SECONDS) throw new Error(`영상은 ${VIDEO_MAX_SECONDS / 60}분 이하만 올릴 수 있어요`);
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('영상 크기를 알 수 없어요');
    // 검은 첫 프레임을 피해 앞부분 조금 뒤를 대표 이미지로
    const at = Math.min(1, duration * 0.1);
    if (at > 0) {
      video.currentTime = at;
      await once(video, 'seeked').catch(() => undefined);
    }
    const s = Math.min(1, POSTER_MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('대표 이미지를 만들지 못했어요'))), 'image/jpeg', 0.85));
    return { poster, width: w, height: h, duration };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
