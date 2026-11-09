'use client';
// Lets a student opt in or out of selling their Study Credential (docs/X402.md section 6). Off by default. The state
// always comes from the oracle, so what is shown is what a buyer would be told. Signing costs no gas.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { consent_message } from '@/lib/messages';
import { oracle } from '@/lib/oracle';

export function CredentialConsent() {
  const { lang } = use_ui();
  const { address } = useAccount();
  const { data: client } = useWalletClient();
  const qc = useQueryClient();
  const [busy, set_busy] = useState(false);
  const [failed, set_failed] = useState(false);

  const link_q = useQuery({
    queryKey: ['link', address ?? null],
    enabled: !!address,
    queryFn: () => oracle.get_link(address!),
  });
  const linked = link_q.data?.linked === true;
  // Under the ['link'] key on purpose: linking or unlinking invalidates it, and either can change consent.
  const consent_q = useQuery({
    queryKey: ['link', address ?? null, 'consent'],
    enabled: !!address && linked,
    queryFn: () => oracle.get_consent(address!),
  });

  if (!address || !linked) return null;
  const share = consent_q.data?.share;

  async function save(next: boolean) {
    if (!client || !address) return;
    set_busy(true);
    set_failed(false);
    try {
      const issued_at = Math.floor(Date.now() / 1000);
      const signature = await client.signMessage({ account: address, message: consent_message(address, next, issued_at) });
      await oracle.post_consent({ wallet: address, share: next, signature, issued_at });
      await qc.invalidateQueries({ queryKey: ['link', address, 'consent'] });
    } catch {
      set_failed(true);
    } finally {
      set_busy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="credential-consent-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="credential-consent-title" className="font-semibold">
          {t(lang, 'consent_title')}
        </h2>
        {share === undefined ? null : (
          <span role="status" className="text-sm font-semibold" style={{ color: share ? 'var(--success)' : 'var(--muted)' }}>
            {t(lang, share ? 'consent_on' : 'consent_off')}
          </span>
        )}
      </div>
      <p className="text-sm">{t(lang, 'consent_desc')}</p>
      <p className="text-sm text-[var(--muted)]">{t(lang, 'consent_privacy')}</p>
      <p className="text-sm text-[var(--muted)]">{t(lang, 'consent_note')}</p>
      {link_q.data?.lms === 'demo' ? <p className="text-sm text-[var(--muted)]">{t(lang, 'consent_demo_note')}</p> : null}
      <div>
        <button
          type="button"
          className={share ? 'btn btn-ghost' : 'btn'}
          disabled={busy || share === undefined}
          onClick={() => void save(!share)}
        >
          {t(lang, share ? 'consent_disable' : 'consent_enable')}
        </button>
      </div>
      <Link href="/credential/verify" className="text-sm underline">
        {t(lang, 'consent_verify_link')}
      </Link>
      {failed ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{t(lang, 'consent_failed')}</p> : null}
      {consent_q.isError ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{t(lang, 'consent_load_failed')}</p> : null}
    </section>
  );
}
