'use client';
// My stakes: Joined events for the connected wallet, each stake's phase and claim status, plus the badge.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { parseAbiItem } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';
import { addresses, abis, public_client, PHASE_NAMES, type PhaseName } from '@/lib/contracts';
import { CHAIN_ID, DEPLOY_FROM_BLOCK } from '@/lib/config';
import { BadgeCard } from './badge_card';
import { LinkStatus } from './link_status';
import { phase_key } from '@/lib/format';

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
      const logs = await public_client.getLogs({
        address: addresses.manager,
        event: joined_event,
        args: { account: address! },
        fromBlock: DEPLOY_FROM_BLOCK,
        toBlock: 'latest',
      });
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
    return <p className="text-[var(--muted)]">{t(lang, 'connect')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'me_title')}</h1>
      <LinkStatus />
      <BadgeCard wallet={address} />
      {CHAIN_ID === 43113 ? (
        <section className="card flex flex-col gap-1 p-4">
          <h2 className="font-semibold">{t(lang, 'aave_yield_title')}</h2>
          <p className="text-sm text-[var(--muted)]">{t(lang, 'aave_yield_status')}</p>
        </section>
      ) : null}
      {q.isLoading ? <p className="text-[var(--muted)]">{t(lang, 'loading')}</p> : null}
      {q.data && q.data.length === 0 ? <p className="text-[var(--muted)]">{t(lang, 'me_empty')}</p> : null}
      <ul className="flex flex-col gap-3">
        {(q.data ?? []).map((row) => (
          <li key={row.id.toString()} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <Link href={`/challenges/${row.id.toString()}`} className="font-semibold">
              Challenge #{row.id.toString()}
            </Link>
            <span className="num">{format_usdc(row.amount)} USDC</span>
            <span className="badge-phase">{t(lang, phase_key(row.phase))}</span>
            {row.claimed ? <span style={{ color: 'var(--success)' }}>✓</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
