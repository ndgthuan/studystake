// Real x402 payment against a running Fuji fork stack: real Circle USDC, a real facilitator and the real @x402 client,
// through the oracle's paid route. Every check reads balances on chain, so a refusal that moved money still fails.
// Usage: npm run e2e:fork:api (in web/), then npm run x402:check (here). `npm run e2e:fork:run` also runs it.
// Refuses anything but a local fork. Uses throwaway keys and Anvil's public keys, funded by e2e_setup on the fork only.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { createPublicClient, http, parseAbi, parseEventLogs, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { credential_typed_data } from '../src/credential.ts';
import { consent_message, link_message } from '../src/link.ts';

const RPC = 'http://127.0.0.1:8545';
const ORACLE = 'http://127.0.0.1:8788';
const USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';
const NETWORK = 'eip155:43113';
const PRICE = 5000n;
// Anvil's public key #4. e2e_setup mints fork-only USDC to it.
const FUNDED_BUYER_KEY = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a';

const here = dirname(fileURLToPath(import.meta.url));
const deployments = JSON.parse(readFileSync(resolve(here, '..', '..', 'contracts', 'deployments', 'fork-43113.json'), 'utf8'));
const client = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
const erc20_abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);
const manager_abi = parseAbi(['function ORACLE_ROLE() view returns (bytes32)', 'function hasRole(bytes32, address) view returns (bool)']);
const balance = (account) => client.readContract({ address: USDC, abi: erc20_abi, functionName: 'balanceOf', args: [account] });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** Stack traces would bury the reason, and these keys must never reach a real network. */
async function assert_local_fork() {
  const block = await client.getBlockNumber().catch(() => null);
  if (block === null) throw new Error(`no chain at ${RPC}. Start the stack first: cd web && npm run e2e:fork:api`);
  const code = await client.getCode({ address: USDC });
  if (!code) throw new Error('Circle USDC is not on this chain, so this is not a Fuji fork');
  const health = await fetch(`${ORACLE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`no oracle at ${ORACLE}`);
}

function make_buyer(key, wrapped_fetch = fetch) {
  const account = privateKeyToAccount(key);
  const payments = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
    spendControls: { allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: '10000' }] },
  });
  return { account, pay: wrapFetchWithPayment(wrapped_fetch, payments) };
}

/** A dishonest client: it believes the seller asked for something else, so it signs for that. */
function lying_fetch(change) {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (res.status !== 402) return res;
    const required = decodePaymentRequiredHeader(res.headers.get('payment-required'));
    Object.assign(required.accepts[0], change);
    const headers = new Headers(res.headers);
    headers.set('payment-required', encodePaymentRequiredHeader(required));
    return new Response(null, { status: 402, headers });
  };
}

const refusal = (res) => {
  const header = res.headers.get('payment-required');
  return header ? decodePaymentRequiredHeader(header).error : '(no header)';
};
const error_code = async (res) => (await res.json()).error?.code;
const send = (path, method, body) => fetch(`${ORACLE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const read_stats = async () => (await fetch(`${ORACLE}/x402/stats`)).json();

async function main() {
  await assert_local_fork();
  for (const endpoint of ['/verify', '/settle']) {
    const res = await fetch(`http://127.0.0.1:4022${endpoint}`, { method: 'POST' });
    check(`the hosted facilitator protects ${endpoint}`, res.status === 401, `status ${res.status}`);
  }
  const student = privateKeyToAccount(generatePrivateKey());
  const route = `${ORACLE}/x402/credential/${student.address}`;
  const stats_before = await read_stats();

  let res = await fetch(route);
  check('an unlinked wallet is refused before any payment', res.status === 404 && (await error_code(res)) === 'not_linked', `status ${res.status}`);

  const issued_at = Math.floor(Date.now() / 1000);
  const link_signature = await student.signMessage({ message: link_message(student.address, 'demo', 'demo', issued_at) });
  res = await send('/link', 'POST', { wallet: student.address, lms: 'demo', site: 'demo', issued_at, signature: link_signature });
  check('the student links the Demo LMS', res.status === 200, `status ${res.status}`);

  res = await fetch(route);
  check('without consent it is refused before any payment', res.status === 403 && (await error_code(res)) === 'credential_not_shared', `status ${res.status}`);

  const consent_signature = await student.signMessage({ message: consent_message(student.address, true, issued_at) });
  res = await send('/x402/credential/consent', 'POST', { wallet: student.address, share: true, issued_at, signature: consent_signature });
  check('the student opts in', res.status === 200, `status ${res.status}`);

  res = await fetch(route);
  const asked = decodePaymentRequiredHeader(res.headers.get('payment-required')).accepts[0];
  check('an unpaid request gets 402 for 0.005 USDC to the on-chain treasury', res.status === 402 && asked.amount === String(PRICE) && asked.payTo === deployments.treasury && asked.asset === USDC);

  let captured_signature = null;
  const capture = (input, init) => {
    const signature = new Headers(init?.headers ?? input?.headers).get('payment-signature');
    if (signature) captured_signature = signature;
    return fetch(input, init);
  };
  const buyer = make_buyer(FUNDED_BUYER_KEY, capture);
  const before = { buyer: await balance(buyer.account.address), treasury: await balance(deployments.treasury) };
  res = await buyer.pay(route);
  const body = await res.json();
  const after = { buyer: await balance(buyer.account.address), treasury: await balance(deployments.treasury) };
  check('a paid request returns 200', res.status === 200, `status ${res.status}`);
  check('the buyer paid exactly 0.005 USDC', before.buyer - after.buyer === PRICE, `${before.buyer - after.buyer}`);
  check('the treasury received exactly 0.005 USDC', after.treasury - before.treasury === PRICE, `${after.treasury - before.treasury}`);
  check('PAYMENT-RESPONSE and the body name the same transaction', decodePaymentResponseHeader(res.headers.get('payment-response')).transaction === body.transaction);

  const receipt = await client.getTransactionReceipt({ hash: body.transaction });
  const transfers = parseEventLogs({ abi: erc20_abi, logs: receipt.logs, eventName: 'Transfer' }).filter((l) => l.address.toLowerCase() === USDC.toLowerCase());
  check('the transaction is one USDC transfer to the treasury', receipt.status === 'success' && transfers.length === 1 && transfers[0].args.to === deployments.treasury && transfers[0].args.value === PRICE);

  // Verify the way a buyer would, from the response and the chain alone.
  const typed = credential_typed_data(body.credential, body.domain.chain_id, body.domain.verifying_contract);
  const signer = await recoverTypedDataAddress({ ...typed, signature: body.signature });
  const role = await client.readContract({ address: deployments.manager, abi: manager_abi, functionName: 'ORACLE_ROLE' });
  check('the credential recovers to an address holding ORACLE_ROLE on chain', await client.readContract({ address: deployments.manager, abi: manager_abi, functionName: 'hasRole', args: [role, signer] }));
  check('the credential is for this wallet, says demo and lasts 7 days', body.credential.wallet === student.address && body.credential.lms === 'demo' && body.credential.expires_at - body.credential.issued_at === 604800);

  // Attacks. Each must leave every balance untouched.
  async function expect_refused(name, attempt, extra_account = null) {
    const start = { buyer: await balance(buyer.account.address), treasury: await balance(deployments.treasury), extra: extra_account ? await balance(extra_account) : 0n };
    const attack = await attempt();
    const moved = (await balance(buyer.account.address)) !== start.buyer || (await balance(deployments.treasury)) !== start.treasury || (extra_account !== null && (await balance(extra_account)) !== start.extra);
    check(name, attack.status === 402 && !moved, `status ${attack.status}, ${refusal(attack)}`);
  }
  await expect_refused('a replayed signature gets nothing and moves nothing', () => fetch(route, { headers: { 'payment-signature': captured_signature } }));
  await expect_refused('signing a lower amount gets nothing and moves nothing', () => make_buyer(FUNDED_BUYER_KEY, lying_fetch({ amount: '1' })).pay(route));
  const attacker = privateKeyToAccount(generatePrivateKey()).address;
  await expect_refused('paying someone else gets nothing and moves nothing', () => make_buyer(FUNDED_BUYER_KEY, lying_fetch({ payTo: attacker })).pay(route), attacker);
  await expect_refused('a buyer with no USDC gets nothing', () => make_buyer(generatePrivateKey()).pay(route));
  await expect_refused('a garbage header gets nothing', () => fetch(route, { headers: { 'payment-signature': 'not-base64!!!' } }));

  const stats_after = await read_stats();
  check('stats count only the one settlement', stats_after.settled_count - stats_before.settled_count === 1 && BigInt(stats_after.settled_amount) - BigInt(stats_before.settled_amount) === PRICE && stats_after.pay_to === deployments.treasury);

  const opt_out_at = issued_at + 1;
  const opt_out = await student.signMessage({ message: consent_message(student.address, false, opt_out_at) });
  res = await send('/x402/credential/consent', 'POST', { wallet: student.address, share: false, issued_at: opt_out_at, signature: opt_out });
  res = await fetch(route);
  check('after opting out the credential is no longer for sale', res.status === 403, `status ${res.status}`);

  console.log(failures === 0 ? 'x402 check passed' : `x402 check FAILED: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`x402 check could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
