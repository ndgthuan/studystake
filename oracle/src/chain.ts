// Chain access: viem clients, StudyStakeManager reads and writes, Joined log scan.
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { manager_abi } from './abi/manager.ts';
import type { Config } from './config.ts';

export const STATUS = { None: 0, Open: 1, Settled: 2, Disputed: 3, Finalized: 4, Expired: 5 } as const;
export const SCAN_CHUNK_BLOCKS = 2000n;

export interface ChallengeRow {
  id: number;
  token: string;
  vault: string;
  creator: string;
  min_stake: bigint;
  max_stake: bigint;
  join_deadline: number;
  end_time: number;
  settle_grace: number;
  dispute_window: number;
  metadata_hash: `0x${string}`;
  status: number;
  total_principal: bigint;
  total_bonus: bigint;
  participant_count: number;
  root: `0x${string}`;
  evidence_hash: `0x${string}`;
  settled_at: number;
  disputed_at: number;
  completed_count: number;
  completed_stake: bigint;
  finalized_at: number;
  final_assets: bigint;
  reward_pot: bigint;
  reward_paid: bigint;
  loss: boolean;
  rewards_swept: boolean;
  treasury_due: bigint;
  treasury_collected: boolean;
}

export interface BadgeStats {
  streak: number;
  best_streak: number;
  total_completed: number;
  total_failed: number;
}

export interface SettleArgs {
  id: number;
  root: `0x${string}`;
  completed_count: number;
  completed_stake: bigint;
  evidence_hash: `0x${string}`;
}

/** Everything the settle job needs from the chain. Implemented by viem below, or by a stub in tests. */
export interface ChainPort {
  block_number(): Promise<bigint>;
  challenge_count(): Promise<number>;
  get_challenge(id: number): Promise<ChallengeRow>;
  scan_joins(from: bigint, to: bigint): Promise<{ id: number; account: string }[]>;
  joined_at(id: number, account: string): Promise<number>;
  stake_of(id: number, account: string): Promise<bigint>;
  /** Simulates settle, then sends it and waits for the receipt. Returns 'already_settled' on WrongStatus. */
  settle(args: SettleArgs): Promise<{ outcome: 'settled' | 'already_settled'; tx_hash: string | null }>;
  finalize(id: number): Promise<string>;
  expire(id: number): Promise<string>;
  collect_treasury(id: number): Promise<string>;
  has_creator_role(address: string): Promise<boolean>;
  /** Study record from StudyBadge. All zero when the account has no badge. */
  badge_stats(account: string): Promise<BadgeStats>;
  creator_role(): Promise<`0x${string}`>;
  oracle_address(): string;
}

const badge_abi = parseAbi([
  'function badge_of(address account) view returns (uint256)',
  'function stats_of(uint256 token_id) view returns (uint32 streak, uint32 best_streak, uint32 total_completed, uint32 total_failed, uint64 last_update)',
]);

const joined_event = parseAbiItem(
  'event Joined(uint256 indexed id, address indexed account, uint128 amount, uint256 shares, uint64 joined_time)',
);

