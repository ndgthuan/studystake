'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { CourseNotebook } from '@/components/course_notebook';
import { MyStakes } from '@/components/my_stakes';
import { RollingNumber } from '@/components/rolling_number';
import { ChainMark } from '@/components/chain_mark';
import { active_chain, HIDDEN_CHALLENGES } from '@/lib/config';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { addresses, abis, public_client, STATUS_NAMES, to_challenge } from '@/lib/contracts';
import { ZERO_ROOT } from '@/lib/verify';

interface Stats {
  count: number;
  locked: bigint;
  enrollments: number;
  completers: number;
  latest_hash?: string;
  latest_result?: number;
  latest_id?: number;
}

export default function HomePage() {
  const { status } = useAccount();
  const { lang } = use_ui();

  if (status === 'connected') return <MyStakes />;
  if (status === 'connecting' || status === 'reconnecting') return <p role="status">{t(lang, 'loading')}</p>;
  return <PublicHome />;
}

function PublicHome() {
  const { lang } = use_ui();
  const query_client = useQueryClient();
  const q = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const blockNumber = await public_client.getBlockNumber({ cacheTime: 0 });
      const count = Number(await public_client.readContract({
        address: addresses.manager, abi: abis.manager, functionName: 'challenge_count', blockNumber,
      }));
      let latest_hash: string | undefined;
      let latest_result: number | undefined;
      let last_finalized = 0n;
      let locked = 0n;
      let completers = 0;
      let listed = 0;
      let latest_id: number | undefined;
      let enrollments = 0;
      for (let id = 1; id <= count; id++) {
        if (HIDDEN_CHALLENGES.has(id)) continue;
        listed += 1;
        latest_id = id;
        const ch = to_challenge(
          await public_client.readContract({
            address: addresses.manager,
            abi: abis.manager,
            functionName: 'get_challenge',
            args: [BigInt(id)],
            blockNumber,
          }),
        );
        latest_hash = ch.metadata_hash;
        if (STATUS_NAMES[ch.status] === 'Finalized' && ch.evidence_hash !== ZERO_ROOT && ch.finalized_at >= last_finalized) {
          latest_result = id;
          last_finalized = ch.finalized_at;
        }
        locked += ch.total_principal;
        completers += ch.completed_count;
        enrollments += ch.participant_count;
      }
      return { count: listed, latest_id, locked, enrollments, completers, latest_hash, latest_result };
    },
    // Always refetch on mount and every 15 s, so a page opened before a settle does not keep a stale 0.
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });

  useEffect(() => {
    let unwatch: (() => void) | undefined;
    const sync = () => {
      if (document.hidden) {
        unwatch?.();
        unwatch = undefined;
      } else if (!unwatch) {
        unwatch = public_client.watchContractEvent({
          address: addresses.manager,
          abi: abis.manager,
          eventName: 'Joined',
          pollingInterval: 4_000,
          onLogs: () => void query_client.invalidateQueries({ queryKey: ['stats'] }),
        });
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      unwatch?.();
    };
  }, [query_client]);

  const stats = q.data;

  return (
    <div className="field-home">
      <section className="field-hero">
        <div className="hero-copy">
          <span className="network-label"><i aria-hidden="true" />{active_chain.name} · Testnet</span>
          <h1>{t(lang, 'hero_title')} <em>{t(lang, 'hero_emphasis')}</em></h1>
          <p>{t(lang, 'hero_sub')}</p>
          <Link href="/challenges" className="btn hero-cta">
            {t(lang, 'start')} <span aria-hidden="true">↗</span>
          </Link>
          {stats?.latest_result && <div className="mt-3">
            <Link className="record-link" href={`/verify/${stats.latest_result}`}>
              {lang === 'vi' ? 'Kiểm tra kết quả đã chốt' : 'Verify a finalized result'} · #{stats.latest_result} ↗
            </Link>
          </div>}
        </div>
        <CourseNotebook id={q.data?.latest_id} hash={q.data?.latest_hash} lang={lang} />
      </section>
      <section className="ledger paper-on-scroll">
        <div className="ledger-head">
          <h2>{lang === 'vi' ? 'Hoạt động toàn hệ thống' : 'Public activity'}</h2>
          <div className="ledger-signal">
            <span className="ledger-source">{lang === 'vi' ? 'Dữ liệu on-chain' : 'On-chain data'}</span>
            <ChainMark signal={stats ? `${stats.count}:${stats.locked}:${stats.enrollments}:${stats.completers}` : undefined} />
          </div>
        </div>
        <dl className="stats-grid" aria-busy={q.isLoading}>
          <Stat label={t(lang, 'stat_locked')} value={stats?.locked} unit="USDC" motif="coins" />
          <Stat label={t(lang, 'stat_enrollments')} value={stats && BigInt(stats.enrollments)} motif="joins" />
          <Stat label={t(lang, 'stat_challenges')} value={stats && BigInt(stats.count)} motif="peaks" />
          <Stat label={t(lang, 'stat_completed')} value={stats && BigInt(stats.completers)} motif="seal" />
        </dl>
        {q.isError && <p role="status">{t(lang, 'error_load')}</p>}
      </section>
      <p className="demo-note">{t(lang, 'testnet_notice')}</p>
    </div>
  );
}

function Stat({ label, value, unit, motif }: { label: string; value?: bigint; unit?: 'USDC'; motif: string }) {
  return (
    <div className={`stat stat-${motif}`}>
      <dt>{label}</dt>
      <dd className="num"><RollingNumber value={value} usdc={unit === 'USDC'} /> {unit && <small>{unit}</small>}</dd>
      <span className="stat-mark" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}
