'use client';
// Dispute: a participant can raise one dispute inside the dispute window. The reason text is hashed in the
// browser and only the keccak hash goes on chain, so no reason text is stored in plain form on chain.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keccak256, toBytes } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis, type PhaseName } from '@/lib/contracts';
import { t } from '@/lib/i18n';
import { TxStatusLine } from './tx_status';

export function DisputePanel({ id, phase, wallet }: { id: bigint; phase: PhaseName; wallet: `0x${string}` | null }) {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { state, run } = use_tx(lang, () => invalidate_challenge_queries(qc));
  const [reason, set_reason] = useState('');

  if (!wallet || phase !== 'DisputeWindow') return null;

  const reason_hash = keccak256(toBytes(reason.trim() || 'empty'));
  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">{t(lang, 'dispute')}</h2>
      <input className="input" value={reason} onChange={(e) => set_reason(e.target.value)} placeholder={t(lang, 'dispute')} />
      <button
        type="button"
        className="btn btn-ghost"
        disabled={reason.trim().length === 0 || state.status === 'signing' || state.status === 'pending'}
        onClick={() => run({ address: addresses.manager, abi: abis.manager, functionName: 'dispute', args: [id, reason_hash] })}
      >
        {t(lang, 'dispute')}
      </button>
      <TxStatusLine state={state} lang={lang} />
    </section>
  );
}
