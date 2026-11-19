'use client';
// Verify: loads evidence from the oracle, recomputes keccak(canonical_json) and the Merkle root in the browser,
// and compares both with the values committed on chain. Nothing here trusts the oracle's own verdict.
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { use_challenge } from '@/hooks/use_challenge';
import { t } from '@/lib/i18n';
import Link from 'next/link';
import { useState } from 'react';
import { use_course_evidence, use_course_metadata } from '@/hooks/use_course_record';
import { format_usdc } from '@/lib/usdc';
import { phase_key } from '@/lib/format';
import { DEPLOY_FROM_BLOCK, explorer_address, explorer_tx } from '@/lib/config';
import { addresses, public_client } from '@/lib/contracts';
import { parseAbiItem } from 'viem';
import { short_address, ZERO_ROOT } from '@/lib/verify';
import { ChainMark } from './chain_mark';

export function VerifyView({ id_param }: { id_param: string }) {
  const { lang } = use_ui();
  const id = /^\d+$/.test(id_param) ? BigInt(id_param) : null;
  const chain_q = use_challenge(id);
  const chain = chain_q.data;
  const ev_q = use_course_evidence(id, chain?.ch);
  const meta = use_course_metadata(chain?.ch.metadata_hash).data;
  const [share, set_share] = useState<'copied' | 'failed' | null>(null);
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
  const tx = tx_q.data && explorer_tx(tx_q.data);
  const manager = explorer_address(addresses.manager);
  const result = ev_q.data?.checks;

  async function copy_link() {
    try {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      await navigator.clipboard.writeText(url.href);
      set_share('copied');
    } catch {
      set_share('failed');
    }
  }

  return (
    <div className="verify-record flex flex-col gap-4">
      <Link className="crumb" href={`/challenges/${id_param}`}>← {vi ? 'Hồ sơ học phần' : 'Course record'} #{id_param}</Link>
      <h1 className="text-2xl font-bold">
        {t(lang, 'verify_title')} · #{id_param}
      </h1>
      {chain && <section className="folio flex flex-col gap-3">
        <div className="sheet-head"><h2>{meta?.title ?? t(lang, 'verify_result_summary')}</h2><span className="badge-phase">{t(lang, phase_key(chain.phase))}</span></div>
        <dl>
          <div className="money-line"><dt>{t(lang, 'verify_source')}</dt><dd>{meta ? meta.lms === 'moodle' ? 'Moodle' : 'Demo LMS' : '—'}</dd></div>
          {chain.phase === 'Finalized' && <>
            <div className="money-line"><dt>{t(lang, 'completed')}</dt><dd className="num">{chain.ch.completed_count}/{chain.ch.participant_count}</dd></div>
            <div className="money-line"><dt>{t(lang, 'verify_final_reward')}</dt><dd className="num">{format_usdc(chain.ch.reward_pot, 6)} {t(lang, 'test_usdc')}</dd></div>
          </>}
        </dl>
        {chain.phase === 'Finalized' && ev_q.data?.verified && <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={copy_link}>{t(lang, 'verify_copy_link')}</button>
          {share && <small role="status">{t(lang, share === 'copied' ? 'verify_link_copied' : 'verify_copy_failed')}</small>}
        </div>}
      </section>}

      <section className="card verify-checks flex flex-col gap-3 p-4">
        {ev_q.data?.verified && chain && <div className="verification-seal">
          <span className="ink-stamp">{vi ? 'Khớp on-chain' : 'On-chain match'}</span>
          <ChainMark signal={chain.ch.evidence_hash} />
        </div>}
        {chain && result && <><Check
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
        /></>}
        {(chain_q.isError || ev_q.isError) && <div>
          <p role="status">{t(lang, 'error_load')}</p>
          <button type="button" className="btn btn-ghost" disabled={chain_q.isFetching || ev_q.isFetching} onClick={() => {
            if (chain_q.isError) void chain_q.refetch();
            if (ev_q.isError && chain) void ev_q.refetch();
          }}>{t(lang, 'retry')}</button>
        </div>}
        {id !== null && !chain_q.isError && !ev_q.isError && (chain?.ch.evidence_hash === ZERO_ROOT ?
          <p>{vi ? 'Chưa có bằng chứng công bố.' : 'Evidence has not been published yet.'}</p> :
          !result && <p role="status">{t(lang, 'loading')}</p>)}
        {id === null && <p role="status">{t(lang, 'error_load')}</p>}
        {tx && <a className="record-link" href={tx} target="_blank" rel="noreferrer">{vi ? 'Giao dịch chốt kết quả' : 'Finalization transaction'} ↗</a>}
        {manager && <a className="record-link" href={manager} target="_blank" rel="noreferrer">{vi ? 'Hợp đồng thử thách' : 'Challenge contract'} ↗</a>}
        {tx_q.isError && <button type="button" className="btn btn-ghost" disabled={tx_q.isFetching} onClick={() => void tx_q.refetch()}>
          {vi ? 'Tải lại giao dịch chốt' : 'Retry finalization transaction'}
        </button>}
        {result?.error ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{result.error}</p> : null}
      </section>

      {ev_q.data?.verified && <section className="card paper-on-scroll p-4">
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
              {(ev_q.data.evidence.entries ?? []).map((e) => (
                <tr key={e.account} className="border-t border-[var(--border)]">
                  <td className="py-1">{short_address(e.account)}</td>
                  <td className="py-1">{e.completed ? '✓' : '✗'}</td>
                  <td className="py-1">{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
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
    <div className="verify-check flex flex-col gap-1">
      <div className="flex items-center gap-2 font-semibold">
        <span className="verify-mark" style={{ color: ok ? 'var(--success)' : 'var(--accent)' }}>{ok ? '✓' : '✗'}</span>
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
