'use client';
// Challenge detail: info, join, progress, demo submit, dispute, finalize/expire, claim.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { use_challenge } from '@/hooks/use_challenge';
import { t } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { countdown, format_time, phase_key } from '@/lib/format';
import { countdown_target, pot_display } from '@/lib/challenge_display';
import { explorer_address } from '@/lib/config';
import { addresses, abis, public_client } from '@/lib/contracts';
import { use_course_metadata, use_course_evidence } from '@/hooks/use_course_record';
import { CourseCover } from './course_cover';
import { ZERO_ROOT } from '@/lib/verify';
import { WalletButton } from './wallet_button';
import { JoinForm } from './join_form';
import { ProgressPanel } from './progress_panel';
import { ClaimPanel } from './claim_panel';
import { ActionsPanel } from './actions_panel';
import { DisputePanel } from './dispute_panel';

export function ChallengeDetail({ id_param }: { id_param: string }) {
  const { lang } = use_ui();
  const id = /^\d+$/.test(id_param) ? BigInt(id_param) : null;
  const { data, isLoading, error } = use_challenge(id);
  const metadata = use_course_metadata(data?.ch.metadata_hash);
  const evidence = use_course_evidence(id, data?.ch);
  // Vault value of all shares, used only for the pre-finalize yield estimate.
  const vault_assets = useQuery<bigint | null>({
    queryKey: ['vault_assets', id?.toString() ?? null, data?.ch.total_shares?.toString() ?? null],
    enabled: !!data && data.ch.total_shares > 0n,
    queryFn: async () =>
      (await public_client.readContract({
        address: data!.ch.vault,
        abi: abis.vault,
        functionName: 'convertToAssets',
        args: [data!.ch.total_shares],
      })) as bigint,
    refetchInterval: 15_000,
  });
  const { address } = useAccount();
  const stake = useQuery({
    queryKey: ['stake', id?.toString(), address],
    enabled: id !== null && !!address && !!data,
    queryFn: () => public_client.readContract({
      address: addresses.manager, abi: abis.manager, functionName: 'stake_of', args: [id!, address!],
    }) as Promise<bigint>,
    refetchInterval: 15_000,
  });
  const enrolled = (stake.data ?? 0n) > 0n;
  // 1-second tick so the countdown updates without a refetch.
  const [now, set_now] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => set_now(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (id === null) return <p className="text-[var(--muted)]">Invalid challenge id</p>;
  if (isLoading) return <p className="text-[var(--muted)]">{t(lang, 'loading')}</p>;
  if (error || !data) return <p className="text-[var(--muted)]">{t(lang, 'error_load')}</p>;

  const { ch, phase } = data;
  const target = countdown_target({
    phase,
    join_deadline: Number(ch.join_deadline),
    end_time: Number(ch.end_time),
    settle_grace: Number(ch.settle_grace),
    settled_at: Number(ch.settled_at),
    dispute_window: Number(ch.dispute_window),
  });
  const pot = pot_display({
    phase,
    reward_pot: ch.reward_pot,
    total_bonus: ch.total_bonus,
    total_shares_assets: vault_assets.data ?? ch.total_principal,
    total_principal: ch.total_principal,
  });


  const vi = lang === 'vi';
  const meta = metadata.data;
  const closed = phase === 'Finalized' || phase === 'Expired';
  const committed = ch.evidence_hash !== ZERO_ROOT;
  const verified = phase === 'Finalized' && evidence.data?.verified;
  const has_estimate = ch.total_shares === 0n || vault_assets.data != null;
  const principal = closed && (ch.loss || phase === 'Expired') ? ch.final_assets : ch.total_principal;
  const explorer = explorer_address(addresses.manager);
  return (
    <article className="course-file">
      <nav className="crumb"><Link href="/challenges">← {t(lang,'nav_challenges')}</Link><span>/</span>#{id_param}</nav>
      <CourseCover id={id.toString()} meta={meta} lang={lang} phase={phase} end={Number(ch.end_time)} />
      <div className="record-columns">
        <div className="record-main">
          <ProgressPanel id={id} wallet={address ?? null} accepting_demo={phase === 'Joining' || phase === 'Running'}
            meta={meta} metadata_failed={metadata.isError} enrolled={enrolled} final={closed} finalized={phase === 'Finalized'}
            evidence={evidence.data?.verified ? evidence.data.evidence : undefined} />
          <section className="folio result-sheet">
            <div className="sheet-head"><h2>{vi ? 'Kết quả học phần' : 'Course result'}</h2>
              {verified && <span className="ink-stamp" role="status">✓ {vi ? 'Đã xác minh' : 'Verified'}</span>}
            </div>
            <p>{phase === 'Finalized' ? (vi ? `${ch.completed_count} / ${ch.participant_count} sinh viên hoàn thành theo kết quả đã chốt.` :
              `${ch.completed_count} of ${ch.participant_count} students completed the course.`) : t(lang,phase_key(phase))}</p>
            {committed && <Link className="record-link" href={`/verify/${id}`}>{vi ? 'Đối chiếu bằng chứng' : 'Inspect evidence'} ↗</Link>}
          </section>
          <ActionsPanel id={id} phase={phase} />
          <DisputePanel id={id} phase={phase} wallet={address ?? null} />
        </div>
        <aside className="record-side">
          <section className="receipt">
            <div className="receipt-top"><h2>{vi ? 'Phiếu đối soát' : 'Settlement slip'}</h2><span>USDC</span></div>
            <p className="receipt-scope">{vi ? 'Toàn bộ thử thách' : 'Whole challenge'}</p>
            <dl>
              <Info label={vi ? (closed ? 'Vốn gốc hoàn lại' : 'Vốn gốc đã cọc') : (closed ? 'Returnable principal' : 'Principal staked')} value={format_usdc(principal,6)} />
              <Info label={vi ? 'Thưởng ước tính' : 'Estimated rewards'} value={pot.estimated && has_estimate ? format_usdc(pot.amount,6) : '—'} />
              <Info label={vi ? 'Thưởng đã chốt' : 'Final rewards'} value={!pot.estimated ? format_usdc(pot.amount,6) : '—'} />
            </dl>
            <div className="receipt-total"><small>{vi ? 'Sinh viên tham gia' : 'Enrolled students'}</small><b>{ch.participant_count}</b></div>
            {committed && <Link className="btn receipt-cta" href={`/verify/${id}`}>{vi ? 'Xác minh kết quả' : 'Verify result'} <span>↗</span></Link>}
          </section>
          {phase === 'Joining' && (!address || stake.data === 0n) && (address
            ? <JoinForm id={id} token={ch.token} min_stake={ch.min_stake} max_stake={ch.max_stake} total_principal={ch.total_principal} estimated_pot={has_estimate ? pot.amount : null} />
            : <section className="folio"><h2>{vi ? 'Tham gia thử thách' : 'Join challenge'}</h2><WalletButton /></section>)}
          <ClaimPanel id={id} phase={phase} wallet={address ?? null} />
          <details className="course-terms"><summary>{vi ? 'Điều kiện tham gia' : 'Enrollment details'}</summary><dl>
            <Info label={vi ? 'Hạn tham gia' : 'Join deadline'} value={format_time(Number(ch.join_deadline),lang)} />
            <Info label={vi ? 'Khoảng cọc' : 'Stake range'} value={`${format_usdc(ch.min_stake)} – ${format_usdc(ch.max_stake)} USDC`} />
            {target !== null && <Info label={vi ? 'Còn lại' : 'Time left'} value={countdown(target,now,lang)} />}
          </dl>{explorer && <a className="record-link" href={explorer} target="_blank" rel="noreferrer">{t(lang,'view_explorer')} ↗</a>}</details>
        </aside>
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="money-line"><dt>{label}</dt><dd>{value}</dd></div>;
}
