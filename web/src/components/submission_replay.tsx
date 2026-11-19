'use client';

import { useEffect, useState } from 'react';
import { format_time } from '@/lib/format';
import type { Lang } from '@/lib/i18n';
import type { MetadataDoc } from '@/lib/oracle';
import { short_address, type EvidenceEntry } from '@/lib/verify';

interface Props {
  entry: EvidenceEntry;
  tasks: MetadataDoc['activities'];
  lang: Lang;
}

// Replays a single signed-off record. Playback only changes the local playhead.
export function SubmissionReplay({ entry, tasks, lang }: Props) {
  const [step, set_step] = useState<number | null>(null);
  const [playing, set_playing] = useState(false);
  const vi = lang === 'vi';
  const submissions = entry.activities.filter(a => a.submitted && a.time_finished !== null)
    .sort((a, b) => a.time_finished! - b.time_finished!);
  const last = submissions.length + 1;
  useEffect(() => {
    if (!playing || step === null || step >= last) return;
    const timer = window.setTimeout(() => set_step(step + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [playing, step, last]);
  function start() {
    set_step(0);
    set_playing(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  if (step === null) return <button type="button" className="replay-trigger" onClick={start}>
    <span aria-hidden="true">▷</span> {vi ? 'Xem lại lượt nộp' : 'Replay submissions'}
  </button>;
  const done = Math.min(step, submissions.length);
  const event = submissions[done - 1];
  const task = event && tasks.find(a => a.instance_id === event.instance_id);
  return <div className="replay">
    <div className="replay-head"><span>{vi ? 'Bản phát lại' : 'Playback'} · {short_address(entry.account)}</span>
      <button type="button" aria-label={vi ? 'Đóng bản phát lại' : 'Close playback'} onClick={() => {set_playing(false);set_step(null);}}>×</button></div>
    <div className="personal-progress"><span>{vi ? 'Bài đã ghi nhận' : 'Recorded submissions'} <b>{done}/{tasks.length}</b></span>
      <div role="progressbar" aria-label={vi ? 'Tiến độ phát lại' : 'Playback progress'} aria-valuenow={done} aria-valuemin={0} aria-valuemax={tasks.length}>
        <i style={{width:`${tasks.length ? done / tasks.length * 100 : 0}%`}} />
      </div>
    </div>
    <p aria-live="polite">{step === last ? <span className="ink-stamp">✓ {vi ? 'Đã chốt kết quả' : 'Result finalized'}</span> :
      <span className="replay-event" key={step}>{event
        ? `${task?.name ?? `#${event.instance_id}`} · ${format_time(event.time_finished!, lang)}`
        : (vi ? 'Trước lượt nộp đầu tiên' : 'Before the first submission')}</span>}</p>
    {step === last ? <button onClick={start}>{vi ? 'Phát lại' : 'Replay'} ↺</button> :
      <><button onClick={() => set_playing(!playing)}>{playing ? (vi ? 'Tạm dừng' : 'Pause') : (vi ? 'Tiếp tục' : 'Play')}</button>
        <button onClick={() => {set_playing(false);set_step(step+1);}}>{vi ? 'Mốc tiếp' : 'Next event'} →</button></>}
  </div>;
}
