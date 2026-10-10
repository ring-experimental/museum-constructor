/**
 * 업로드한 사진의 메타데이터(EXIF)에서 작품 정보를 미리 채우기 위한 최소 파서.
 * JPEG 의 APP1(Exif) 블록만 읽는다. 저장할 때는 이미지를 다시 인코딩하므로
 * 위치 정보 같은 원본 메타데이터는 보관되지 않는다.
 */

export interface PhotoMeta {
  title?: string;
  artist?: string;
  description?: string;
  /** 촬영 연도 (YYYY) */
  year?: string;
}

const TAG = {
  ImageDescription: 0x010e,
  Artist: 0x013b,
  DateTime: 0x0132,
  ExifIFD: 0x8769,
  DateTimeOriginal: 0x9003,
  XPTitle: 0x9c9b,
  XPComment: 0x9c9c,
  XPAuthor: 0x9c9d,
  XPSubject: 0x9c9f,
} as const;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** 카메라가 자동으로 넣는 의미 없는 설명 */
const JUNK = /^(olympus digital camera|sony dsc|digital camera|camera|dcim|default|image|picture|photo|untitled|samsung|lg|canon|nikon|exif_jpeg_\d*|\s*)$/i;

function clean(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\0+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t || JUNK.test(t)) return undefined;
  return t;
}

interface Entry {
  type: number;
  count: number;
  /** 값이 있는 위치 (TIFF 헤더 기준이 아닌 DataView 절대 위치) */
  at: number;
}

function readIFD(v: DataView, tiff: number, offset: number, le: boolean): Map<number, Entry> {
  const out = new Map<number, Entry>();
  const start = tiff + offset;
  if (start + 2 > v.byteLength) return out;
  const n = v.getUint16(start, le);
  for (let k = 0; k < n; k++) {
    const p = start + 2 + k * 12;
    if (p + 12 > v.byteLength) break;
    const tag = v.getUint16(p, le);
    const type = v.getUint16(p + 2, le);
    const count = v.getUint32(p + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const at = size <= 4 ? p + 8 : tiff + v.getUint32(p + 8, le);
    if (at + size > v.byteLength) continue;
    out.set(tag, { type, count, at });
  }
  return out;
}

function ascii(v: DataView, e: Entry | undefined): string | undefined {
  if (!e || (e.type !== 2 && e.type !== 7 && e.type !== 1)) return undefined;
  const bytes = new Uint8Array(v.buffer, v.byteOffset + e.at, e.count);
  // 일부 기기는 ASCII 칸에 UTF-8 을 넣는다
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Windows 탐색기 속성(제목·작성자)이 쓰는 UCS-2 필드 */
function xp(v: DataView, e: Entry | undefined): string | undefined {
  if (!e || e.type !== 1) return undefined;
  const bytes = new Uint8Array(v.buffer, v.byteOffset + e.at, e.count);
  return new TextDecoder('utf-16le').decode(bytes);
}

function yearOf(s: string | undefined): string | undefined {
  const m = s?.match(/^(\d{4})[:\-.]/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100 ? m[1] : undefined;
}

/** JPEG 바이트에서 메타데이터를 읽는다. 없거나 깨졌으면 빈 객체 */
export function parseExif(buf: ArrayBuffer): PhotoMeta {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
    let p = 2;
    while (p + 4 <= v.byteLength) {
      const marker = v.getUint16(p);
      if ((marker & 0xff00) !== 0xff00) return {};
      // SOS 이후는 영상 데이터
      if (marker === 0xffda || marker === 0xffd9) return {};
      const len = v.getUint16(p + 2);
      if (marker === 0xffe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966 /* Exif */ && v.getUint16(p + 8) === 0) {
        const tiff = p + 10;
        const le = v.getUint16(tiff) === 0x4949;
        if (v.getUint16(tiff + 2, le) !== 42) return {};
        const ifd0 = readIFD(v, tiff, v.getUint32(tiff + 4, le), le);
        const exifPtr = ifd0.get(TAG.ExifIFD);
        const exif = exifPtr ? readIFD(v, tiff, v.getUint32(exifPtr.at, le), le) : new Map<number, Entry>();
        const meta: PhotoMeta = {
          title: clean(xp(v, ifd0.get(TAG.XPTitle))) ?? clean(xp(v, ifd0.get(TAG.XPSubject))),
          artist: clean(xp(v, ifd0.get(TAG.XPAuthor))) ?? clean(ascii(v, ifd0.get(TAG.Artist))),
          description: clean(xp(v, ifd0.get(TAG.XPComment))) ?? clean(ascii(v, ifd0.get(TAG.ImageDescription))),
          year: yearOf(ascii(v, exif.get(TAG.DateTimeOriginal))) ?? yearOf(ascii(v, ifd0.get(TAG.DateTime))),
        };
        for (const k of Object.keys(meta) as (keyof PhotoMeta)[]) if (meta[k] === undefined) delete meta[k];
        return meta;
      }
      p += 2 + len;
    }
  } catch {
    /* 메타데이터는 있으면 좋은 정보일 뿐 — 실패해도 업로드는 계속 */
  }
  return {};
}

/** 파일 앞부분만 읽어 메타데이터 추출 */
export async function readPhotoMeta(file: Blob): Promise<PhotoMeta> {
  if (file.type && file.type !== 'image/jpeg') return {};
  try {
    return parseExif(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return {};
  }
}
