import type { Exhibition, ID } from './types';

/**
 * 전시 문서가 참조하는 업로드 파일(이미지·영상·3D 모델·오디오) id 목록.
 * 내보내기·복제·정리처럼 '파일까지 함께' 다뤄야 하는 곳은 모두 이 함수를 쓴다.
 */
export function collectBlobIds(doc: Exhibition): ID[] {
  const ids = new Set<ID>();
  for (const a of doc.artworks) {
    if (a.source.kind === 'upload') ids.add(a.source.blobId);
    if (a.audioBlobId) ids.add(a.audioBlobId);
  }
  if (doc.audio.bgmBlobId) ids.add(doc.audio.bgmBlobId);
  return [...ids];
}

/** 파일 id 를 새 id 로 바꾼다 (복제·가져오기 후). 매핑이 없는 참조는 그대로 둔다 */
export function remapBlobIds(doc: Exhibition, map: ReadonlyMap<ID, ID>) {
  for (const a of doc.artworks) {
    if (a.source.kind === 'upload') a.source = { kind: 'upload', blobId: map.get(a.source.blobId) ?? a.source.blobId };
    if (a.audioBlobId) a.audioBlobId = map.get(a.audioBlobId) ?? a.audioBlobId;
  }
  if (doc.audio.bgmBlobId) doc.audio.bgmBlobId = map.get(doc.audio.bgmBlobId) ?? doc.audio.bgmBlobId;
}
