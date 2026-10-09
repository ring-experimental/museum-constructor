import { href } from '../router';
import { BrandMark } from './BrandMark';

export function AppHeader({ active }: { active: 'visit' | 'studio' }) {
  return (
    <header className="app-header">
      <a className="brand" href={href.visitList()}>
        <BrandMark />
        <span className="brand__name">Museum Constructor</span>
      </a>
      <nav className="mode-switch" aria-label="모드 전환">
        <a className={active === 'visit' ? 'is-active' : ''} href={href.visitList()}>
          관람 모드
        </a>
        <a className={active === 'studio' ? 'is-active' : ''} href={href.studio()}>
          편집 모드
        </a>
      </nav>
    </header>
  );
}
