import { describe, expect, it } from 'vitest';
import { parseExif } from './exif';

/** 테스트용 최소 JPEG: SOI + APP1(Exif, 리틀엔디언 TIFF) + SOS */
function jpegWithExif(opts: { artist?: string; xpTitle?: string; dateOriginal?: string; description?: string }) {
  const enc = new TextEncoder();
  const data: { tag: number; type: number; bytes: Uint8Array }[] = [];
  if (opts.description) data.push({ tag: 0x010e, type: 2, bytes: enc.encode(opts.description + '\0') });
  if (opts.artist) data.push({ tag: 0x013b, type: 2, bytes: enc.encode(opts.artist + '\0') });
  if (opts.xpTitle) {
    const s = opts.xpTitle + '\0';
    const b = new Uint8Array(s.length * 2);
    for (let k = 0; k < s.length; k++) {
      b[k * 2] = s.charCodeAt(k) & 0xff;
      b[k * 2 + 1] = s.charCodeAt(k) >> 8;
    }
    data.push({ tag: 0x9c9b, type: 1, bytes: b });
  }
  const hasExif = !!opts.dateOriginal;
  const n0 = data.length + (hasExif ? 1 : 0);
  const tiff = new Uint8Array(512);
  const v = new DataView(tiff.buffer);
  v.setUint16(0, 0x4949);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, n0, true);
  let heap = 8 + 2 + n0 * 12 + 4;
  const entries: [number, number, number, number][] = [];
  for (const d of data) {
    let value = heap;
    if (d.bytes.length <= 4) {
      value = 0;
      for (let k = 0; k < d.bytes.length; k++) value |= d.bytes[k] << (8 * k);
    } else {
      tiff.set(d.bytes, heap);
      heap += d.bytes.length + (d.bytes.length % 2);
    }
    entries.push([d.tag, d.type, d.bytes.length, value]);
  }
  let exifAt = 0;
  if (hasExif) {
    exifAt = heap;
    heap += 2 + 12 + 4;
    entries.push([0x8769, 4, 1, exifAt]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  entries.forEach(([tag, type, count, value], k) => {
    const p = 10 + k * 12;
    v.setUint16(p, tag, true);
    v.setUint16(p + 2, type, true);
    v.setUint32(p + 4, count, true);
    v.setUint32(p + 8, value, true);
  });
  if (hasExif) {
    const s = enc.encode(opts.dateOriginal + '\0');
    v.setUint16(exifAt, 1, true);
    v.setUint16(exifAt + 2, 0x9003, true);
    v.setUint16(exifAt + 4, 2, true);
    v.setUint32(exifAt + 6, s.length, true);
    v.setUint32(exifAt + 10, heap, true);
    tiff.set(s, heap);
    heap += s.length;
  }
  const tiffLen = heap;
  const out = new Uint8Array(2 + 4 + 6 + tiffLen + 4);
  const o = new DataView(out.buffer);
  o.setUint16(0, 0xffd8);
  o.setUint16(2, 0xffe1);
  o.setUint16(4, 2 + 6 + tiffLen);
  out.set(enc.encode('Exif'), 6);
  out.set(tiff.subarray(0, tiffLen), 12);
  o.setUint16(12 + tiffLen, 0xffda);
  return out.buffer;
}

describe('parseExif', () => {
  it('reads title, artist and year from EXIF / Windows properties', () => {
    const meta = parseExif(jpegWithExif({ artist: 'Kim Haneul', xpTitle: '새벽 바다', dateOriginal: '2021:05:03 10:00:00' }));
    expect(meta).toEqual({ title: '새벽 바다', artist: 'Kim Haneul', year: '2021' });
  });

  it('ignores camera boilerplate descriptions', () => {
    expect(parseExif(jpegWithExif({ description: 'OLYMPUS DIGITAL CAMERA', artist: 'Lee' }))).toEqual({ artist: 'Lee' });
    expect(parseExif(jpegWithExif({ description: '바다 위의 첫 햇살' })).description).toBe('바다 위의 첫 햇살');
  });

  it('returns an empty result for non-JPEG or broken data', () => {
    expect(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({});
    expect(parseExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00]).buffer)).toEqual({});
    expect(parseExif(new ArrayBuffer(0))).toEqual({});
  });
});
