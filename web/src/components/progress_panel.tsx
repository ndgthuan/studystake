'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { oracle, OracleError, type MetadataDoc } from '@/lib/oracle';
import { t, type Lang } from '@/lib/i18n';
import type { MoodleAccess } from '@/hooks/use_moodle_session';
import { format_time } from '@/lib/format';
import { demo_submit_message } from '@/lib/messages';
import { SubmissionReplay } from './submission_replay';
import { useEffect, useRef, useState } from 'react';
import { moodle_quiz_url } from '@/lib/moodle';
import type { Evidence } from '@/lib/verify';
import { useActionNotice } from './action_notices';

interface Props {
  id: bigint;
  now: number;
  wallet: `0x${string}` | null;
  accepting_demo: boolean;
  meta?: MetadataDoc;
  metadata_failed: boolean;
  enrolled: boolean;
  evidence?: Evidence;
  final: boolean;
  finalized: boolean;
  moodle_access: MoodleAccess;
}

const verdicts = {
  ok: { vi: 'Đủ điều kiện', en: 'Eligible' },
  before_join: { vi: 'Nộp trước khi tham gia', en: 'Submitted before joining' },
  late: { vi: 'Nộp trễ hạn', en: 'Submitted after the deadline' },
  low_grade: { vi: 'Điểm dưới mức tối thiểu', en: 'Below minimum grade' },
  missing: { vi: 'Chưa ghi nhận', en: 'No submission' },
  not_joined: { vi: 'Chưa tham gia', en: 'Not enrolled' },
  not_linked: { vi: 'Chưa liên kết Moodle', en: 'Moodle account not linked' },
} satisfies Record<string, Record<Lang, string>>;

function verdict_label(reason: string, lang: Lang) {
  const known = Object.hasOwn(verdicts, reason) ? verdicts[reason as keyof typeof verdicts][lang] : undefined;
  return known ?? t(lang, reason === 'link_broken' ? 'progress_link_broken' : 'progress_unavailable');
}

