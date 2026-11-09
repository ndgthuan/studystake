'use client';
// Anyone can check a Study Credential here, with no wallet. The signer is recovered in the browser and checked on chain,
// so nothing depends on the oracle or on the pasted JSON. A result is cleared as soon as the input changes.
import { useState, type ReactNode } from 'react';
import type { Address } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { CHAIN_ID, DEFAULT_MOODLE_SITE } from '@/lib/config';
import { abis, addresses, public_client } from '@/lib/contracts';
import { verify_credential, type BadgeStats, type CheckResult, type CredentialReport, type Verdict, type VerifyDeps } from '@/lib/credential';
import { format_time } from '@/lib/format';
import { t, type DictKey, type Lang } from '@/lib/i18n';

async function has_oracle_role(account: Address): Promise<boolean> {
  const role = await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'ORACLE_ROLE' });
  return public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'hasRole', args: [role, account] }) as Promise<boolean>;
}

async function read_badge_stats(wallet: Address): Promise<BadgeStats> {
  const token_id = (await public_client.readContract({ address: addresses.badge, abi: abis.badge, functionName: 'badge_of', args: [wallet] })) as bigint;
  if (token_id === 0n) return { streak: 0, best_streak: 0, total_completed: 0, total_failed: 0 };
  const [streak, best_streak, total_completed, total_failed] = (await public_client.readContract({
    address: addresses.badge,
    abi: abis.badge,
    functionName: 'stats_of',
    args: [token_id],
  })) as readonly [number, number, number, number, bigint];
  return { streak, best_streak, total_completed, total_failed };
}

const VERDICT_TEXT: Record<Verdict, DictKey> = {
  valid: 'cv_valid',
  invalid: 'cv_invalid',
  expired: 'cv_expired',
  unknown: 'cv_unknown',
};
const VERDICT_COLOR: Record<Verdict, string> = {
  valid: 'var(--success)',
  invalid: 'var(--accent)',
  expired: 'var(--accent)',
  unknown: 'var(--muted)',
};
const CHECK_MARK: Record<CheckResult, { mark: string; color: string }> = {
  pass: { mark: '✓', color: 'var(--success)' },
  fail: { mark: '✗', color: 'var(--accent)' },
  unknown: { mark: '?', color: 'var(--muted)' },
};

export function CredentialVerify() {
  const { lang } = use_ui();
  const [text, set_text] = useState('');
  const [site, set_site] = useState(DEFAULT_MOODLE_SITE);
  const [busy, set_busy] = useState(false);
  const [report, set_report] = useState<CredentialReport | null>(null);
  const [input_error, set_input_error] = useState<DictKey | null>(null);

  function clear_result() {
    set_report(null);
    set_input_error(null);
  }

  async function check() {
    clear_result();
    set_busy(true);
    try {
      const deps: VerifyDeps = {
        chain_id: CHAIN_ID,
        manager: addresses.manager,
        now_seconds: Math.floor(Date.now() / 1000),
        expected_site: site,
        has_oracle_role,
        read_badge_stats,
      };
      const outcome = await verify_credential(text, deps);
      if (outcome.ok) set_report(outcome.report);
      else set_input_error(outcome.error === 'not_json' ? 'cv_not_json' : 'cv_wrong_shape');
    } finally {
      set_busy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'cv_title')}</h1>
      <p className="text-sm text-[var(--muted)]">{t(lang, 'cv_intro')}</p>

      <section className="card flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t(lang, 'cv_input')}</span>
          <textarea
            className="input num font-mono text-xs"
            style={{ minHeight: '10rem', padding: '8px 12px' }}
            spellCheck={false}
            value={text}
            onChange={(e) => {
              set_text(e.target.value);
              clear_result();
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t(lang, 'cv_school')}</span>
          <input
            className="input"
            value={site}
            onChange={(e) => {
              set_site(e.target.value);
              clear_result();
            }}
          />
        </label>
        <div>
          <button type="button" className="btn" disabled={busy || text.trim().length === 0} onClick={() => void check()}>
            {t(lang, 'cv_check')}
          </button>
        </div>
        {input_error ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{t(lang, input_error)}</p> : null}
      </section>

      {report ? <Result report={report} lang={lang} /> : null}
    </div>
  );
}

function Result({ report, lang }: { report: CredentialReport; lang: Lang }) {
  const { checks } = report;
  return (
    <section className="card flex flex-col gap-3 p-4">
      <p role="status" className="text-lg font-semibold" style={{ color: VERDICT_COLOR[report.verdict] }}>
        {t(lang, VERDICT_TEXT[report.verdict])}
      </p>

      <ul className="flex flex-col gap-1 text-sm">
        <Check result={checks.signature} label={t(lang, 'cv_check_signature')} />
        <Check result={checks.deployment} label={t(lang, 'cv_check_deployment')} />
        <Check result={checks.freshness} label={t(lang, 'cv_check_freshness')} />
      </ul>

      {/* Fields nobody vouches for must not look like facts, so an unattested credential stops at the checks. */}
      {report.attested ? <Attested report={report} lang={lang} /> : null}
    </section>
  );
}

function Attested({ report, lang }: { report: CredentialReport; lang: Lang }) {
  const { credential: c } = report;
  const stat_rows: { label: DictKey; key: keyof BadgeStats }[] = [
    { label: 'cv_streak', key: 'streak' },
    { label: 'cv_best_streak', key: 'best_streak' },
    { label: 'cv_completed', key: 'total_completed' },
    { label: 'cv_failed', key: 'total_failed' },
  ];
  return (
    <>
      {c.lms === 'demo' ? <Notice>{t(lang, 'cv_demo')}</Notice> : null}
      {report.school_matches === false ? <Notice>{t(lang, 'cv_school_mismatch')}</Notice> : null}
      {report.school_matches === true ? <p className="text-sm" style={{ color: 'var(--success)' }}>{t(lang, 'cv_school_match')}</p> : null}

      <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <Field label={t(lang, 'cv_wallet')} value={c.wallet} />
        <Field label={t(lang, 'cv_signer')} value={report.signer ?? '—'} />
        <Field label="LMS" value={c.lms} />
        <Field label={t(lang, 'cv_issued')} value={format_time(c.issued_at, lang)} />
        <Field label={t(lang, 'cv_expires')} value={format_time(c.expires_at, lang)} />
      </dl>

      <div className="overflow-x-auto">
        <table className="num w-full text-sm">
          <thead className="text-left text-[var(--muted)]">
            <tr>
              <th className="py-1 font-normal" />
              <th className="py-1 font-normal">{t(lang, 'cv_signed_stats')}</th>
              <th className="py-1 font-normal">{t(lang, 'cv_live_stats')}</th>
            </tr>
          </thead>
          <tbody>
            {stat_rows.map((row) => (
              <tr key={row.key} className="border-t border-[var(--border)]">
                <td className="py-1">{t(lang, row.label)}</td>
                <td className="py-1">{c[row.key]}</td>
                <td className="py-1">{report.live_stats ? report.live_stats[row.key] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted)]">{t(lang, 'cv_snapshot_note')}</p>
    </>
  );
}

function Check({ result, label }: { result: CheckResult; label: string }) {
  const { mark, color } = CHECK_MARK[result];
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden style={{ color }}>
        {mark}
      </span>
      <span>{label}</span>
    </li>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="text-sm" style={{ color: 'var(--accent)' }}>{children}</p>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}