export function build_chain(chain: Chain, cfg: Config, transport?: ReturnType<typeof http>): {
  port: ChainPort;
  public_client: PublicClient;
} {
  const rpc = transport ?? http(cfg.rpc_url);
  const public_client = createPublicClient({ chain, transport: rpc });
  const account = privateKeyToAccount(cfg.oracle_private_key);
  const wallet: WalletClient = createWalletClient({ chain, transport: rpc, account });
  const manager = cfg.manager;

  const port: ChainPort = {
    async block_number() {
      return public_client.getBlockNumber();
    },
    async challenge_count() {
      const n = await public_client.readContract({ address: manager, abi: manager_abi, functionName: 'challenge_count' });
      return Number(n);
    },
    async get_challenge(id) {
      const raw = await public_client.readContract({
        address: manager,
        abi: manager_abi,
        functionName: 'get_challenge',
        args: [BigInt(id)],
      });
      return normalize_challenge(id, raw as unknown as Record<string, unknown>);
    },
    async scan_joins(from, to) {
      const logs = await public_client.getLogs({
        address: manager,
        event: joined_event,
        fromBlock: from,
        toBlock: to,
      });
      return logs.map((l) => ({ id: Number(l.args.id), account: String(l.args.account).toLowerCase() }));
    },
    async joined_at(id, account) {
      const v = await public_client.readContract({
        address: manager,
        abi: manager_abi,
        functionName: 'joined_at',
        args: [BigInt(id), account as `0x${string}`],
      });
      return Number(v);
    },
    async stake_of(id, account) {
      return public_client.readContract({
        address: manager,
        abi: manager_abi,
        functionName: 'stake_of',
        args: [BigInt(id), account as `0x${string}`],
      });
    },
    async settle(args) {
      const call = {
        address: manager,
        abi: manager_abi,
        functionName: 'settle' as const,
        args: [BigInt(args.id), args.root, args.completed_count, args.completed_stake, args.evidence_hash] as const,
        account,
      };
      try {
        await public_client.simulateContract(call);
      } catch (err) {
        if (is_revert_named(err, 'WrongStatus')) return { outcome: 'already_settled', tx_hash: null };
        throw err;
      }
      const hash = await wallet.writeContract({ ...call, chain });
      const receipt = await public_client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`settle tx reverted: ${hash}`);
      return { outcome: 'settled', tx_hash: hash };
    },
    async finalize(id) {
      return send_simple('finalize', id);
    },
    async expire(id) {
      return send_simple('expire', id);
    },
    async collect_treasury(id) {
      return send_simple('collect_treasury', id);
    },
    async has_creator_role(address) {
      const role = await public_client.readContract({ address: manager, abi: manager_abi, functionName: 'CREATOR_ROLE' });
      return public_client.readContract({
        address: manager,
        abi: manager_abi,
        functionName: 'hasRole',
        args: [role, address as `0x${string}`],
      });
    },
    async badge_stats(account) {
      const badge = await public_client.readContract({ address: manager, abi: manager_abi, functionName: 'badge' });
      const token_id = await public_client.readContract({ address: badge, abi: badge_abi, functionName: 'badge_of', args: [account as `0x${string}`] });
      if (token_id === 0n) return { streak: 0, best_streak: 0, total_completed: 0, total_failed: 0 };
      const [streak, best_streak, total_completed, total_failed] = await public_client.readContract({
        address: badge,
        abi: badge_abi,
        functionName: 'stats_of',
        args: [token_id],
      });
      return { streak, best_streak, total_completed, total_failed };
    },
    async creator_role() {
      return public_client.readContract({ address: manager, abi: manager_abi, functionName: 'CREATOR_ROLE' });
    },
    oracle_address() {
      return account.address;
    },
  };

  async function send_simple(functionName: 'finalize' | 'expire' | 'collect_treasury', id: number): Promise<string> {
    const call = { address: manager, abi: manager_abi, functionName, args: [BigInt(id)] as const, account };
    await public_client.simulateContract(call);
    const hash = await wallet.writeContract({ ...call, chain });
    const receipt = await public_client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${functionName} tx reverted: ${hash}`);
    return hash;
  }

  return { port, public_client };
}

export function normalize_challenge(id: number, raw: Record<string, unknown>): ChallengeRow {
  const n = (k: string) => Number(raw[k]);
  const b = (k: string) => BigInt(raw[k] as bigint | number | string);
  return {
    id,
    token: String(raw.token),
    vault: String(raw.vault),
    creator: String(raw.creator),
    min_stake: b('min_stake'),
    max_stake: b('max_stake'),
    join_deadline: n('join_deadline'),
    end_time: n('end_time'),
    settle_grace: n('settle_grace'),
    dispute_window: n('dispute_window'),
    metadata_hash: raw.metadata_hash as `0x${string}`,
    status: n('status'),
    total_principal: b('total_principal'),
    total_bonus: b('total_bonus'),
    participant_count: n('participant_count'),
    root: raw.root as `0x${string}`,
    evidence_hash: raw.evidence_hash as `0x${string}`,
    settled_at: n('settled_at'),
    disputed_at: n('disputed_at'),
    completed_count: n('completed_count'),
    completed_stake: b('completed_stake'),
    finalized_at: n('finalized_at'),
    final_assets: b('final_assets'),
    reward_pot: b('reward_pot'),
    reward_paid: b('reward_paid'),
    loss: Boolean(raw.loss),
    rewards_swept: Boolean(raw.rewards_swept),
    treasury_due: b('treasury_due'),
    treasury_collected: Boolean(raw.treasury_collected),
  };
}

/** True when a viem error chain contains the given custom error name. */
export function is_revert_named(err: unknown, name: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur; depth++) {
    const e = cur as { name?: string; message?: string; cause?: unknown; data?: { errorName?: string } };
    if (e.data?.errorName === name) return true;
    if (typeof e.message === 'string' && e.message.includes(name)) return true;
    cur = e.cause;
  }
  return false;
}

/** Chain object for viem. Chain id comes from config so the same code runs on Anvil (31337) and Fuji (43113). */
export function chain_for(cfg: Pick<Config, 'chain_id' | 'rpc_url'>): Chain {
  return {
    id: cfg.chain_id,
    name: `chain-${cfg.chain_id}`,
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpc_url] } },
  };
}
