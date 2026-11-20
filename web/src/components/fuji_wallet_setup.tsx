'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatEther, type Address } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { FUJI_FUNDING_URL, TEAM1_FUNDING_URL } from '@/lib/config';
import { public_client } from '@/lib/contracts';
import { t } from '@/lib/i18n';

export function FujiWalletSetup({ address }: { address: Address }) {
  const { lang } = use_ui();
  const [copied, set_copied] = useState(false);
  const balance = useQuery({
    queryKey: ['fuji-avax', address],
    queryFn: () => public_client.getBalance({ address }),
    refetchInterval: 15_000,
  });

  return (
    <section className="folio" id="fuji-wallet">
      <div className="sheet-head"><h2>{t(lang, 'fuji_wallet')}</h2></div>
      <p className="text-sm" aria-live="polite">
        {balance.isPending ? t(lang, 'loading') : balance.isError ? t(lang, 'error_load') :
          `${t(lang, 'fuji_balance')} ${formatEther(balance.data)} AVAX`}
      </p>
      <label className="block text-sm">
        {t(lang, 'wallet_address')}
        <input className="input num mt-1" value={address} readOnly onFocus={event => event.currentTarget.select()} />
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button type="button" className="btn btn-ghost" onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            set_copied(true);
          } catch {
            set_copied(false);
          }
        }}>{t(lang, copied ? 'wallet_copied' : 'wallet_copy')}</button>
        <a className="record-link" href={TEAM1_FUNDING_URL} target="_blank" rel="noreferrer">{t(lang, 'fuji_claim')} ↗</a>
        <a className="record-link" href={FUJI_FUNDING_URL} target="_blank" rel="noreferrer">Builder Console ↗</a>
      </div>
      <p className="text-sm text-[var(--muted)]">{t(lang, 'fuji_claim_help')}</p>
      <div>
        <h3 className="font-semibold">{t(lang, 'aave_yield_title')}</h3>
        <p className="text-sm text-[var(--muted)]">{t(lang, 'aave_yield_status')}</p>
      </div>
    </section>
  );
}
