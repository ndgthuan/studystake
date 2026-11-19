'use client';
// Shows the transaction state machine: signing, pending (with explorer link), confirmed, or error.
import { t, type Lang } from '@/lib/i18n';
import type { TxState } from '@/hooks/use_tx';

export function TxStatusLine({ state, lang }: { state: TxState; lang: Lang }) {
  if (state.status === 'idle') return null;
  const label: Record<Exclude<TxState['status'], 'idle'>, string> = {
    signing: t(lang, 'tx_signing'),
    pending: t(lang, 'tx_pending'),
    confirmed: t(lang, 'tx_confirmed'),
    error: t(lang, 'tx_error'),
  };
  const color = state.status === 'error' ? 'var(--accent)' : state.status === 'confirmed' ? 'var(--success)' : 'var(--muted)';
  return (
    <div className="text-sm" role="status" style={{ color }}>
      <span className="tx-phase" data-state={state.status} key={state.status}>
        <span className="tx-mark" aria-hidden="true">{state.status === 'confirmed' ? '✓' : state.status === 'error' ? '!' : ''}</span>
        {label[state.status]}
      </span>
      {state.error ? <span> — {state.error}</span> : null}
      {state.explorer ? (
        <a href={state.explorer} target="_blank" rel="noreferrer" className="ml-2 underline">
          {t(lang, 'view_explorer')}
        </a>
      ) : null}
    </div>
  );
}
