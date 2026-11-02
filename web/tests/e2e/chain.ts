// Chain and oracle helpers for E2E. Anvil's default accounts are unlocked, so every transaction and signature is
// sent through RPC with `from` set. No private keys are used in the tests.
import { createPublicClient, encodeFunctionData, getAddress, http, stringToHex, type Abi, type Address, type Hex } from 'viem';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manager_abi, token_abi, vault_abi, badge_abi } from '../../src/generated/abi';
import { canonical_json } from '../../src/lib/canonical';
import { link_message } from '../../src/lib/messages';

export const RPC = 'http://127.0.0.1:8545';
export const ORACLE = 'http://127.0.0.1:8788';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

export const ADDRS = JSON.parse(readFileSync(join(repo, 'contracts', 'deployments', '31337.json'), 'utf8')) as {
  manager: Address;
  tusdc: Address;
  tusdc_vault: Address;
  badge: Address;
  oracle: Address;
  treasury: Address;
};

export const chain = { id: 31337, name: 'Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
export const public_client = createPublicClient({ chain, transport: http(RPC) });

export async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/**
 * Named test accounts, taken from Anvil's unlocked default list. Index 0 is the deployer (admin/creator, also
 * the faucet owner). Index 1 is the oracle and 2 is treasury, so participants use 4, 5 and 6, and 7 sponsors.
 */
export async function load_accounts(): Promise<Record<'deployer' | 'a1' | 'a2' | 'a3' | 'sponsor', Address>> {
  const list = (await rpc('eth_accounts')) as string[];
  const pick = (i: number): Address => getAddress(list[i]!);
  return { deployer: pick(0), a1: pick(4), a2: pick(5), a3: pick(6), sponsor: pick(7) };
}

/** Sends a transaction from an unlocked account and waits for a successful receipt. */
export async function send(from: Address, to: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName, args });
  const hash = (await rpc('eth_sendTransaction', [{ from, to, data }])) as Hex;
  const receipt = await public_client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

export async function block_time(): Promise<number> {
  // Anvil mines on demand, so mine first to read a current timestamp.
  await rpc('evm_mine');
  const b = await public_client.getBlock();
  return Number(b.timestamp);
}

export async function set_time(target: number): Promise<void> {
  const now = await block_time();
  if (target > now) await rpc('evm_increaseTime', [target - now]);
  await rpc('evm_mine');
}

export async function token_balance(account: Address): Promise<bigint> {
  return (await public_client.readContract({ address: ADDRS.tusdc, abi: token_abi, functionName: 'balanceOf', args: [account] })) as bigint;
}

export async function badge_balance(account: Address): Promise<bigint> {
  return (await public_client.readContract({ address: ADDRS.badge, abi: badge_abi, functionName: 'balanceOf', args: [account] })) as bigint;
}

export async function is_claimed(id: bigint, account: Address): Promise<boolean> {
  return (await public_client.readContract({ address: ADDRS.manager, abi: manager_abi, functionName: 'claimed', args: [id, account] })) as boolean;
}

export async function preview_claim(id: bigint, account: Address, completed: boolean): Promise<{ principal_out: bigint; reward: bigint }> {
  const [principal_out, reward] = (await public_client.readContract({
    address: ADDRS.manager,
    abi: manager_abi,
    functionName: 'preview_claim',
    args: [id, account, completed],
  })) as [bigint, bigint];
  return { principal_out, reward };
}

export async function get_challenge(id: bigint) {
  return public_client.readContract({ address: ADDRS.manager, abi: manager_abi, functionName: 'get_challenge', args: [id] }) as Promise<{
    status: number;
    settled_at: bigint;
    dispute_window: bigint;
    completed_count: number;
    completed_stake: bigint;
    reward_pot: bigint;
    total_principal: bigint;
    total_bonus: bigint;
    final_assets: bigint;
    loss: boolean;
    participant_count: number;
  }>;
}

