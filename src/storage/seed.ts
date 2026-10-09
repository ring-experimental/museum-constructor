import { autoHang, createExhibitionFromTemplate } from '../core/factory';
import { uid } from '../core/ids';
import type { Artwork } from '../core/types';
import { LEGACY_SAMPLE_TITLES, SAMPLE_ASPECTS, SAMPLE_COUNT, SAMPLE_TITLES } from './artworkSource';
import { exhibitionRepo } from './exhibitionRepo';

const SEED_FLAG = 'museum-constructor:seeded:v1';
const TITLES_FLAG = 'museum-constructor:sample-titles:v2';

const SAMPLE_DESCRIPTION =
  '편집 모드에서 만든 전시가 어떻게 보이는지 보여주는 샘플입니다. 편집 모드에서 직접 사진을 올려 나만의 전시를 만들 수 있어요.';
const LEGACY_SAMPLE_DESCRIPTION =
  '편집 모드에서 만든 전시가 어떻게 보이는지 보여주는 샘플입니다. 작품 이미지는 개발용 임시 이미지이며, 편집 모드에서 직접 사진을 올려 나만의 전시를 만들 수 있어요.';

let seeding: Promise<void> | null = null;

/** 첫 실행 시 관람 목록이 비어 보이지 않도록 샘플 전시를 하나 만든다 (중복 호출 안전) */
export function seedIfEmpty() {
  seeding ??= seed();
  return seeding;
}

async function seed() {
  try {
    if (localStorage.getItem(SEED_FLAG)) return migrateSampleTitles();
  } catch {
    return;
  }
  const list = await exhibitionRepo.list();
  if (list.length === 0) {
    const ex = createExhibitionFromTemplate('twofloor', '샘플 전시 · 빛의 기록');
    ex.subtitle = 'Museum Constructor 데모 전시';
    ex.curator = 'Museum Constructor';
    ex.description = SAMPLE_DESCRIPTION;
    ex.status = 'published';
    ex.theme.lighting = 'warm';
    const arts: Artwork[] = Array.from({ length: SAMPLE_COUNT }, (_, i) => {
      const aspect = SAMPLE_ASPECTS[i];
      return {
        id: uid('art'),
        source: { kind: 'sample', index: i },
        width: aspect >= 1 ? 1200 : Math.round(1200 * aspect),
        height: aspect >= 1 ? Math.round(1200 / aspect) : 1200,
        title: SAMPLE_TITLES[i],
        artist: '샘플 작가',
        year: '2026',
        description: '샘플 작품 설명입니다. 편집 모드의 작품 정보 패널에서 제목, 작가, 연도, 설명을 입력할 수 있어요.',
      };
    });
    ex.artworks = arts;
    ex.coverArtworkId = arts[0].id;
    const n1 = autoHang(ex.floors[0], arts.slice(0, 7));
    autoHang(ex.floors[1], arts.slice(n1));
    await exhibitionRepo.save(ex);
  }
  try {
    localStorage.setItem(SEED_FLAG, '1');
    localStorage.setItem(TITLES_FLAG, '1');
  } catch {
    /* noop */
  }
}

/**
 * 샘플 사진에 맞춰 제목을 바꾼 뒤, 이미 만들어진 샘플 전시도 따라가게 한다.
 * 사용자가 고치지 않은(옛 기본값 그대로인) 제목·설명만 바꾼다.
 */
async function migrateSampleTitles() {
  if (localStorage.getItem(TITLES_FLAG)) return;
  for (const s of await exhibitionRepo.list()) {
    const doc = await exhibitionRepo.get(s.id);
    if (!doc) continue;
    let changed = false;
    for (const a of doc.artworks) {
      if (a.source.kind === 'sample' && a.title === LEGACY_SAMPLE_TITLES[a.source.index]) {
        a.title = SAMPLE_TITLES[a.source.index];
        changed = true;
      }
    }
    if (doc.description === LEGACY_SAMPLE_DESCRIPTION) {
      doc.description = SAMPLE_DESCRIPTION;
      changed = true;
    }
    if (changed) await exhibitionRepo.save(doc);
  }
  localStorage.setItem(TITLES_FLAG, '1');
}
