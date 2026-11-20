'use client';
// My stakes: Joined events for the connected wallet, each stake's phase and claim status, plus the badge.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { parseAbiItem } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { t, type DictKey } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { addresses, abis, public_client, read_event_history, PHASE_NAMES, type PhaseName } from '@/lib/contracts';
import { CHAIN_ID } from '@/lib/config';
import { BadgeCard } from './badge_card';
import { LinkStatus } from './link_status';
import { AccountGate } from './account_gate';
import { format_time, phase_key } from '@/lib/format';
import { FujiWalletSetup } from './fuji_wallet_setup';
import { use_challenge } from '@/hooks/use_challenge';
import { use_course_metadata } from '@/hooks/use_course_record';
import { useChallengeList } from './challenge_list';
import { public_rows } from '@/lib/catalog';
import { oracle } from '@/lib/oracle';
import { moodle_quiz_url } from '@/lib/moodle';

const joined_event = parseAbiItem(
  'event Joined(uint256 indexed id, address indexed account, uint128 amount, uint256 shares, uint64 joined_time)',
);

interface StakeRow {
  id: bigint;
  amount: bigint;
  phase: PhaseName;
  claimed: boolean;
}

export function MyStakes() {
  const { lang } = use_ui();
  const { address } = useAccount();

  const q = useQuery<StakeRow[]>({
    queryKey: ['me', address ?? null],
    enabled: !!address,
    queryFn: async () => {
      const logs = await read_event_history((fromBlock, toBlock) => public_client.getLogs({
        address: addresses.manager,
        event: joined_event,
        args: { account: address! },
        fromBlock, toBlock,
      }));
      const rows: StakeRow[] = [];
      for (const log of logs) {
        const id = log.args.id!;
        const phase_idx = await public_client.readContract({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'phase_of',
          args: [id],
        });
        const claimed = (await public_client.readContract({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'claimed',
          args: [id, address!],
        })) as boolean;
        rows.push({ id, amount: log.args.amount!, phase: PHASE_NAMES[Number(phase_idx)] ?? 'Joining', claimed });
      }
      return rows.reverse();
    },
  });

  if (!address) {
    return <AccountGate page="me" />;
  }

  const vi = lang === 'vi';
  const groups = [
    {key:'claim', name:vi ? 'Có thể nhận lại' : 'Ready to claim'},
    {key:'learning', name:vi ? 'Đang học' : 'In progress'},
    {key:'waiting', name:vi ? 'Chờ chốt kết quả' : 'Awaiting settlement'},
    {key:'history', name:vi ? 'Đã nhận' : 'Claim history'},
  ];
  function section(row: StakeRow) {
    if (row.claimed) return 'history';
    if (row.phase === 'Finalized' || row.phase === 'Expired') return 'claim';
    return row.phase === 'Joining' || row.phase === 'Running' ? 'learning' : 'waiting';
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="notebook-heading flex flex-wrap items-end justify-between gap-4">
        <h1>{t(lang, 'personal_notebook')}</h1>
      </div>
      <NextAction address={address}
        row={q.data?.find(row => section(row) === 'claim') ?? q.data?.find(row => section(row) === 'learning') ??
          q.data?.find(row => section(row) === 'waiting')}
        loaded={q.isSuccess} failed={q.isError} retry={() => void q.refetch()} />
      <div className="notebook-panels grid gap-4 md:grid-cols-2">
        <LinkStatus />
        {CHAIN_ID === 43113 && <FujiWalletSetup key={address} address={address} />}
      </div>
      <h2 className="text-xl font-semibold">{t(lang, 'me_title')}</h2>
      {q.isLoading ? <p className="text-[var(--muted)]">{t(lang, 'loading')}</p> : null}
      {q.data && q.data.length === 0 ? <p className="text-[var(--muted)]">{t(lang, 'me_empty')}</p> : null}
      {q.isError && <p role="status">{t(lang,'error_load')}</p>}
      {groups.map(group => {
        const rows = (q.data ?? []).filter(row => section(row) === group.key);
        if (!rows.length) return null;
        return <section className="folio paper-on-scroll" key={group.key}><div className="sheet-head"><h2>{group.name}</h2><span>{rows.length}</span></div>
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.id.toString()} className="card stake-row flex flex-wrap items-center justify-between gap-3 p-4">
                  <Link href={`/challenges/${row.id.toString()}`} className="font-semibold">
                    {vi ? 'Thử thách' : 'Challenge'} #{row.id.toString()}{group.key === 'claim' ? (vi ? ' · Nhận tiền hoàn lại →' : ' · Claim return →') : ''}
                  </Link>
                  <span className="num">{format_usdc(row.amount)} USDC</span>
                  <span className="badge-phase">{t(lang, phase_key(row.phase))}</span>
                  {row.claimed ? <span className="stake-claimed">✓</span> : null}
                </li>
              ))}
            </ul>
        </section>;
      })}
      <BadgeCard wallet={address} />
    </div>
  );
}