/** Polls until the predicate is true or the timeout passes. Asserts on chain state, not on UI text. */
export async function wait_until(label: string, predicate: () => Promise<boolean>, timeout_ms = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout_ms) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for on-chain condition: ${label}`);
}

/** Mints tUSDC to an account from the deployer (token owner). */
export async function mint_tusdc(accounts: Awaited<ReturnType<typeof load_accounts>>, to: Address, amount: bigint): Promise<void> {
  await send(accounts.deployer, ADDRS.tusdc, token_abi, 'mint', [to, amount]);
}

/** Deployer funds yield on the tUSDC vault (drip over `duration` seconds). Call after joins so shares are priced first. */
export async function fund_yield(accounts: Awaited<ReturnType<typeof load_accounts>>, amount: bigint, duration: bigint): Promise<void> {
  // The deployer starts with no tUSDC, so mint exactly the yield amount before funding it.
  await send(accounts.deployer, ADDRS.tusdc, token_abi, 'mint', [accounts.deployer, amount]);
  await send(accounts.deployer, ADDRS.tusdc, token_abi, 'approve', [ADDRS.tusdc_vault, amount]);
  await send(accounts.deployer, ADDRS.tusdc_vault, vault_abi, 'fund_yield', [amount, duration]);
}

/** A sponsor adds to the bonus pool. The sponsor must approve the manager first. */
export async function sponsor(from: Address, id: bigint, amount: bigint): Promise<void> {
  await send(from, ADDRS.tusdc, token_abi, 'approve', [ADDRS.manager, amount]);
  await send(from, ADDRS.manager, manager_abi, 'sponsor', [id, amount]);
}

/** Creates a demo challenge: stores the metadata in the oracle, then calls create_challenge from the deployer. */
export async function create_demo_challenge(
  accounts: Awaited<ReturnType<typeof load_accounts>>,
  meta: unknown,
  times: { join_deadline: number; end_time: number },
): Promise<bigint> {
  const { keccak256, toBytes } = await import('viem');
  const canonical = canonical_json(meta);
  const hash = keccak256(toBytes(canonical));
  const posted = await fetch(`${ORACLE}/__test/put_metadata`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash, canonical }),
  });
  if (!posted.ok) throw new Error(`put_metadata failed: ${posted.status}`);
  await send(accounts.deployer, ADDRS.manager, manager_abi, 'create_challenge', [
    ADDRS.tusdc,
    ADDRS.tusdc_vault,
    1_000_000n,
    500_000_000n,
    BigInt(times.join_deadline),
    BigInt(times.end_time),
    600n,
    300n,
    hash,
    `${ORACLE}/metadata/${hash}`,
  ]);
  return (await public_client.readContract({ address: ADDRS.manager, abi: manager_abi, functionName: 'challenge_count' })) as bigint;
}

/**
 * Links an account to the Demo LMS through the oracle's POST /link. The signature comes from Anvil's unlocked
 * account (personal_sign), so it is the same signature a wallet would produce for this message.
 */
export async function link_demo(account: Address): Promise<void> {
  const issued_at = Math.floor(Date.now() / 1000);
  const message = link_message(account, 'demo', 'demo', issued_at);
  const signature = (await rpc('personal_sign', [stringToHex(message), account])) as Hex;
  const res = await fetch(`${ORACLE}/link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: account, lms: 'demo', site: 'demo', signature, issued_at }),
  });
  if (!res.ok) throw new Error(`link_demo failed for ${account}: ${res.status} ${await res.text()}`);
}

/** Triggers the oracle's scheduled settle job through the dev server. */
export async function run_oracle_cron(): Promise<void> {
  const res = await fetch(`${ORACLE}/__test/run_cron`, { method: 'POST' });
  if (!res.ok) throw new Error(`run_cron failed: ${res.status}`);
}

export const chain_helpers = () => ({
  accounts: load_accounts,
  block_time,
  create_demo_challenge,
  mint_tusdc,
  fund_yield,
  sponsor,
  get_challenge,
  is_claimed,
  preview_claim,
  token_balance,
  badge_balance,
  link_demo,
  run_oracle_cron,
  wait_until,
});
