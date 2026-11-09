'use client';
// Link an LMS account to the connected wallet. Moodle needs a token and an explicit consent checkbox.
// Demo LMS needs no token and is labelled DEMO. The signed message is the same one the oracle verifies.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { oracle } from '@/lib/oracle';
import { link_message, unlink_message } from '@/lib/messages';
import { DEFAULT_MOODLE_SITE } from '@/lib/config';
import { explain_error } from '@/lib/errors';
import { CredentialConsent } from './credential_consent';

export function LinkForm() {
  const { lang } = use_ui();
  const { address } = useAccount();
  const { data: client } = useWalletClient();
  const qc = useQueryClient();
  const [kind, set_kind] = useState<'moodle' | 'demo'>('demo');
  const [site, set_site] = useState(DEFAULT_MOODLE_SITE);
  const [token, set_token] = useState('');
  const [consent, set_consent] = useState(false);
  const [msg, set_msg] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);

  if (!address) return <p className="text-[var(--muted)]">{t(lang, 'connect')}</p>;

  async function link() {
    if (!client || !address) return;
    if (kind === 'moodle' && (!consent || token.trim().length === 0)) return;
    set_busy(true);
    set_msg(null);
    try {
      const issued_at = Math.floor(Date.now() / 1000);
      const target_site = kind === 'demo' ? 'demo' : site;
      const message = link_message(address, kind, target_site, issued_at);
      const signature = await client.signMessage({ account: address, message });
      await oracle.post_link({
        wallet: address,
        lms: kind,
        site: target_site,
        moodle_token: kind === 'moodle' ? token.trim() : undefined,
        signature,
        issued_at,
      });
      set_token('');
      set_msg('OK');
      await qc.invalidateQueries({ queryKey: ['link'] });
    } catch (err) {
      set_msg(explain_error(err, lang));
    } finally {
      set_busy(false);
    }
  }

  async function unlink() {
    if (!client || !address) return;
    set_busy(true);
    set_msg(null);
    try {
      const issued_at = Math.floor(Date.now() / 1000);
      const signature = await client.signMessage({ account: address, message: unlink_message(address, issued_at) });
      await oracle.delete_link({ wallet: address, signature, issued_at });
      set_msg('OK');
      await qc.invalidateQueries({ queryKey: ['link'] });
    } catch (err) {
      set_msg(explain_error(err, lang));
    } finally {
      set_busy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'link_title')}</h1>
      <div className="flex gap-2">
        <button type="button" className={kind === 'demo' ? 'btn' : 'btn btn-ghost'} onClick={() => set_kind('demo')}>
          {t(lang, 'link_demo')}
        </button>
        <button type="button" className={kind === 'moodle' ? 'btn' : 'btn btn-ghost'} onClick={() => set_kind('moodle')}>
          {t(lang, 'link_moodle')}
        </button>
      </div>

      {kind === 'moodle' ? (
        <section className="card flex flex-col gap-3 p-4">
          <p className="text-sm text-[var(--muted)]">{t(lang, 'link_token_help')}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span>Site</span>
            <input className="input" value={site} onChange={(e) => set_site(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Token</span>
            <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => set_token(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => set_consent(e.target.checked)} className="mt-1" />
            <span>{t(lang, 'link_consent')}</span>
          </label>
        </section>
      ) : (
        <p className="text-sm text-[var(--muted)]">DEMO · {t(lang, 'footer_demo')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy || (kind === 'moodle' && (!consent || token.trim().length === 0))}
          onClick={link}
        >
          {t(lang, 'link_title')}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={unlink}>
          {t(lang, 'link_unlink')}
        </button>
      </div>
      {msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}
      <CredentialConsent />
    </div>
  );
}
