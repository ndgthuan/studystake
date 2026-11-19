'use client';
// Verify: loads evidence from the oracle, recomputes keccak(canonical_json) and the Merkle root in the browser,
// and compares both with the values committed on chain. Nothing here trusts the oracle's own verdict.
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { use_challenge } from '@/hooks/use_challenge';
import { t } from '@/lib/i18n';
import Link from 'next/link';
import { use_course_evidence } from '@/hooks/use_course_record';
import { DEPLOY_FROM_BLOCK, explorer_address, explorer_tx } from '@/lib/config';
import { addresses, public_client } from '@/lib/contracts';
import { parseAbiItem } from 'viem';
import { short_address, ZERO_ROOT } from '@/lib/verify';

export function VerifyView({ id_param }: { id_param: string }) {
  const { lang } = use_ui();
  const id = /^\d+$/.test(id_param) ? BigInt(id_param) : null;
  const chain_q = use_challenge(id);
  const chain = chain_q.data;
  const ev_q = use_course_evidence(id, chain?.ch);
  const vi = lang === 'vi';
  const tx_q = useQuery({
    queryKey: ['finalize_tx', id?.toString(), chain?.ch.finalized_at.toString()],
    enabled: !!id && chain?.phase === 'Finalized' && !!explorer_address(addresses.manager),
    staleTime: Infinity, retry: false,
    queryFn: async () => {
      // Fuji nodes cap log ranges. Locate the finalization timestamp, then query a small block window.
      const time = chain!.ch.finalized_at;
      let lo = DEPLOY_FROM_BLOCK;
      let hi = await public_client.getBlockNumber();
      const latest = hi;
      while (hi - lo > 1000n) {
        const mid = (lo + hi) / 2n;
        const block = await public_client.getBlock({ blockNumber: mid });
        if (block.timestamp < time) lo = mid + 1n;
        else hi = mid;
      }
      const logs = await public_client.getLogs({
        address: addresses.manager, args: { id: id! },
        event: parseAbiItem('event Finalized(uint256 indexed id, uint256 final_assets, uint256 reward_pot, bool loss)'),
        fromBlock: lo, toBlock: hi + 16n < latest ? hi + 16n : latest,
      });
      return logs[0]?.transactionHash ?? null;
    },
  });
  if (id === null || chain_q.isError || ev_q.isError) return <p role="status">{t(lang,'error_load')}</p>;
  if (chain?.ch.evidence_hash === ZERO_ROOT) return <p>{vi ? 'Chưa có bằng chứng công bố.' : 'Evidence has not been published yet.'}</p>;
  if (!chain || !ev_q.data) return <p role="status">{t(lang,'loading')}</p>;
  const { evidence, checks:result, verified } = ev_q.data;
  const tx = tx_q.data && explorer_tx(tx_q.data);
  const manager = explorer_address(addresses.manager);

  return (
    <div className="flex flex-col gap-4">
      <Link className="crumb" href={`/challenges/${id_param}`}>← {vi ? 'Hồ sơ học phần' : 'Course record'} #{id_param}</Link>
      <h1 className="text-2xl font-bold">
        {t(lang, 'verify_title')} · #{id_param}
      </h1>

      <section className="card flex flex-col gap-3 p-4">
        {verified && <span className="ink-stamp">{vi ? 'Khớp on-chain' : 'On-chain match'}</span>}
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
        {tx && <a className="record-link" href={tx} target="_blank" rel="noreferrer">{vi ? 'Giao dịch chốt kết quả' : 'Finalization transaction'} ↗</a>}
        {manager && <a className="record-link" href={manager} target="_blank" rel="noreferrer">{vi ? 'Hợp đồng thử thách' : 'Challenge contract'} ↗</a>}
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
