'use client';
// Claim panel for Finalized or Expired challenges.
// - Not yet claimed: preview_claim (principal and reward) and a Claim button.
// - Already claimed: the amounts from the account's Claimed event, and a link to the badge on /me.
// The gas estimate has a margin; claim() checks its own gasleft before the badge call.
import Link from 'next/link';
import { parseAbiItem, type Address } from 'viem';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis, public_client, read_event_history, type PhaseName } from '@/lib/contracts';
import { oracle } from '@/lib/oracle';
import { t } from '@/lib/i18n';
import { PayoutLines } from './payout_lines';
import { TxStatusLine } from './tx_status';

/** Gas buffer on top of the estimate. claim() forwards a fixed 300k to the badge and checks gasleft itself. */
const GAS_MARGIN_PERCENT = 130n;

const claimed_event = parseAbiItem(
  'event Claimed(uint256 indexed id, address indexed account, bool completed, uint256 principal_out, uint256 reward)',
);

interface Preview {
  principal_out: bigint;
  reward: bigint;
  completed: boolean;
  proof: `0x${string}`[];
}

interface Receipt {
  principal_out: bigint;
  reward: bigint;
  completed: boolean;
}

export function ClaimPanel({ id, phase, wallet }: { id: bigint; phase: PhaseName; wallet: `0x${string}` | null }) {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { state, run } = use_tx(lang, () => invalidate_challenge_queries(qc));

  const claimable_phase = phase === 'Finalized' || phase === 'Expired';

  // Already-claimed state from the Claimed event for this account.
  const receipt_q = useQuery<Receipt | null>({
    queryKey: ['claim_receipt', id.toString(), wallet ?? null],
    enabled: !!wallet && claimable_phase,
    queryFn: async () => {
      const already_claimed = await public_client.readContract({
        address: addresses.manager, abi: abis.manager, functionName: 'claimed', args: [id, wallet!],
      });
      if (!already_claimed) return null;
      const logs = await read_event_history((fromBlock, toBlock) => public_client.getLogs({
        address: addresses.manager,
        event: claimed_event,
        args: { id, account: wallet as Address },
        fromBlock, toBlock,
      }));
      const log = logs[0];
      if (!log) throw new Error('Claimed event unavailable');
      return {
        principal_out: log.args.principal_out!,
        reward: log.args.reward!,
        completed: log.args.completed!,
      };
    },
  });

  // Unclaimed preview: stake, claimed flag, proof and preview_claim.
  const preview_q = useQuery<Preview | null>({
    queryKey: ['preview', id.toString(), wallet ?? null, phase],
    enabled: !!wallet && claimable_phase && receipt_q.isSuccess && receipt_q.data === null,
    queryFn: async () => {
      const acc = wallet!;
      const stake = (await public_client.readContract({
        address: addresses.manager,
        abi: abis.manager,
        functionName: 'stake_of',
        args: [id, acc],
      })) as bigint;
      if (stake === 0n) return null;
      // Only an expired challenge can return principal without consulting the completion record.
      const proof_body = phase === 'Expired' ? null : await oracle.get_proof(Number(id), acc);
      if (phase === 'Finalized' && (!proof_body || typeof proof_body.completed !== 'boolean' ||
        !Array.isArray(proof_body.proof) || !proof_body.proof.every(hash => /^0x[0-9a-f]{64}$/i.test(hash)) ||
        proof_body.stake !== stake.toString())) throw new Error('Invalid claim proof response');
      const completed = proof_body?.completed ?? false;
      const [principal_out, reward] = (await public_client.readContract({
        address: addresses.manager,
        abi: abis.manager,
        functionName: 'preview_claim',
        args: [id, acc, completed],
      })) as [bigint, bigint];
      return { principal_out, reward, completed, proof: (proof_body?.proof ?? []) as `0x${string}`[] };
    },
  });

  if (!wallet || !claimable_phase) return null;
  // Render nothing while loading. A loading line here stayed on screen after the panel's data resolved to "no claim".
  if (receipt_q.isLoading || preview_q.isLoading) return null;

  if (receipt_q.isError || preview_q.isError) return <section className="card flex flex-col gap-3 p-4">
    <h2 className="font-semibold">{t(lang, 'claim')}</h2>
    <p role="status">{t(lang, 'claim_data_failed')}</p>
    <button type="button" className="btn btn-ghost" disabled={receipt_q.isFetching || preview_q.isFetching}
      onClick={() => void (receipt_q.isError ? receipt_q.refetch() : preview_q.refetch())}>{t(lang, 'retry')}</button>
  </section>;
  const r = receipt_q.data;
  if (r) {
    return (
      <section className="card flex flex-col gap-3 p-4">
        <h2 className="font-semibold">{t(lang, 'claim')}</h2>
        <strong>{lang === 'vi' ? 'Đã nhận' : 'Claimed'}</strong>
        <PayoutLines lang={lang} principal={r.principal_out} reward={r.reward} />
        <Link href="/me" className="underline text-sm">
          {t(lang, 'badge_title')}
        </Link>
      </section>
    );
  }

  const p = preview_q.data;
  if (!p) return null;

  async function claim() {
    if (!p) return;
    const args = [id, p.completed, p.proof] as const;
    let gas: bigint | undefined;
    try {
      const est = await public_client.estimateContractGas({
        address: addresses.manager,
        abi: abis.manager,
        functionName: 'claim',
        args,
        account: wallet!,
      });
      gas = (est * GAS_MARGIN_PERCENT) / 100n;
    } catch {
      gas = undefined;
    }
    await run({ address: addresses.manager, abi: abis.manager, functionName: 'claim', args, gas });
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">{t(lang, 'claim')}</h2>
      <PayoutLines lang={lang} principal={p.principal_out} reward={p.reward} />
      <button
        type="button"
        className="btn"
        disabled={state.status === 'signing' || state.status === 'pending' || (p.principal_out === 0n && p.reward === 0n)}
        onClick={claim}
      >
        {t(lang, 'claim')}
      </button>
      <TxStatusLine state={state} lang={lang} />
    </section>
  );
}
