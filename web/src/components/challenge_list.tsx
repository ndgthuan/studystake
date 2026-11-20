'use client';
// Challenge list: reads challenge_count and each challenge on chain, then fills titles from the oracle metadata.
// Filter by phase. Metadata title is plain text only.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { format_time, phase_key } from '@/lib/format';
import { addresses, abis, public_client, PHASE_NAMES, to_challenge, type PhaseName } from '@/lib/contracts';
import { course_ref } from './course_cover';
import { oracle } from '@/lib/oracle';
import { public_rows, rows_for_student } from '@/lib/catalog';
import { use_moodle_session } from '@/hooks/use_moodle_session';
import { WalletButton } from './wallet_button';

interface Row {
  id: number;
  phase: PhaseName;
  total_principal: bigint;
  participant_count: number;
  target: number;
  course: string;
  lms?: string;
  lms_kind?: 'moodle' | 'demo';
  site?: string;
  course_id?: number;
  title: string | null;
}

const FILTERS: (PhaseName | 'all')[] = ['all', 'Joining', 'Running', 'AwaitingSettle', 'DisputeWindow', 'Finalized', 'Expired'];

export function ChallengeList() {
  const { lang } = use_ui();
  const [filter, set_filter] = useState<PhaseName | 'all'>('all');
  const q = useChallengeList();
  const listed = public_rows(q.data);
  const rows = listed.filter((r) => filter === 'all' || r.phase === filter);

  return (
    <div className="challenge-catalog flex flex-col gap-4">
      <ForYou rows={q.data ? listed : undefined} />
      <h1 className="text-2xl font-bold">{t(lang, 'explore_title')}</h1>
      <p className="text-sm text-[var(--muted)]">{t(lang, 'explore_help')}</p>
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
      <CatalogRows q={q} total={listed.length} rows={rows} onShowAll={() => set_filter('all')} />
    </div>
  );
}

export function useChallengeList(enabled = true) {
  return useQuery<Row[]>({
    queryKey: ['challenges'],
    enabled,
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
        let lms_kind: Row['lms_kind'];
        let site: string | undefined;
        let course_id: number | undefined;
        let title: string | null = null;
        try {
          const meta = await oracle.get_metadata(ch.metadata_hash);
          title = meta.title;
          course = course_ref(meta,String(id));
          lms = meta.lms === 'demo' ? 'Demo LMS' : 'Moodle';
          lms_kind = meta.lms;
          site = meta.site;
          course_id = meta.course_id;
        } catch {
          title = null;
        }
        rows.push({
          id,
          phase,
          total_principal: ch.total_principal,
          participant_count: ch.participant_count,
          target, course, lms, lms_kind, site, course_id,
          title,
        });
      }
      return rows.reverse();
    },
    refetchInterval: 30_000,
  });

}

function CatalogRows({ q, total, rows, onShowAll }: { q: ReturnType<typeof useChallengeList>; total: number; rows: Row[]; onShowAll: () => void }) {
  const { lang } = use_ui();
  return (
    <>
      {q.isLoading ? <p className="text-[var(--muted)]">{t(lang, 'loading')}</p> : null}
      {q.error ? <p className="text-[var(--muted)]">{t(lang, 'error_load')}</p> : null}
      {q.data && rows.length === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-[var(--muted)]">
            {t(lang, total ? 'no_matching_challenges' : 'no_challenges')}
          </p>
          {total > 0 && (
            <button type="button" className="btn btn-ghost" onClick={onShowAll}>{t(lang, 'show_all_challenges')}</button>
          )}
        </div>
      )}
      <RowCards rows={rows} />
    </>
  );
}

function RowCards({ rows }: { rows: Row[] }) {
  const { lang } = use_ui();
  return (
    <>
      <ul className="catalog-grid grid gap-3 sm:grid-cols-2">
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
              <div className="num text-sm">{r.phase === 'Joining' ? (lang === 'vi' ? 'Hạn tham gia' : 'Enrollment closes') : (lang === 'vi' ? 'Hạn nộp' : 'Due')} · {format_time(r.target,lang)} <b className="catalog-arrow" aria-hidden="true">↗</b></div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** "For you": after sign-in and a Moodle link, the challenges for the courses the student is enrolled in. */
function ForYou({ rows }: { rows: Row[] | undefined }) {
  const { lang } = use_ui();
  const { address } = useAccount();
  const access = use_moodle_session(address, Math.floor(Date.now() / 1000));
  const [auth_failed, set_auth_failed] = useState(false);
  const link = useQuery({ queryKey: ['link', address ?? null], enabled: !!address, queryFn: () => oracle.get_link(address!) });
  const moodle_linked = link.data?.linked === true && link.data.lms === 'moodle';
  const courses = useQuery({
    queryKey: ['moodle_courses', address ?? null, access.generation ?? null],
    enabled: !!address && !!access.token && moodle_linked,
    queryFn: () => oracle.get_moodle_courses(address!, access.token!),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const relink = <Link className="record-link" href="/link">{t(lang, 'link_title')} ↗</Link>;

  let body: ReactNode;
  if (!address) {
    body = <><p>{t(lang, 'for_you_login')}</p><WalletButton /></>;
  } else if (link.isPending) {
    body = <p className="text-[var(--muted)]">{t(lang, 'loading')}</p>;
  } else if (link.isError) {
    body = <p className="text-[var(--muted)]">{t(lang, 'error_load')}</p>;
  } else if (link.data?.linked && link.data.lms === 'demo') {
    const mine = rows_for_student(rows ?? [], link.data, undefined);
    body = <><p className="text-sm text-[var(--muted)]">{t(lang, 'for_you_demo')}</p>
      {mine.length ? <RowCards rows={mine} /> : <p className="text-[var(--muted)]">{t(lang, 'for_you_empty')}</p>}</>;
  } else if (!moodle_linked || courses.data?.linked === false) {
    const cleared = link.data?.cleared || courses.data?.cleared;
    body = <><p>{t(lang, cleared ? 'link_token_cleared' : 'for_you_link')}</p>{relink}</>;
  } else if (!access.token) {
    body = <>
      <p className="text-sm text-[var(--muted)]">{t(lang, 'for_you_check_help')}</p>
      <div><button type="button" className="btn" disabled={!access.ready} onClick={() => {
        set_auth_failed(false);
        access.authorize().catch(() => set_auth_failed(true));
      }}>{t(lang, 'for_you_check')}</button></div>
      {auth_failed && <p role="alert" className="text-sm text-[var(--accent)]">{t(lang, 'link_signature_error')}</p>}
    </>;
  } else if (courses.isError) {
    body = <><p className="text-[var(--muted)]">{t(lang, 'for_you_failed')}</p>{relink}</>;
  } else if (courses.isPending || !rows) {
    body = <p className="text-[var(--muted)]">{t(lang, 'loading')}</p>;
  } else {
    const mine = rows_for_student(rows, link.data, courses.data);
    body = mine.length ? <RowCards rows={mine} /> : <p className="text-[var(--muted)]">{t(lang, 'for_you_empty')}</p>;
  }

  return (
    <section className="folio flex flex-col gap-3">
      <div className="sheet-head"><h2>{t(lang, 'for_you_title')}</h2></div>
      {body}
    </section>
  );
}
