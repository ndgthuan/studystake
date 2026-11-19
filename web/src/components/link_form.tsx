'use client';
// Link an LMS account to the connected wallet. Moodle needs a token and an explicit consent checkbox.
// Demo LMS needs no token and is labelled DEMO. The signed message is the same one the oracle verifies.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { t, type DictKey } from '@/lib/i18n';
import { oracle, OracleError, type LinkState } from '@/lib/oracle';
import { link_message, unlink_message } from '@/lib/messages';
import { DEFAULT_MOODLE_SITE } from '@/lib/config';
import { explain_error } from '@/lib/errors';
import { CredentialConsent } from './credential_consent';
import { AccountGate } from './account_gate';
import { useActionNotice } from './action_notices';

const LINK_ERRORS: Partial<Record<string, DictKey>> = {
  invalid_token: 'link_invalid_token',
  moodle_access_denied: 'link_access_denied',
  moodle_unavailable: 'link_unavailable',
  site_not_allowed: 'link_site_not_allowed',
  open_challenge: 'link_open_challenge',
  subject_taken: 'link_subject_taken',
  bad_signature: 'link_signature_error',
  expired: 'link_signature_error',
  future: 'link_signature_error',
  replay: 'link_signature_error',
  internal: 'link_unavailable',
};

export function LinkForm() {
  const { address } = useAccount();
  if (!address) return <AccountGate page="link" />;
  return <WalletLinkForm address={address} key={address} />;
}

function WalletLinkForm({ address }: { address: `0x${string}` }) {
  const { lang } = use_ui();
  const { data: client } = useWalletClient();
  const qc = useQueryClient();
  const notify = useActionNotice();
  const link_key = ['link', address] as const;
  const saved = useQuery({ queryKey: link_key, queryFn: () => oracle.get_link(address) });
  const current = saved.data?.linked ? saved.data : null;
  const [kind_draft, set_kind] = useState<'moodle' | 'demo' | null>(null);
  const [site_draft, set_site] = useState<string | null>(null);
  const [token, set_token] = useState('');
  const [consent, set_consent] = useState(false);
  const [step, set_step] = useState<'signing' | 'saving' | null>(null);
  const kind = kind_draft ?? current?.lms ?? 'moodle';
  const site = site_draft ?? (current?.lms === 'moodle' ? current.site : undefined) ?? DEFAULT_MOODLE_SITE;

  async function save_state(state: LinkState) {
    await qc.cancelQueries({ queryKey: link_key, exact: true });
    qc.setQueryData(link_key, state);
    void qc.invalidateQueries({ queryKey: [...link_key, 'consent'] });
    void qc.invalidateQueries({ queryKey: ['progress'] });
  }

  function report_error(err: unknown) {
    const key = err instanceof OracleError ? LINK_ERRORS[err.code] : undefined;
    notify({ tone: 'error', title: t(lang, 'link_save_failed'), detail: key ? t(lang, key) : explain_error(err, lang) });
  }

  async function link() {
    if (!client || step || (kind === 'moodle' && (!consent || !token.trim() || !site.trim()))) return;
    set_step('signing');
    try {
      const issued_at = Math.floor(Date.now() / 1000);
      const target_site = kind === 'demo' ? 'demo' : site.trim();
      const message = link_message(address, kind, target_site, issued_at);
      const signature = await client.signMessage({ account: address, message });
      set_step('saving');
      const state = await oracle.post_link({
        wallet: address,
        lms: kind,
        site: target_site,
        moodle_token: kind === 'moodle' ? token.trim() : undefined,
        signature,
        issued_at,
      });
      set_token('');
      set_consent(false);
      set_site(null);
      set_kind(null);
      await save_state(state);
      notify({ tone: 'success', title: t(lang, kind === 'moodle' ? 'link_moodle_success' : 'link_demo_success') });
    } catch (err) {
      report_error(err);
    } finally {
      set_step(null);
    }
  }

  async function unlink() {
    if (!client || step || !current) return;
    set_step('signing');
    try {
      const issued_at = Math.floor(Date.now() / 1000);
      const signature = await client.signMessage({ account: address, message: unlink_message(address, issued_at) });
      set_step('saving');
      await oracle.delete_link({ wallet: address, signature, issued_at });
      set_token('');
      set_consent(false);
      set_site(null);
      set_kind(null);
      await save_state({ linked: false });
      notify({ tone: 'success', title: t(lang, 'link_removed') });
    } catch (err) {
      report_error(err);
    } finally {
      set_step(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'link_title')}</h1>
      <section className="folio saved-link" data-linked={!!current}>
        <p>{current ? t(lang, current.lms === 'moodle' ? 'link_moodle_success' : 'link_demo_success') :
          t(lang, saved.isPending ? 'loading' : saved.isError ? 'link_state_failed' : 'link_none')}</p>
        {current?.lms === 'moodle' && current.site && <small>{current.site}</small>}
      </section>
      <div className="flex gap-2">
        <button type="button" disabled={!!step} aria-pressed={kind === 'moodle'} className={kind === 'moodle' ? 'btn' : 'btn btn-ghost'} onClick={() => set_kind('moodle')}>
          {t(lang, 'link_moodle')}
        </button>
        <button type="button" disabled={!!step} aria-pressed={kind === 'demo'} className={kind === 'demo' ? 'btn' : 'btn btn-ghost'} onClick={() => set_kind('demo')}>
          {t(lang, 'link_demo')}
        </button>
      </div>

      {kind === 'moodle' ? (
        <fieldset disabled={!!step} className="card flex flex-col gap-3 p-4">
          <p className="text-sm text-[var(--muted)]">{t(lang, 'link_token_help')}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span>Site</span>
            <input className="input" value={site} onChange={(e) => set_site(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Token</span>
            <input className="input" type="password" autoComplete="off" value={token}
              aria-describedby={current?.lms === 'moodle' ? 'saved-token-help' : undefined}
              onChange={(e) => set_token(e.target.value)} />
          </label>
          {current?.lms === 'moodle' && <small id="saved-token-help" className="text-[var(--muted)]">{t(lang, 'link_token_replace_help')}</small>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => set_consent(e.target.checked)} className="mt-1" />
            <span>{t(lang, 'link_consent')}</span>
          </label>
        </fieldset>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t(lang, 'link_demo_help')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={!client || !!step || (kind === 'moodle' && (!consent || !token.trim() || !site.trim()))}
          onClick={link}
        >
          {t(lang, 'link_title')}
        </button>
        <button type="button" className="btn btn-ghost" disabled={!client || !!step || !current} onClick={unlink}>
          {t(lang, 'link_unlink')}
        </button>
      </div>
      {step && <p role="status" className="text-sm text-[var(--muted)]">{t(lang, step === 'signing' ? 'link_signing' : 'link_saving')}</p>}
      <CredentialConsent />
    </div>
  );
}
