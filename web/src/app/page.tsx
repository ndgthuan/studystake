'use client';
// Landing: hero, three steps, and live on-chain numbers (total staked, challenge count, completers).
import Link from 'next/link';
import { CourseNotebook } from '@/components/course_notebook';
import { active_chain } from '@/lib/config';
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { addresses, abis, public_client, to_challenge } from '@/lib/contracts';

interface Stats {
  count: number;
  locked: bigint;
  completers: number;
  latest_hash?: string;
}

export default function HomePage() {
  const { lang } = use_ui();
  const q = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const count = Number(
        await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'challenge_count' }),
      );
      let latest_hash: string | undefined;
      let locked = 0n;
      let completers = 0;
      for (let id = 1; id <= count; id++) {
        const ch = to_challenge(
          await public_client.readContract({
            address: addresses.manager,
            abi: abis.manager,
            functionName: 'get_challenge',
            args: [BigInt(id)],
          }),
        );
        latest_hash = ch.metadata_hash;
        locked += ch.total_principal;
        completers += ch.completed_count;
      }
      return { count, locked, completers, latest_hash };
    },
    // Always refetch on mount and every 15 s, so a page opened before a settle does not keep a stale 0.
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });

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
        </div>
        <CourseNotebook id={q.data?.count} hash={q.data?.latest_hash} lang={lang} />
      </section>
      <section className="ledger">
        <div className="ledger-head">
          <h2>{lang === 'vi' ? 'Sổ hoạt động' : 'Activity ledger'}</h2>
          <span className="ledger-source">{lang === 'vi' ? 'Dữ liệu on-chain' : 'On-chain data'}</span>
        </div>
        <dl className="stats-grid" aria-busy={q.isLoading}>
          <Stat label={t(lang, 'stat_locked')} value={q.data ? format_usdc(q.data.locked) : '—'} unit="USDC" motif="coins" />
          <Stat label={t(lang, 'stat_challenges')} value={q.data ? String(q.data.count) : '—'} motif="peaks" />
          <Stat label={t(lang, 'stat_completed')} value={q.data ? String(q.data.completers) : '—'} motif="seal" />
        </dl>
        {q.isError && <p role="status">{t(lang, 'error_load')}</p>}
      </section>
      <p className="demo-note">{t(lang, 'footer_demo')}</p>
    </div>
  );
}

function Stat({ label, value, unit, motif }: { label: string; value: string; unit?: string; motif: string }) {
  return (
    <div className={`stat stat-${motif}`}>
      <dt>{label}</dt>
      <dd className="num">{value} {unit && <small>{unit}</small>}</dd>
      <span className="stat-mark" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}
