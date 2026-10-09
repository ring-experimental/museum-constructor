import { ArrowRight, Building2, Images, Layers } from 'lucide-react';
import { useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { formatDate, useExhibitionList } from '../components/useExhibitions';
import type { ExhibitionSummary } from '../core/types';
import { href } from '../router';

export function VisitListPage() {
  const list = useExhibitionList();
  const published = list?.filter((x) => x.status === 'published') ?? [];

  return (
    <main className="page">
      <section className="hero">
        <div className="hero__text">
          <p className="eyebrow">관람 모드</p>
          <h1>
            지금 열려 있는
            <br />
            온라인 전시
          </h1>
          <p className="hero__lead">전시를 선택하면 3D 전시관에 초대됩니다. 층을 오가며 걷고, 작품 앞에 멈춰 감상해 보세요.</p>
        </div>
        <HeroVisual />
      </section>

      {list === null ? (
        <p className="empty">불러오는 중…</p>
      ) : published.length === 0 ? (
        <div className="empty-state">
          <Building2 size={40} strokeWidth={1.2} />
          <h2>공개된 전시가 아직 없어요</h2>
          <p>편집 모드에서 전시를 만들고 ‘공개’로 바꾸면 이곳에 나타납니다.</p>
          <a className="btn btn--primary" href={href.studio()}>
            전시 만들러 가기 <ArrowRight size={16} />
          </a>
        </div>
      ) : (
        <section className="card-grid">
          {published.map((x) => (
            <ExhibitionCard key={x.id} ex={x} />
          ))}
        </section>
      )}
    </main>
  );
}

function ExhibitionCard({ ex }: { ex: ExhibitionSummary }) {
  return (
    <a className="ex-card" href={href.visit(ex.id)}>
      <div className="ex-card__cover">
        <ArtworkImage source={ex.cover} variant="full" fallback={<div className="ex-card__placeholder">{ex.title.slice(0, 1)}</div>} />
        <span className="ex-card__enter">
          입장하기 <ArrowRight size={15} />
        </span>
      </div>
      <div className="ex-card__body">
        <h3>{ex.title || '제목 없는 전시'}</h3>
        {ex.subtitle && <p className="ex-card__sub">{ex.subtitle}</p>}
        <p className="ex-card__meta">
          {ex.curator && <span>{ex.curator}</span>}
          <span>
            <Layers size={13} /> {ex.floorCount}개 층
          </span>
          <span>
            <Images size={13} /> 작품 {ex.artworkCount}점
          </span>
          <span>{formatDate(ex.updatedAt)}</span>
        </p>
      </div>
    </a>
  );
}

/** 키 비주얼 슬롯: public/assets/brand/hero.jpg (외부 제작 에셋). 없으면 영역 자체를 숨긴다 */
function HeroVisual() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="hero__visual" aria-hidden>
      <img src="/assets/brand/hero.jpg" alt="" onError={() => setOk(false)} />
    </div>
  );
}
