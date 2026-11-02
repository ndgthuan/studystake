'use client';
// Landing: hero, three steps, and live on-chain numbers (total staked, challenge count, completers).
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { addresses, abis, public_client, to_challenge } from '@/lib/contracts';

interface Stats {
  count: number;
  locked: bigint;
  completers: number;
}

export default function HomePage() {
  const { lang } = use_ui();
  const q = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const count = Number(
        await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'challenge_count' }),
      );
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
        locked += ch.total_principal;
        completers += ch.completed_count;
      }
      return { count, locked, completers };
    },
    // Always refetch on mount and every 15 s, so a page opened before a settle does not keep a stale 0.
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });

  return (
    <div className="flex flex-col gap-10 py-6">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold sm:text-4xl">{t(lang, 'hero_title')}</h1>
        <p className="max-w-2xl text-[var(--muted)]">{t(lang, 'hero_sub')}</p>
        <div>
          <Link href="/challenges" className="btn inline-flex items-center">
            {t(lang, 'start')}
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[t(lang, 'step_1'), t(lang, 'step_2'), t(lang, 'step_3')].map((s, i) => (
          <div key={s} className="card p-4">
            <div className="num text-sm" style={{ color: 'var(--accent)' }}>
              0{i + 1}
            </div>
            <div className="font-semibold">{s}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label={t(lang, 'stat_locked')} value={q.data ? format_usdc(q.data.locked) : '—'} />
        <Stat label={t(lang, 'stat_challenges')} value={q.data ? String(q.data.count) : '—'} />
        <Stat label={t(lang, 'stat_completed')} value={q.data ? String(q.data.completers) : '—'} />
      </section>

      <p className="text-xs text-[var(--muted)]">{t(lang, 'footer_demo')}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="num text-2xl font-bold">{value}</div>
    </div>
  );
}
