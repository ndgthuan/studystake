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
import { oracle } from '@/lib/oracle';
import { JoinForm } from './join_form';
import { ProgressPanel } from './progress_panel';
import { ClaimPanel } from './claim_panel';
import { ActionsPanel } from './actions_panel';
import { DisputePanel } from './dispute_panel';

export function ChallengeDetail({ id_param }: { id_param: string }) {
  const { lang } = use_ui();
  const id = /^\d+$/.test(id_param) ? BigInt(id_param) : null;
  const { data, isLoading, error } = use_challenge(id);
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Challenge #{id_param}</h1>
        <span className="badge-phase">{t(lang, phase_key(phase))}</span>
      </header>

      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <Info label={lang === 'vi' ? 'Hạn tham gia' : 'Join deadline'} value={format_time(Number(ch.join_deadline), lang)} />
        <Info label={lang === 'vi' ? 'Kết thúc' : 'End time'} value={format_time(Number(ch.end_time), lang)} />
        {target !== null ? <Info label={lang === 'vi' ? 'Đếm ngược' : 'Countdown'} value={countdown(target, now, lang)} /> : null}
        <Info label={lang === 'vi' ? 'Khoảng cọc (USDC)' : 'Stake range (USDC)'} value={`${format_usdc(ch.min_stake)} – ${format_usdc(ch.max_stake)}`} />
        <Info label={lang === 'vi' ? 'Tổng cọc (USDC)' : 'Total staked (USDC)'} value={format_usdc(ch.total_principal)} />
        <Info
          label={
            lang === 'vi'
              ? `Quỹ thưởng (USDC)${pot.estimated ? ' · ước tính' : ''}`
              : `Reward pool (USDC)${pot.estimated ? ' · estimate' : ''}`
          }
          value={format_usdc(pot.amount)}
        />
        <Info label={lang === 'vi' ? 'Số người' : 'Participants'} value={String(ch.participant_count)} />
        <Link href={explorer_address(addresses.manager) ?? '#'} className="text-sm underline text-[var(--muted)]">
          {t(lang, 'view_explorer')}
        </Link>
      </section>

      {phase === 'Joining' ? <JoinForm id={id} min_stake={ch.min_stake} max_stake={ch.max_stake} /> : null}

      <ProgressPanel id={id} wallet={address ?? null} accepting_demo={phase === 'Joining' || phase === 'Running'} />

      <ActionsPanel id={id} phase={phase} />

      <DisputePanel id={id} phase={phase} wallet={address ?? null} />

      <ClaimPanel id={id} phase={phase} wallet={address ?? null} />

      <EvidenceLink id={id} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="num font-semibold">{value}</div>
    </div>
  );
}

/** Evidence link: visible once the oracle has committed evidence for this challenge. */
function EvidenceLink({ id }: { id: bigint }) {
  const { lang } = use_ui();
  const { data } = useQuery({
    queryKey: ['evidence_exists', id.toString()],
    queryFn: () => oracle.get_evidence(Number(id)).then(() => true).catch(() => false),
    staleTime: 60_000,
  });
  if (!data) return null;
  return (
    <Link href={`/verify/${id.toString()}`} className="underline">
      {t(lang, 'evidence')} · {t(lang, 'verify')}
    </Link>
  );
}
