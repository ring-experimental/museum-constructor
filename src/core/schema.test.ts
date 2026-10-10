import { describe, expect, it } from 'vitest';
import { createExhibitionFromTemplate } from './factory';
import { migrateExhibition, SchemaError } from './schema';
import { SCHEMA_VERSION } from './types';

/** 첫 프로토타입(v1)이 저장하던 모양 그대로의 문서 */
function v1Doc() {
  return {
    schemaVersion: 1,
    id: 'ex_old',
    title: '옛 전시',
    subtitle: '',
    description: '',
    curator: '',
    status: 'published',
    coverArtworkId: 'art_1',
    theme: { wallColor: '#F4F2EE', floorStyle: 'oak', lighting: 'warm' },
    artworks: [{ id: 'art_1', source: { kind: 'upload', blobId: 'img_1' }, width: 1200, height: 800, title: 'A', artist: 'B', year: '2020', description: '' }],
    floors: [
      {
        id: 'fl_1',
        name: '1F',
        cols: 4,
        rows: 3,
        wallHeight: 4,
        cells: [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
        partitions: [],
        wallItems: [{ id: 'fr_1', kind: 'frame', edge: 'h:1:1', side: 1, offset: 0, artworkId: 'art_1', width: 1.1, elevation: 1.55, frameStyle: 'black', mat: 0.08, showCaption: true }],
        props: [],
        spawn: null,
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
  };
}

describe('migrateExhibition', () => {
  it('upgrades a v1 document without losing data', () => {
    const doc = migrateExhibition(v1Doc());
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.floors[0].tourOrder).toEqual([]);
    expect(doc.artworks[0].media).toBe('image');
    expect(doc.floors[0].wallItems[0]).toMatchObject({ id: 'fr_1', kind: 'frame', artworkId: 'art_1' });
    expect(doc.theme.wallColor).toBe('#f4f2ee');
    expect(doc.status).toBe('published');
    expect(doc.coverArtworkId).toBe('art_1');
  });

  it('keeps current documents unchanged', () => {
    const ex = createExhibitionFromTemplate('twofloor', '새 전시');
    expect(migrateExhibition(structuredClone(ex))).toEqual(ex);
  });

  it('rejects documents from a newer app version', () => {
    expect(() => migrateExhibition({ ...v1Doc(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(SchemaError);
    expect(() => migrateExhibition('nope')).toThrow(SchemaError);
    expect(() => migrateExhibition({ schemaVersion: 1, floors: 'x', artworks: [] })).toThrow(SchemaError);
  });

  it('repairs broken grids and drops unusable items', () => {
    const raw = v1Doc();
    const f = raw.floors[0] as Record<string, unknown>;
    f.cols = 999; // 최대 격자로 잘림
    f.cells = [1, 1]; // 길이가 맞지 않음
    f.wallItems = [
      { id: 'x', kind: 'frame', edge: 'h:9999:1', side: 1, offset: 0 }, // 격자 밖
      { id: 'y', kind: 'hologram', edge: 'h:1:1', side: 1, offset: 0 }, // 모르는 종류
      { id: 'e1', kind: 'elevator', edge: 'h:1:1', side: 1, offset: 0.7 },
      { id: 'e2', kind: 'elevator', edge: 'h:2:1', side: 1, offset: 0 }, // 층마다 하나
      { id: 'fr_dangling', kind: 'frame', edge: 'v:1:1', side: 1, offset: 5, artworkId: 'deleted', width: 99 },
    ];
    f.tourOrder = ['fr_dangling', 'x', 42];
    const doc = migrateExhibition(raw);
    const fl = doc.floors[0];
    expect(fl.cols).toBe(40);
    expect(fl.cells).toHaveLength(40 * 3);
    expect(fl.cells.slice(0, 3)).toEqual([1, 1, 0]);
    expect(fl.wallItems.map((w) => w.id)).toEqual(['e1', 'fr_dangling']);
    expect(fl.wallItems[0].offset).toBe(0);
    const fr = fl.wallItems[1];
    expect(fr.kind === 'frame' && fr.artworkId).toBe(null);
    expect(fr.kind === 'frame' && fr.width).toBe(4);
    expect(fr.offset).toBe(1);
    expect(fl.tourOrder).toEqual(['fr_dangling']);
  });

  it('drops artworks with unsafe or unknown sources and fixes duplicate ids', () => {
    const raw = v1Doc();
    raw.artworks.push(
      { id: 'art_js', source: { kind: 'url', url: 'javascript:alert(1)' } as never, width: 1, height: 1, title: '', artist: '', year: '', description: '' },
      { id: 'art_1', source: { kind: 'sample', index: 3 } as never, width: 10, height: 10, title: '복제 id', artist: '', year: '', description: '' },
    );
    const doc = migrateExhibition(raw);
    expect(doc.artworks).toHaveLength(2);
    expect(doc.artworks[1].title).toBe('복제 id');
    expect(doc.artworks[1].id).not.toBe('art_1');
  });

  it('only allows uploaded 3D models, and only on pedestals', () => {
    const raw = v1Doc() as Record<string, unknown> & ReturnType<typeof v1Doc>;
    raw.artworks.push(
      { id: 'art_model', media: 'model', source: { kind: 'upload', blobId: 'img_glb' }, width: 512, height: 512, title: '조각', artist: '', year: '', description: '' } as never,
      { id: 'art_model_url', media: 'model', source: { kind: 'url', url: 'https://example.com/a.glb' }, width: 1, height: 1, title: '', artist: '', year: '', description: '' } as never,
    );
    const f = raw.floors[0] as Record<string, unknown>;
    f.props = [
      { id: 'pd', type: 'pedestal', x: 3, z: 3, rotation: 0, artworkId: 'art_model', artHeight: 9 },
      { id: 'bn', type: 'bench', x: 3, z: 3, rotation: 0, artworkId: 'art_model' },
      { id: 'pd2', type: 'pedestal', x: 3, z: 3, rotation: 0, artworkId: 'art_1' },
    ];
    (f.wallItems as Record<string, unknown>[])[0].artworkId = 'art_model';
    const doc = migrateExhibition(raw);
    expect(doc.artworks.map((a) => a.id)).toEqual(['art_1', 'art_model']);
    const [pd, bn, pd2] = doc.floors[0].props;
    expect(pd).toMatchObject({ artworkId: 'art_model', artHeight: 1.2 });
    expect(bn.artworkId).toBe(null);
    expect(pd2.artworkId).toBe(null);
    const fr = doc.floors[0].wallItems[0];
    expect(fr.kind === 'frame' && fr.artworkId).toBe(null);
  });

  it('always leaves at least one floor', () => {
    const raw = { ...v1Doc(), floors: [] };
    const doc = migrateExhibition(raw);
    expect(doc.floors).toHaveLength(1);
    expect(doc.floors[0].cells.every((c) => c === 0)).toBe(true);
  });
});