function NextAction({ address, row, loaded, failed, retry }: {
  address: `0x${string}`; row?: StakeRow; loaded: boolean; failed: boolean; retry: () => void;
}) {
  const { lang } = use_ui();
  const now = Math.floor(Date.now() / 1000);
  const catalog = useChallengeList(loaded && !row);
  const open = !row ? public_rows(catalog.data).find(r => r.phase === 'Joining' && r.target > now) : undefined;
  const id = row?.id ?? (open ? BigInt(open.id) : null);
  const { data } = use_challenge(id);
  const meta = use_course_metadata(data?.ch.metadata_hash).data;
  const link = useQuery({
    queryKey: ['link', address],
    queryFn: () => oracle.get_link(address),
    enabled: meta?.lms === 'moodle',
  }).data;
  const end = data ? Number(data.ch.end_time) : undefined;
  const joining = data?.phase === 'Joining' && Number(data.ch.join_deadline) > now;
  const learning = data && (data.phase === 'Joining' || data.phase === 'Running') && end !== undefined && end > now;
  const challenge_path = id !== null ? `/challenges/${id}` : '/challenges';
  let href = '/challenges';
  let label: DictKey = 'next_browse';
  let detail: DictKey | undefined;
  let deadline: number | undefined;
  let external = false;
  if (id !== null && (row || joining)) {
    href = challenge_path;
    label = 'next_open_challenge';
    if (row && (data?.phase === 'Finalized' || data?.phase === 'Expired')) {
      href = `${challenge_path}#claim`;
      label = 'claim';
    } else if (learning && (!row ? joining : true)) {
      const needs_link = meta?.lms === 'moodle' && link &&
        (!link.linked || link.lms !== 'moodle' || link.site?.replace(/\/+$/, '') !== meta.site.replace(/\/+$/, ''));
      deadline = row ? end : Number(data.ch.join_deadline);
      if (needs_link) {
        href = `/link?challenge=${id}`;
        label = 'link_title';
        detail = 'moodle_join_required';
      } else if (!row) {
        href = `${challenge_path}#join`;
        label = 'join';
      } else {
        const open_tasks = meta?.activities.filter(activity => Math.min(activity.due, end) > now) ?? [];
        deadline = Math.min(end, ...open_tasks.map(activity => activity.due));
        const [task] = open_tasks;
        const quiz_url = link?.linked && meta?.lms === 'moodle' && open_tasks.length === 1 && task?.kind === 'quiz' ?
          moodle_quiz_url(meta.site, task.instance_id) : null;
        if (quiz_url) {
          href = quiz_url;
          external = true;
          label = 'open_quiz';
        } else {
          href = `${challenge_path}#submission-checklist`;
        }
      }
    } else if (row) {
      label = 'next_check_result';
      href = `${challenge_path}#course-result`;
      const phase = data?.phase ?? row.phase;
      detail = phase === 'AwaitingSettle' && meta?.lms === 'moodle' ? 'awaiting_moodle' : phase_key(phase);
    }
  }
  return (
    <section className="folio grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <h2>{t(lang, 'next_action')}</h2>
        {failed && !loaded ? <p role="status">{t(lang, 'error_load')}</p> :
          !loaded || (!row && catalog.isLoading) ? <p role="status">{t(lang, 'loading')}</p> :
          id !== null && (row || joining) && <>
            <p>{meta?.title ?? open?.title ?? `#${id}`}</p>
            {detail && <p>{t(lang, detail)}</p>}
            {deadline && <small>{t(lang, row ? 'next_activity_deadline' : 'next_join_deadline')} · {format_time(deadline, lang)}</small>}
          </>}
      </div>
      {failed && !loaded ? <button className="btn" type="button" onClick={retry}>{t(lang, 'retry')}</button> :
        loaded && (!!row || !catalog.isLoading) && (external ?
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <a className="btn" href={href} target="_blank" rel="noreferrer">{t(lang, label)} ↗</a>
            <Link className="record-link" href={`${challenge_path}#submission-checklist`}>{t(lang, 'next_check_submissions')}</Link>
          </div> :
          <Link className="btn" href={href}>{t(lang, label)} →</Link>)}
    </section>
  );
}
