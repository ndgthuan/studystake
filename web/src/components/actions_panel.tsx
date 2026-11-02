'use client';
// Permissionless actions: finalize when Finalizable, expire when Expirable, collect treasury, sweep rewards.
// Anyone may press these, so no role check is needed here.
import { useQueryClient } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis } from '@/lib/contracts';
import { t } from '@/lib/i18n';
import { TxStatusLine } from './tx_status';
import type { PhaseName } from '@/lib/contracts';

export function ActionsPanel({ id, phase }: { id: bigint; phase: PhaseName }) {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { state, run } = use_tx(lang, () => invalidate_challenge_queries(qc));

  const can_finalize = phase === 'Finalizable';
  const can_expire = phase === 'Expirable';
  if (!can_finalize && !can_expire) return null;

  const fn = can_finalize ? 'finalize' : 'expire';
  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">{can_finalize ? t(lang, 'finalize') : t(lang, 'expire')}</h2>
      <button
        type="button"
        className="btn"
        disabled={state.status === 'signing' || state.status === 'pending'}
        onClick={() => run({ address: addresses.manager, abi: abis.manager, functionName: fn, args: [id] })}
      >
        {can_finalize ? t(lang, 'finalize') : t(lang, 'expire')}
      </button>
      <TxStatusLine state={state} lang={lang} />
    </section>
  );
}
