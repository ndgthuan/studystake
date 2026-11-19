// Contract addresses (from the synced deployments file) and typed read helpers.
import { createPublicClient, http, type Address } from 'viem';
import deployments from '@/generated/deployments.json';
import { manager_abi, badge_abi, vault_abi, token_abi } from '@/generated/abi';
import { active_chain, DEPLOY_FROM_BLOCK, RPC_URL } from './config';

export const addresses = {
  manager: deployments.manager as Address,
  badge: deployments.badge as Address,
  tusdc: deployments.tusdc as Address,
  tusdc_vault: deployments.tusdc_vault as Address,
  circle_usdc: deployments.circle_usdc as Address,
  circle_usdc_vault: deployments.circle_usdc_vault as Address,
  treasury: deployments.treasury as Address,
  oracle: deployments.oracle as Address,
};

export const abis = { manager: manager_abi, badge: badge_abi, vault: vault_abi, token: token_abi };

export const public_client = createPublicClient({ chain: active_chain, transport: http(RPC_URL) });

export const STATUS_NAMES = ['None', 'Open', 'Settled', 'Disputed', 'Finalized', 'Expired'] as const;
export const PHASE_NAMES = [
  'Joining',
  'Running',
  'AwaitingSettle',
  'DisputeWindow',
  'Disputed',
  'Finalized',
  'Expired',
  'Expirable',
  'Finalizable',
] as const;

export type PhaseName = (typeof PHASE_NAMES)[number];

/** Raw challenge struct as returned by get_challenge (viem decodes tuple fields by name). */
export interface ChallengeView {
  token: Address;
  vault: Address;
  creator: Address;
  min_stake: bigint;
  max_stake: bigint;
  join_deadline: bigint;
  end_time: bigint;
  settle_grace: bigint;
  dispute_window: bigint;
  metadata_hash: `0x${string}`;
  status: number;
  total_principal: bigint;
  total_bonus: bigint;
  total_shares: bigint;
  participant_count: number;
  root: `0x${string}`;
  evidence_hash: `0x${string}`;
  settled_at: bigint;
  disputed_at: bigint;
  completed_count: number;
  completed_stake: bigint;
  finalized_at: bigint;
  final_assets: bigint;
  reward_pot: bigint;
  reward_paid: bigint;
  principal_paid: bigint;
  loss: boolean;
  rewards_swept: boolean;
  treasury_due: bigint;
  treasury_collected: boolean;
}

/** Converts the viem challenge tuple to a typed view. Works for both named and positional returns. */
export function to_challenge(raw: unknown): ChallengeView {
  return raw as ChallengeView;
}

/** Returns the phase name for a challenge id, read on chain. */
export async function read_phase(id: bigint): Promise<PhaseName> {
  const idx = await public_client.readContract({
    address: addresses.manager,
    abi: abis.manager,
    functionName: 'phase_of',
    args: [id],
  });
  return PHASE_NAMES[Number(idx)] ?? 'Joining';
}

/** The public Fuji RPC accepts at most 50,000 blocks per log query. Keep each scan on one fixed tip. */
export async function read_event_history<T>(
  read_range: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  const tip = await public_client.getBlockNumber();
  const page_size = 50_000n;
  const history: T[] = [];
  for (let start = DEPLOY_FROM_BLOCK; start <= tip; start += page_size) {
    const end = start + page_size - 1n;
    const page = await read_range(start, end < tip ? end : tip);
    history.push(...page);
  }
  return history;
}
