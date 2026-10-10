/** 캔버스(3D 텍스처)에 글자를 그릴 때 쓰는 공통 도구 */

/** UI 와 같은 폰트. pretendard 패키지는 'Pretendard Variable' 이름으로 등록된다 */
export const CANVAS_FONT_FAMILY = "'Pretendard Variable', Pretendard, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export const canvasFont = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${CANVAS_FONT_FAMILY}`;

/**
 * 폰트(동적 서브셋 포함)가 아직 준비되지 않았으면 로드가 끝날 때 resolve.
 * 이미 준비돼 있으면 null 을 돌려줘 다시 그릴 필요가 없음을 알린다.
 */
export function whenFontReady(font: string, text: string): Promise<void> | null {
  if (typeof document === 'undefined' || !document.fonts) return null;
  const sample = text || '가';
  try {
    if (document.fonts.check(font, sample)) return null;
  } catch {
    return null;
  }
  return document.fonts.load(font, sample).then(() => undefined);
}

/**
 * 어절(띄어쓰기) 단위로 줄바꿈하고, 한 어절이 너무 길면 글자 단위로 끊는다.
 * 줄바꿈 문자(\n)는 문단 구분으로 유지한다.
 */
export function wrapText(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines = Infinity): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (out.length >= maxLines) break;
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let cur = '';
    const tokens = para.split(/(\s+)/).filter(Boolean);
    for (const tok of tokens) {
      if (!cur && /^\s+$/.test(tok)) continue;
      const next = cur + tok;
      if (g.measureText(next).width <= maxW) {
        cur = next;
        continue;
      }
      if (/^\s+$/.test(tok)) {
        // 줄 끝 공백은 버린다
        out.push(cur);
        cur = '';
        continue;
      }
      if (cur.trim()) out.push(cur.trimEnd());
      cur = '';
      // 어절 자체가 한 줄보다 길면 글자 단위로
      let piece = '';
      for (const ch of tok) {
        if (g.measureText(piece + ch).width > maxW && piece) {
          out.push(piece);
          piece = ch;
        } else piece += ch;
      }
      cur = piece;
    }
    out.push(cur.trimEnd());
  }
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = out[maxLines - 1].replace(/.?$/, '…');
  }
  return out;
}
