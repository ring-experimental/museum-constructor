import { useEffect, useState } from 'react';
import { useRoute } from './router';
import { seedIfEmpty } from './storage/seed';
import { VisitListPage } from './pages/VisitListPage';
import { VisitPage } from './pages/VisitPage';
import { StudioListPage } from './pages/StudioListPage';
import { EditorPage } from './pages/EditorPage';
import { AppHeader } from './components/AppHeader';
import { ToastHost } from './components/Toast';

export function App() {
  const route = useRoute();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    seedIfEmpty()
      .catch((e) => console.error('seed failed', e))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="boot">불러오는 중…</div>;

  const fullscreen = route.name === 'visit' || route.name === 'editor';
  return (
    <>
      {!fullscreen && <AppHeader active={route.name === 'studio' ? 'studio' : 'visit'} />}
      {route.name === 'visitList' && <VisitListPage />}
      {route.name === 'visit' && <VisitPage key={route.id} id={route.id} initialFloor={route.floor} from={route.from} />}
      {route.name === 'studio' && <StudioListPage />}
      {route.name === 'editor' && <EditorPage key={route.id} id={route.id} />}
      {route.name === 'notFound' && (
        <main className="page">
          <p className="empty">페이지를 찾을 수 없습니다.</p>
        </main>
      )}
      <ToastHost />
    </>
  );
}
