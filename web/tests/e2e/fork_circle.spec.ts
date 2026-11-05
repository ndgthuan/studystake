// Runs on a Fuji fork with real Circle USDC (`npm run e2e:fork:run`). Plain Anvil has no Circle USDC, so this skips there.
// Guards two things plain Anvil cannot show. Join must use the token's own permit domain (version "2"). And the web must
// read through its configured RPC: on public Fuji this contract has no code, so a simulation passes silently, the wallet
// still lands the transaction on the fork, and the UI waits forever for a receipt. Only the "Done" check catches that.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi, toBytes, type Address, type Hex } from 'viem';
import { manager_abi } from '../../src/generated/abi';
import { canonical_json } from '../../src/lib/canonical';
import { install_injected_wallet } from './injected_provider';

const RPC = 'http://127.0.0.1:8545';
const ORACLE = 'http://127.0.0.1:8788';
const FACILITATOR = 'http://127.0.0.1:4022';
const CIRCLE_USDC: Address = '0x5425890298aed601595a70AB815c96711a31Bc65';
const STAKE = 10_000_000n;
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)']);

test.skip(process.env.E2E_MODE !== 'fork', 'needs the Fuji fork stack: npm run e2e:fork:run');

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

test('Circle USDC: a fork user joins through the UI in one permit transaction', async ({ browser }) => {
  const deployments = JSON.parse(readFileSync(process.env.E2E_DEPLOYMENTS!, 'utf8')) as { manager: Address; circle_usdc: Address; circle_usdc_vault: Address };
  expect(deployments.circle_usdc).toBe(CIRCLE_USDC);
  const client = createPublicClient({ transport: http(RPC) });
  const accounts = (await rpc('eth_accounts')) as Address[];
  const deployer = accounts[0]!;
  const user = accounts[4]!;

  const supported = (await (await fetch(`${FACILITATOR}/supported`)).json()) as { kinds: { x402Version: number; scheme: string; network: string }[] };
  expect(supported.kinds).toContainEqual(expect.objectContaining({ x402Version: 2, scheme: 'exact', network: 'eip155:43113' }));

  const now = Number((await client.getBlock()).timestamp);
  const end_time = now + 3600;
  const meta = {
    version: 1,
    title: 'Fork Circle USDC challenge',
    lms: 'demo',
    site: 'demo',
    course_id: 1,
    activities: [{ kind: 'quiz', instance_id: 1, name: 'Quiz 1', due: end_time }],
    min_grade: null,
  };
  const canonical = canonical_json(meta);
  const hash = keccak256(toBytes(canonical));
  const posted = await fetch(`${ORACLE}/__test/put_metadata`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash, canonical }) });
  expect(posted.ok).toBe(true);
  const create_args = [CIRCLE_USDC, deployments.circle_usdc_vault, 1_000_000n, 100_000_000n, BigInt(now + 1800), BigInt(end_time), 600n, 300n, hash, `${ORACLE}/metadata/${hash}`] as const;
  const create_hash = (await rpc('eth_sendTransaction', [{ from: deployer, to: deployments.manager, data: encodeFunctionData({ abi: manager_abi, functionName: 'create_challenge', args: create_args }) }])) as Hex;
  expect((await client.waitForTransactionReceipt({ hash: create_hash })).status).toBe('success');
  const id = (await client.readContract({ address: deployments.manager, abi: manager_abi, functionName: 'challenge_count' })) as bigint;

  const balance_before = await client.readContract({ address: CIRCLE_USDC, abi: erc20, functionName: 'balanceOf', args: [user] });
  const nonce_before = await client.getTransactionCount({ address: user });

  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const page = await ctx.newPage();
  await install_injected_wallet(page, RPC, { address: user });
  await page.goto(`/challenges/${id}`);
  await page.getByLabel(/Số tiền cọc|Stake amount/).fill('10');
  await page.getByRole('button', { name: /^(Tham gia|Join)$/ }).click();

  await expect
    .poll(() => client.readContract({ address: deployments.manager, abi: manager_abi, functionName: 'stake_of', args: [id, user] }), { timeout: 60_000 })
    .toBe(STAKE);
  await expect(page.getByRole('status').filter({ hasText: /^(Hoàn tất|Done)/ })).toBeVisible({ timeout: 30_000 });
  await ctx.close();

  const balance_after = await client.readContract({ address: CIRCLE_USDC, abi: erc20, functionName: 'balanceOf', args: [user] });
  expect(balance_before - balance_after).toBe(STAKE);
  // One transaction and no leftover allowance: the permit path ran, not approve + join.
  expect((await client.getTransactionCount({ address: user })) - nonce_before).toBe(1);
  expect(await client.readContract({ address: CIRCLE_USDC, abi: erc20, functionName: 'allowance', args: [user, deployments.manager] })).toBe(0n);
});
