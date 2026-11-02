'use client';
// Verify: loads evidence from the oracle, recomputes keccak(canonical_json) and the Merkle root in the browser,
// and compares both with the values committed on chain. Nothing here trusts the oracle's own verdict.
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { use_challenge } from '@/hooks/use_challenge';
import { t } from '@/lib/i18n';
import { oracle } from '@/lib/oracle';
import { verify_evidence, short_address, type Evidence } from '@/lib/verify';

export function VerifyView({ id_param }: { id_param: string }) {
  const { lang } = use_ui();
  const id = /^\d+$/.test(id_param) ? BigInt(id_param) : null;
  const { data: chain } = use_challenge(id);

  const ev_q = useQuery({
    queryKey: ['evidence', id_param],
    enabled: id !== null,
    queryFn: () => oracle.get_evidence(Number(id_param)) as Promise<Record<string, unknown>>,
    retry: false,
  });

  if (id === null) return <p className="text-[var(--muted)]">Invalid challenge id</p>;
  if (ev_q.isLoading || !chain) return <p className="text-[var(--muted)]">{t(lang, 'loading')}</p>;
  if (ev_q.error) return <p className="text-[var(--muted)]">{t(lang, 'error_load')}</p>;

  const evidence = ev_q.data as unknown as Evidence;
  const result = verify_evidence(evidence, chain.ch.evidence_hash, chain.ch.root);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">
        {t(lang, 'verify_title')} · #{id_param}
      </h1>

      <section className="card flex flex-col gap-3 p-4">
        <Check
          label={t(lang, 'verify_hash')}
          ok={result.hash_ok}
          onchain={chain.ch.evidence_hash}
          computed={result.computed_hash ?? '—'}
          lang={lang}
        />
        <Check
          label={t(lang, 'verify_root')}
          ok={result.root_ok}
          onchain={chain.ch.root}
          computed={result.computed_root ?? '—'}
          lang={lang}
        />
        {result.error ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{result.error}</p> : null}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">{t(lang, 'participant')}</h2>
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead className="text-left text-[var(--muted)]">
              <tr>
                <th className="py-1">{t(lang, 'participant')}</th>
                <th className="py-1">{t(lang, 'completed')}</th>
                <th className="py-1">{t(lang, 'reason')}</th>
              </tr>
            </thead>
            <tbody>
              {(evidence.entries ?? []).map((e) => (
                <tr key={e.account} className="border-t border-[var(--border)]">
                  <td className="py-1">{short_address(e.account)}</td>
                  <td className="py-1">{e.completed ? '✓' : '✗'}</td>
                  <td className="py-1">{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Check({
  label,
  ok,
  onchain,
  computed,
  lang,
}: {
  label: string;
  ok: boolean;
  onchain: string;
  computed: string;
  lang: 'vi' | 'en';
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 font-semibold">
        <span style={{ color: ok ? 'var(--success)' : 'var(--accent)' }}>{ok ? '✓' : '✗'}</span>
        <span>{label}</span>
        <span className="text-sm font-normal" style={{ color: ok ? 'var(--success)' : 'var(--accent)' }}>
          {ok ? t(lang, 'verify_ok') : t(lang, 'verify_fail')}
        </span>
      </div>
      <div className="num break-all text-xs text-[var(--muted)]">on-chain: {onchain}</div>
      <div className="num break-all text-xs text-[var(--muted)]">computed: {computed}</div>
    </div>
  );
}
