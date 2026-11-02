'use client';
// Progress: per-activity status from the oracle (GET /progress/:id/:wallet). Demo challenges get a submit button.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { oracle, type ProgressBody } from '@/lib/oracle';
import { t } from '@/lib/i18n';
import { format_time } from '@/lib/format';
import { demo_submit_message } from '@/lib/messages';
import { ORACLE_URL } from '@/lib/config';
import { useState } from 'react';

interface Props {
  id: bigint;
  wallet: `0x${string}` | null;
  /** True only while demo submissions are still accepted (before end_time). */
  accepting_demo: boolean;
}

export function ProgressPanel({ id, wallet, accepting_demo }: Props) {
  const { lang } = use_ui();
  const q = useQuery<ProgressBody>({
    queryKey: ['progress', id.toString(), wallet ?? null],
    enabled: !!wallet,
    queryFn: () => oracle.get_progress(Number(id), wallet!),
    refetchInterval: 30_000,
  });

  if (!wallet) return null;
  if (q.isLoading) return <p className="text-sm text-[var(--muted)]">{t(lang, 'loading')}</p>;
  if (q.error || !q.data) return <p className="text-sm text-[var(--muted)]">{t(lang, 'error_load')}</p>;

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">{t(lang, 'progress')}</h2>
      <ul className="flex flex-col gap-2">
        {q.data.activities.map((a) => (
          <li key={a.instance_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {a.kind === 'quiz' ? 'Quiz' : 'Assign'} #{a.instance_id}
            </span>
            <span className="num">
              {a.submitted ? (
                <span style={{ color: 'var(--success)' }}>✓ {a.time_finished ? format_time(a.time_finished, lang) : ''}</span>
              ) : (
                <span className="text-[var(--muted)]">✗ {a.status}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {accepting_demo ? (
        <DemoSubmit id={id} wallet={wallet} activities={q.data.activities.map((a) => a.instance_id)} />
      ) : null}
    </section>
  );
}

/** Demo submit: the wallet signs a message, then the oracle records the submission. DEMO only. */
function DemoSubmit({ id, wallet, activities }: { id: bigint; wallet: `0x${string}`; activities: number[] }) {
  const { lang } = use_ui();
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
      await qc.invalidateQueries({ queryKey: ['progress'] });
    } catch (err) {
      set_msg(err instanceof Error ? err.message : String(err));
    } finally {
      set_busy(null);
    }
  }

  if (activities.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <div className="text-xs text-[var(--muted)]">
        {t(lang, 'demo_submit')} · DEMO · {ORACLE_URL}
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
