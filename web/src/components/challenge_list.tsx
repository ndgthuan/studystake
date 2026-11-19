'use client';
// Challenge list: reads challenge_count and each challenge on chain, then fills titles from the oracle metadata.
// Filter by phase. Metadata title is plain text only.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { format_time, phase_key } from '@/lib/format';
import { addresses, abis, public_client, PHASE_NAMES, to_challenge, type PhaseName } from '@/lib/contracts';
import { course_ref } from './course_cover';
import { oracle } from '@/lib/oracle';

interface Row {
  id: number;
  phase: PhaseName;
  total_principal: bigint;
  participant_count: number;
  target: number;
  course: string;
  lms?: string;
  title: string | null;
}

const FILTERS: (PhaseName | 'all')[] = ['all', 'Joining', 'Running', 'AwaitingSettle', 'DisputeWindow', 'Finalized', 'Expired'];

export function ChallengeList() {
  const { lang } = use_ui();
  const [filter, set_filter] = useState<PhaseName | 'all'>('all');


  const q = useQuery<Row[]>({
    queryKey: ['challenges'],
    queryFn: async () => {
      const count = Number(
        await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'challenge_count' }),
      );
      const rows: Row[] = [];
      for (let id = 1; id <= count; id++) {
        const raw = await public_client.readContract({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'get_challenge',
          args: [BigInt(id)],
        });
        const ch = to_challenge(raw);
        const phase_idx = await public_client.readContract({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'phase_of',
          args: [BigInt(id)],
        });
        const phase = PHASE_NAMES[Number(phase_idx)] ?? 'Joining';
        const target = phase === 'Joining' ? Number(ch.join_deadline) : Number(ch.end_time);
        let course = `#${id}`;
        let lms: string | undefined;
        let title: string | null = null;
        try {
          const meta = await oracle.get_metadata(ch.metadata_hash);
          title = meta.title;
          course = course_ref(meta,String(id));
          lms = meta.lms === 'demo' ? 'Demo LMS' : 'Moodle';
        } catch {
          title = null;
        }
        rows.push({
          id,
          phase,
          total_principal: ch.total_principal,
          participant_count: ch.participant_count,
          target, course, lms,
          title,
        });
      }
      return rows.reverse();
    },
    refetchInterval: 30_000,
  });

  const rows = (q.data ?? []).filter((r) => filter === 'all' || r.phase === filter);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'nav_challenges')}</h1>
      <div className="filter-strip flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn' : 'btn btn-ghost'}
            aria-pressed={filter === f}
            onClick={() => set_filter(f)}
          >
            {f === 'all' ? t(lang, 'filter_all') : t(lang, phase_key(f))}
          </button>
        ))}
      </div>
      {q.isLoading ? <p className="text-[var(--muted)]">{t(lang, 'loading')}</p> : null}
      {q.error ? <p className="text-[var(--muted)]">{t(lang, 'error_load')}</p> : null}
      {q.data && rows.length === 0 ? <p className="text-[var(--muted)]">{t(lang, 'no_challenges')}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/challenges/${r.id}`} className="catalog-card">
              <div className="catalog-tab">{r.course} <small>{r.lms}</small></div>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{r.title ?? `Challenge #${r.id}`}</span>
                <span className="badge-phase">{t(lang, phase_key(r.phase))}</span>
              </div>
              <div className="num text-sm text-[var(--muted)]">
                {format_usdc(r.total_principal)} USDC · {r.participant_count} {lang === 'vi' ? 'người' : 'people'}
              </div>
              <div className="num text-sm">{r.phase === 'Joining' ? (lang === 'vi' ? 'Hạn tham gia' : 'Enrollment closes') : (lang === 'vi' ? 'Hạn nộp' : 'Due')} · {format_time(r.target,lang)} <b aria-hidden="true">↗</b></div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
