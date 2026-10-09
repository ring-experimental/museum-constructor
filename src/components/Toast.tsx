import { useEffect, useState } from 'react';

interface ToastItem {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

let seq = 0;
const listeners = new Set<(t: ToastItem) => void>();

export function toast(text: string, tone: ToastItem['tone'] = 'info') {
  const item = { id: ++seq, text, tone };
  listeners.forEach((l) => l(item));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (t: ToastItem) => {
      setItems((s) => [...s.slice(-3), t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.tone === 'error' ? 6000 : 3200);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
