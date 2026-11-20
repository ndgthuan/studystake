'use client';
// Link an LMS account to the connected wallet. Moodle needs a token and an explicit consent checkbox.
// Demo LMS needs no token and is labelled DEMO. The signed message is the same one the oracle verifies.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { t, type DictKey, type Lang } from '@/lib/i18n';
import { oracle, OracleError, type LinkState } from '@/lib/oracle';
import { link_message, unlink_message } from '@/lib/messages';
import { DEFAULT_MOODLE_SITE } from '@/lib/config';
import { extract_moodle_token, moodle_token_bookmarklet, moodle_token_page_url } from '@/lib/moodle';
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

export function LinkForm({ return_to }: { return_to?: string }) {
  const { address } = useAccount();
  const { lang } = use_ui();
  return <>
    {return_to && <Link className="crumb record-link" href={return_to}>← {t(lang, 'back_to_challenge')}</Link>}
    {address ? <WalletLinkForm address={address} key={address} /> : <AccountGate page="link" />}
  </>;
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
  const parsed_token = extract_moodle_token(token);
  const token_invalid = token.trim() !== '' && parsed_token === null;
  const token_page = moodle_token_page_url(site.trim());

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
    if (!client || step || (kind === 'moodle' && (!consent || !parsed_token || !site.trim()))) return;
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
        moodle_token: kind === 'moodle' ? parsed_token ?? undefined : undefined,
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
          t(lang, saved.isPending ? 'loading' : saved.isError ? 'link_state_failed' : saved.data?.cleared ? 'link_token_cleared' : 'link_none')}</p>
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
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{t(lang, 'link_token_help')}</summary>
            <p className="mt-2 text-[var(--muted)]">{t(lang, 'link_token_quick')}</p>
            <TokenBookmarklet lang={lang} />
            <p className="mt-3 text-[var(--muted)]">{t(lang, 'link_token_manual')}</p>
            <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-[var(--muted)]">
              <li>
                {t(lang, 'link_token_step_open')}{' '}
                {token_page ? <a className="underline" href={token_page} target="_blank" rel="noreferrer noopener">{t(lang, 'link_token_step_open_link')} ↗</a> : null}
              </li>
              <li>{t(lang, 'link_token_step_copy')}</li>
              <li>{t(lang, 'link_token_step_paste')}</li>
            </ol>
            <p className="mt-2 text-xs text-[var(--muted)]">{t(lang, 'link_token_step_note')}</p>
          </details>
          <label className="flex flex-col gap-1 text-sm">
            <span>Site</span>
            <input className="input" value={site} onChange={(e) => set_site(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Token</span>
            <input className="input" type="password" autoComplete="off" value={token}
              aria-invalid={token_invalid || undefined}
              aria-describedby={[token_invalid ? 'token-format-error' : '', current?.lms === 'moodle' ? 'saved-token-help' : ''].filter(Boolean).join(' ') || undefined}
              onChange={(e) => set_token(e.target.value)} />
          </label>
          {token_invalid && <small id="token-format-error" role="alert" className="text-[var(--accent)]">{t(lang, 'link_token_bad_format')}</small>}
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
          disabled={!client || !!step || (kind === 'moodle' && (!consent || !parsed_token || !site.trim()))}
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

/**
 * Draggable "get token" bookmarklet. React 19 refuses javascript: URLs in href, so the URL is set on the element
 * after render. Clicking it on this page does nothing; it is meant to be dragged to the bookmarks bar.
 */
function TokenBookmarklet({ lang }: { lang: Lang }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute('href', moodle_token_bookmarklet({
      copied: t(lang, 'bookmarklet_copied'),
      copy_manually: t(lang, 'bookmarklet_copy_manually'),
      not_found: t(lang, 'bookmarklet_not_found'),
    }));
  }, [lang]);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <a ref={ref} className="btn btn-ghost cursor-grab" draggable title={t(lang, 'link_token_quick_drag')}
        onClick={(e) => e.preventDefault()}>
        {t(lang, 'link_token_quick_button')}
      </a>
      <small className="text-[var(--muted)]">{t(lang, 'link_token_quick_drag')}</small>
    </div>
  );
}