export function ProgressPanel({id, now, wallet, accepting_demo, meta, metadata_failed, enrolled, evidence, final, finalized, moodle_access}: Props) {
  const {lang} = use_ui();
  const vi = lang === 'vi';
  const moodle = meta?.lms === 'moodle';
  const token = moodle_access.token;
  const [authorizing, set_authorizing] = useState(false);
  const [auth_error, set_auth_error] = useState(false);
  const [celebrate, set_celebrate] = useState(false);
  const last_eligible = useRef<{ scope: string; count: number } | null>(null);
  const q = useQuery({
    queryKey: ['progress', id.toString(), wallet, moodle ? moodle_access.generation : null],
    enabled: !!meta && !!wallet && enrolled && !(final && evidence) && (!moodle || !!token),
    queryFn: ({ signal }) => oracle.get_progress(Number(id), wallet!, moodle ? token : undefined, signal),
    refetchInterval: 30_000, gcTime: moodle ? 0 : undefined,
    retry: (count, err) => !(err instanceof OracleError && err.status === 401) && count < 2,
  });
  const unauthorized = q.error instanceof OracleError && q.error.status === 401;
  const entry = wallet && final ? evidence?.entries.find(e => e.account.toLowerCase() === wallet.toLowerCase()) : undefined;
  const archived = final && !!evidence;
  const current = archived ? entry?.activities : q.isError ? undefined : q.data?.activities;
  const link_broken = !archived && q.data?.activities.some(a => ['link_broken', 'not_linked'].includes(a.reason));
  const unavailable = !archived && q.data?.activities.some(a => ['link_broken', 'lms_error', 'not_linked'].includes(a.reason));
  const recorded_count = unavailable ? undefined : current?.filter(a => a.submitted).length;
  const eligible_count = !archived && !q.isError && !unavailable ? q.data?.activities.filter(a => a.eligible).length : undefined;
  const count = meta?.activities.length;
  const replay_entry = wallet ? entry : evidence?.entries.find(e => e.completed) ?? evidence?.entries[0];
  const source = meta?.lms === 'moodle' ? 'Moodle' : 'Demo LMS';
  const course_url = meta?.lms === 'moodle' && /^https:\/\//i.test(meta.site)
    ? `${meta.site.replace(/\/+$/,'')}/course/view.php?id=${meta.course_id}` : null;
  const can_open_moodle = enrolled && accepting_demo && !link_broken;
  const open_assignments = meta?.activities.some(task => task.kind === 'assign' && task.due > now);

  useEffect(() => {
    if (eligible_count === undefined || !wallet) return;
    const scope = `${id}:${wallet}:${moodle_access.generation ?? ''}`;
    const previous = last_eligible.current;
    last_eligible.current = { scope, count: eligible_count };
    if (previous?.scope !== scope || eligible_count <= previous.count) return;
    set_celebrate(true);
    const timeout = window.setTimeout(() => set_celebrate(false), 850);
    return () => { window.clearTimeout(timeout); set_celebrate(false); };
  }, [eligible_count, id, moodle_access.generation, wallet]);

  async function authorize_progress() {
    set_authorizing(true);
    set_auth_error(false);
    try {
      await moodle_access.authorize(unauthorized);
    } catch {
      set_auth_error(true);
    } finally {
      set_authorizing(false);
    }
  }

  return (
    <section className="folio tasks-sheet" id="submission-checklist">
      <div className="sheet-head"><h2>{vi ? 'Bài cần nộp' : 'Submission checklist'}</h2>
        {count !== undefined && <span className="sheet-index">{String(count).padStart(2,'0')} {vi ? 'bài' : 'tasks'}</span>}</div>
      {!meta && <p role="status">{t(lang,metadata_failed ? 'error_load' : 'loading')}</p>}
      {meta && <>
        {wallet && enrolled && !archived && moodle && (!token || unauthorized) && <div>
          <p>{t(lang, 'moodle_progress_consent')}</p>
          <button type="button" className="btn btn-ghost" disabled={authorizing || !moodle_access.ready} onClick={authorize_progress}>
            {t(lang, 'moodle_progress_authorize')}
          </button>
          {auth_error && <p role="alert">{t(lang, 'moodle_progress_access_error')}</p>}
        </div>}
        {wallet && recorded_count !== undefined && <div className="personal-progress">
          <span>{vi ? 'Bài đã ghi nhận' : 'Recorded submissions'} <b>{recorded_count}/{count}</b></span>
          {eligible_count !== undefined && <>
            <span aria-live="polite">{vi ? 'Bài đủ điều kiện' : 'Eligible submissions'} <b className={celebrate ? 'eligibility-change' : undefined}>{eligible_count}/{count}</b></span>
            <div role="progressbar" aria-label={vi ? 'Bài đủ điều kiện' : 'Eligible submissions'} aria-valuemin={0} aria-valuemax={count} aria-valuenow={eligible_count}>
              <i style={{width:`${count ? 100 * eligible_count/count : 0}%`}} /></div>
          </>}
        </div>}
        {wallet && !archived && !q.isError && q.data && <div className="flex flex-wrap items-center gap-2 text-sm">
          <small>{t(lang, 'progress_checked')} · <time dateTime={new Date(q.data.as_of * 1000).toISOString()}>{format_time(q.data.as_of, lang)}</time></small>
          {!unavailable && <button type="button" className="btn btn-ghost" disabled={q.isFetching} onClick={() => void q.refetch()}>{t(lang, 'refresh_status')}</button>}
        </div>}
        <ol className="activity-rows">{meta.activities.map((task,i) => {
          const live = !archived && !q.isError ? q.data?.activities.find(a => a.instance_id === task.instance_id && a.kind === task.kind) : undefined;
          const previous = archived ? entry?.activities?.find(a => a.instance_id === task.instance_id) : undefined;
          const recorded = evidence?.entries.some(e => e.activities) ?
            evidence.entries.filter(e => e.activities?.some(a => a.instance_id === task.instance_id && a.submitted)).length : undefined;
          const eligible = live?.eligible;
          const quiz = moodle && task.kind === 'quiz' && task.due > now && can_open_moodle ? moodle_quiz_url(meta.site, task.instance_id) : null;
          const status = live ? verdict_label(live.reason, lang) :
            previous?.submitted ? (vi ? `${source} đã ghi nhận` : `Recorded by ${source}`) : previous ? verdicts.missing[lang] : undefined;
          return <li key={`${task.kind}-${task.instance_id}`}>
            <span className={`task-number ${eligible ? 'recorded' : ''}`} aria-hidden="true">{eligible ? '✓' : String(i+1).padStart(2,'0')}</span>
            <div><h3>{quiz ? <a className="underline" href={quiz} target="_blank" rel="noreferrer">{task.name} ↗</a> : task.name}</h3><small>{task.kind === 'quiz' ? (vi ? 'Trắc nghiệm' : 'Quiz') : (vi ? 'Bài tập' : 'Assignment')} · {format_time(task.due,lang)}</small></div>
            {status ? <span className="activity-state">{status}</span> : !wallet && recorded !== undefined && <span className="activity-state">{recorded}/{evidence?.entries.length} {vi ? 'đã nộp' : 'submitted'}</span>}
          </li>;
        })}</ol>
        {finalized && replay_entry?.activities?.some(a => a.submitted && a.time_finished != null) && <SubmissionReplay key={replay_entry.account} entry={replay_entry} tasks={meta.activities} lang={lang} />}
        {entry && !entry.activities && <p>{entry.completed ? t(lang, 'completed') : verdict_label(entry.reason, lang)}</p>}
        {meta.min_grade !== null && <p>{vi ? 'Điểm tối thiểu' : 'Minimum grade'} · {meta.min_grade}</p>}
        {wallet && !archived && !unauthorized && (q.isError || unavailable) && <div>
          {q.isError && <p role="status">{t(lang,'error_load')}</p>}
          <button type="button" className="btn btn-ghost" disabled={q.isFetching} onClick={() => void q.refetch()}>{t(lang, 'retry')}</button>
        </div>}
        {wallet && archived && !entry && <small>{vi ? 'Ví này không có trong danh sách kết quả.' : 'This wallet has no entry in the results.'}</small>}
        {link_broken && <Link className="record-link" href={`/link?challenge=${id}`}>{t(lang, 'link_title')} ↗</Link>}
        {course_url && can_open_moodle && open_assignments && <a className="btn task-cta" href={course_url} target="_blank" rel="noreferrer">{vi ? 'Mở Moodle' : 'Open Moodle'} ↗</a>}
        {meta.lms === 'demo' && accepting_demo && wallet && enrolled &&
          <DemoSubmit id={id} wallet={wallet} activities={meta.activities.map(a => a.instance_id)} />}
      </>}
    </section>
  );
}
/** Demo submit: the wallet signs a message, then the oracle records the submission. DEMO only. */
function DemoSubmit({ id, wallet, activities }: { id: bigint; wallet: `0x${string}`; activities: number[] }) {
  const { lang } = use_ui();
  const notify = useActionNotice();
  const { data: client } = useWalletClient();
  const qc = useQueryClient();
  const [busy, set_busy] = useState<number | null>(null);
  const [msg, set_msg] = useState<string | null>(null);

  async function submit(instance_id: number) {
    if (!client) return;
    set_msg(null);
    set_busy(instance_id);
    try {
      const issued_at = Math.floor(Date.now() / 1000);
      const message = demo_submit_message(wallet, Number(id), instance_id, issued_at);
      const signature = await client.signMessage({ account: wallet, message });
      await oracle.post_demo_submit({ wallet, challenge_id: Number(id), instance_id, signature, issued_at });
      set_msg('DEMO · OK');
      notify({ tone: 'success', title: t(lang, 'notice_submission') });
      await qc.invalidateQueries({ queryKey: ['progress'] });
    } catch (err) {
      set_msg(err instanceof Error ? err.message : String(err));
      notify({ tone: 'error', title: t(lang, 'notice_submission_failed') });
    } finally {
      set_busy(null);
    }
  }

  if (activities.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <div className="text-xs text-[var(--muted)]">
        {t(lang, 'demo_submit')} · DEMO
      </div>
      <div className="flex flex-wrap gap-2">
        {activities.map((instance_id) => (
          <button key={instance_id} type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => submit(instance_id)}>
            {t(lang, 'demo_submit')} #{instance_id}
          </button>
        ))}
      </div>
      {msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}
    </div>
  );
}
