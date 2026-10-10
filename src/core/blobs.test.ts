import { describe, expect, it } from 'vitest';
import { collectBlobIds, remapBlobIds } from './blobs';
import { blankExhibition } from './factory';
import type { Artwork } from './types';

const art = (id: string, source: Artwork['source'], audioBlobId: string | null = null): Artwork => ({
  id,
  media: 'image',
  source,
  width: 1,
  height: 1,
  title: '',
  artist: '',
  year: '',
  description: '',
  audioBlobId,
});

describe('blob references', () => {
  it('collects every uploaded file once (artworks, narration, background music)', () => {
    const ex = blankExhibition('t');
    ex.artworks = [art('a', { kind: 'upload', blobId: 'img1' }, 'aud1'), art('b', { kind: 'url', url: 'https://x/y.jpg' }), art('c', { kind: 'upload', blobId: 'img1' })];
    ex.audio.bgmBlobId = 'bgm1';
    expect(collectBlobIds(ex).sort()).toEqual(['aud1', 'bgm1', 'img1']);
  });

  it('remaps ids and leaves unknown references alone', () => {
    const ex = blankExhibition('t');
    ex.artworks = [art('a', { kind: 'upload', blobId: 'img1' }, 'aud1'), art('b', { kind: 'upload', blobId: 'img2' })];
    ex.audio.bgmBlobId = 'bgm1';
    remapBlobIds(ex, new Map([
      ['img1', 'n1'],
      ['aud1', 'n2'],
      ['bgm1', 'n3'],
    ]));
    expect(ex.artworks.map((a) => (a.source.kind === 'upload' ? a.source.blobId : ''))).toEqual(['n1', 'img2']);
    expect(ex.artworks[0].audioBlobId).toBe('n2');
    expect(ex.audio.bgmBlobId).toBe('n3');
  });
});
