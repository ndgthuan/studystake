'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';

interface Notice {
  tone: 'success' | 'error';
  title: string;
  detail?: string;
}

type NoticeEntry = Notice & { id: number };
const NoticeContext = createContext<(notice: Notice) => void>(() => {});

export function useActionNotice() {
  return useContext(NoticeContext);
}

export function ActionNotices({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [items, setItems] = useState<NoticeEntry[]>([]);
  const notify = useCallback((notice: Notice) => {
    const entry = { ...notice, id: ++nextId.current };
    setItems(previous => [...previous.slice(-2), entry]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems(previous => previous.filter(item => item.id !== id));
  }, []);

  return <NoticeContext.Provider value={notify}>
    {children}
    <div className="action-notices">
      {items.map(item => <NoticePanel key={item.id} item={item} dismiss={dismiss} />)}
    </div>
  </NoticeContext.Provider>;
}

function NoticePanel({ item, dismiss }: { item: NoticeEntry; dismiss: (id: number) => void }) {
  const { lang } = use_ui();
  const [hold, setHold] = useState(false);

  useEffect(() => {
    if (item.tone === 'error' || hold) return;
    const timer = window.setTimeout(() => dismiss(item.id), 6_000);
    return () => window.clearTimeout(timer);
  }, [dismiss, hold, item]);

  return <div className="action-notice" data-tone={item.tone}
    onMouseEnter={() => setHold(true)} onMouseLeave={event => setHold(event.currentTarget.contains(document.activeElement))}
    onFocus={() => setHold(true)} onBlur={event => setHold(event.currentTarget.matches(':hover') || event.currentTarget.contains(event.relatedTarget))}>
    <div className="action-notice-content" role={item.tone === 'error' ? 'alert' : 'status'}>
      <span className="action-notice-stamp" aria-hidden="true">{item.tone === 'success' ? '✓' : '!'}</span>
      <div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</div>
    </div>
    <button type="button" className="action-notice-close" aria-label={t(lang, 'notice_close')} onClick={() => dismiss(item.id)}>×</button>
  </div>;
}
