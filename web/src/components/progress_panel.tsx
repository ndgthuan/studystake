'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { oracle, type MetadataDoc } from '@/lib/oracle';
import { t } from '@/lib/i18n';
import { format_time } from '@/lib/format';
import { demo_submit_message } from '@/lib/messages';
import { SubmissionReplay } from './submission_replay';
import { useState } from 'react';
import type { Evidence } from '@/lib/verify';
import { useActionNotice } from './action_notices';

interface Props {
  id: bigint;
  wallet: `0x${string}` | null;
  accepting_demo: boolean;
  meta?: MetadataDoc;
  metadata_failed: boolean;
  enrolled: boolean;
  evidence?: Evidence;
  final: boolean;
  finalized: boolean;
}

export function ProgressPanel({id, wallet, accepting_demo, meta, metadata_failed, enrolled, evidence, final, finalized}: Props) {
  const {lang} = use_ui();
  const vi = lang === 'vi';
  const q = useQuery({
    queryKey: ['progress', id.toString(), wallet], enabled: !!wallet && enrolled && !(final && evidence),
    queryFn: () => oracle.get_progress(Number(id), wallet!), refetchInterval: 30_000,
  });
  const entry = wallet && final ? evidence?.entries.find(e => e.account.toLowerCase() === wallet.toLowerCase()) : undefined;
  const archived = final && !!evidence;
  const current = archived ? entry?.activities : q.data?.activities;
  const link_broken = !archived && q.data?.activities.some(a => a.status === 'link_broken');
  const done = current?.filter(a => a.submitted).length;
  const count = meta?.activities.length;
  const replay_entry = wallet ? entry : evidence?.entries.find(e => e.completed) ?? evidence?.entries[0];
  const source = meta?.lms === 'moodle' ? 'Moodle' : 'Demo LMS';
  const course_url = meta?.lms === 'moodle' && /^https:\/\//i.test(meta.site)
    ? `${meta.site.replace(/\/+$/,'')}/course/view.php?id=${meta.course_id}` : null;
  return (
    <section className="folio tasks-sheet">
      <div className="sheet-head"><h2>{vi ? 'Bài cần nộp' : 'Submission checklist'}</h2>
        {count !== undefined && <span className="sheet-index">{String(count).padStart(2,'0')} {vi ? 'bài' : 'tasks'}</span>}</div>
      {!meta && <p role="status">{t(lang,metadata_failed ? 'error_load' : 'loading')}</p>}
      {meta && <>
        {wallet && done !== undefined && <div className="personal-progress">
          <span>{vi ? 'Bài đã ghi nhận' : 'Recorded submissions'} <b>{done}/{count}</b></span>
          <div role="progressbar" aria-label={t(lang,'progress')} aria-valuemin={0} aria-valuemax={count} aria-valuenow={done}>
            <i style={{width:`${count ? 100 * done/count : 0}%`}} /></div></div>}
        <ol className="activity-rows">{meta.activities.map((task,i) => {
          const state = archived ? entry?.activities.find(a => a.instance_id === task.instance_id) :
            q.data?.activities.find(a => a.instance_id === task.instance_id && a.kind === task.kind);
          const recorded = evidence?.entries.filter(e => e.activities.some(a => a.instance_id === task.instance_id && a.submitted)).length;
          const status = state?.submitted ? (vi ? `${source} đã ghi nhận` : `Recorded by ${source}`) :
            state && 'status' in state && state.status === 'link_broken' ? t(lang, 'progress_link_broken') :
            state && 'status' in state && state.status !== 'missing' ? t(lang, 'progress_unavailable') :
            state ? (vi ? 'Chưa ghi nhận' : 'No submission') : undefined;
          return <li key={`${task.kind}-${task.instance_id}`}>
            <span className={`task-number ${state?.submitted ? 'recorded' : ''}`} aria-hidden="true">{state?.submitted ? '✓' : String(i+1).padStart(2,'0')}</span>
            <div><h3>{task.name}</h3><small>{task.kind === 'quiz' ? (vi ? 'Trắc nghiệm' : 'Quiz') : (vi ? 'Bài tập' : 'Assignment')} · {format_time(task.due,lang)}</small></div>
            {status ? <span className="activity-state">{status}</span> : !wallet && recorded !== undefined && <span className="activity-state">{recorded}/{evidence?.entries.length} {vi ? 'đã nộp' : 'submitted'}</span>}
          </li>;
        })}</ol>
        {finalized && replay_entry && <SubmissionReplay key={replay_entry.account} entry={replay_entry} tasks={meta.activities} lang={lang} />}
        {meta.min_grade !== null && <p>{vi ? 'Điểm tối thiểu' : 'Minimum grade'} · {meta.min_grade}</p>}
        {wallet && !archived && q.isError && <p role="status">{t(lang,'error_load')}</p>}
        {wallet && archived && !entry && <small>{vi ? 'Ví này không có trong danh sách kết quả.' : 'This wallet has no entry in the results.'}</small>}
        {link_broken && <Link className="record-link" href="/link">{t(lang, 'link_title')} ↗</Link>}
        {course_url && accepting_demo && <a className="btn task-cta" href={course_url} target="_blank" rel="noreferrer">{vi ? 'Mở Moodle' : 'Open Moodle'} ↗</a>}
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
