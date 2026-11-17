// Buys three Study Credentials for a single demo. The buyer key is read from the environment.
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createPublicClient, getAddress, http, isAddress, isAddressEqual, parseAbi, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import fuji_deployment from '../../contracts/deployments/43113.json' with { type: 'json' };
import { credential_typed_data } from '../src/credential.ts';
import { consent_message, link_message } from '../src/link.ts';

const NETWORK = 'eip155:43113';
const ASSET = '0x5425890298aed601595a70AB815c96711a31Bc65';
const PRICE = '5000';
const MANAGER_ABI = parseAbi([
  'function treasury() view returns (address)',
  'function ORACLE_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
]);
const TOKEN_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

const loopback = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

function endpoint(value) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url))) || url.username || url.password) {
    throw new Error('Use an HTTPS endpoint or HTTP on loopback.');
  }
  return url;
}

async function seed_demo_students(oracle) {
  const students = [];
  async function post(path, payload) {
    const response = await fetch(new URL(path, oracle), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error',
    });
    if (!response.ok) throw new Error(`${path} failed (HTTP ${response.status}).`);
  }
  for (let i = 0; i < 3; i += 1) {
    const student = privateKeyToAccount(generatePrivateKey());
    const wallet = student.address;
    const issued_at = Math.floor(Date.now() / 1000);
    const lms = 'demo';
    const site = 'demo';
    const signature = await student.signMessage({ message: link_message(wallet, lms, site, issued_at) });
    await post('/link', { wallet, lms, site, issued_at, signature });
    const consent = await student.signMessage({ message: consent_message(wallet, true, issued_at) });
    await post('/x402/credential/consent', { wallet, share: true, issued_at, signature: consent });
    students.push(wallet);
  }
  return students;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run x402:buyer -- <wallet-1> <wallet-2> <wallet-3>');
    console.log('       npm run x402:buyer -- --demo   (creates three consenting students on a local Fuji fork)');
    console.log('Set X402_BUYER_PRIVATE_KEY, X402_ORACLE_URL (default http://127.0.0.1:8788), and X402_RPC_URL (default http://127.0.0.1:8545).');
    return;
  }
  const demo = args.length === 1 && args[0] === '--demo';
  if (!demo && (args.length !== 3 || !args.every((arg) => isAddress(arg)) || new Set(args.map((wallet) => getAddress(wallet))).size !== 3)) {
    throw new Error('Supply three distinct consenting wallets, or run with --demo on a local fork. See --help.');
  }
  const key = process.env.X402_BUYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set X402_BUYER_PRIVATE_KEY to a funded buyer key.');
  let buyer;
  try {
    buyer = privateKeyToAccount(key);
  } catch {
    throw new Error('X402_BUYER_PRIVATE_KEY is not a valid signing key.');
  }

  const oracle = endpoint(process.env.X402_ORACLE_URL ?? 'http://127.0.0.1:8788');
  const rpc = endpoint(process.env.X402_RPC_URL ?? 'http://127.0.0.1:8545');
  const chain = createPublicClient({ chain: avalancheFuji, transport: http(rpc.href) });
  if (demo && (!loopback(oracle) || !loopback(rpc) || !/^anvil\//i.test(await chain.request({ method: 'web3_clientVersion' })))) {
    throw new Error('--demo requires the local Anvil Fuji fork and a local oracle.');
  }

  const fetch_oracle = (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  const health = await fetch_oracle(new URL('/health', oracle));
  if (!health.ok) throw new Error(`Oracle health failed (HTTP ${health.status}).`);
  const { chain_id, manager } = await health.json();
  if (chain_id !== avalancheFuji.id || await chain.getChainId() !== chain_id || !isAddress(manager)) {
    throw new Error('Oracle and RPC must be on Avalanche Fuji.');
  }
  if (!loopback(oracle) && !isAddressEqual(manager, fuji_deployment.manager)) {
    throw new Error('The remote oracle uses a manager that does not match the StudyStake Fuji deployment.');
  }
  const read_manager = (functionName, args) => chain.readContract({ address: manager, abi: MANAGER_ABI, functionName, args });
  const [treasury, oracle_role, balance] = await Promise.all([
    read_manager('treasury'),
    read_manager('ORACLE_ROLE'),
    chain.readContract({ address: ASSET, abi: TOKEN_ABI, functionName: 'balanceOf', args: [buyer.address] }),
  ]);
  if (balance < BigInt(PRICE) * 3n) throw new Error('The buyer needs at least 0.015 Circle USDC on Fuji.');

  const wallets = demo ? await seed_demo_students(oracle) : args.map((wallet) => getAddress(wallet));
  const allowed = (offer) => offer.network === NETWORK && offer.scheme === 'exact' && offer.amount === PRICE &&
    isAddress(offer.asset) && isAddressEqual(offer.asset, ASSET) && isAddress(offer.payTo) && isAddressEqual(offer.payTo, treasury);
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(buyer) }],
    spendControls: { allowedAssets: [{ network: NETWORK, asset: ASSET, maxAmountPerPayment: PRICE }] },
  }).registerPolicy((version, offers) => version === 2 ? offers.filter(allowed) : []);
  const pay = wrapFetchWithPayment(fetch_oracle, client);
  const routes = wallets.map((wallet) => new URL(`/x402/credential/${wallet}`, oracle));

  // Confirm all three can be purchased before authorizing the first transfer. The policy rechecks the actual paid quote.
  for (const route of routes) {
    const response = await fetch_oracle(route);
    const header = response.headers.get('payment-required');
    if (response.status !== 402 || !header || !decodePaymentRequiredHeader(header).accepts.some(allowed)) {
      throw new Error(`${route.pathname} has no matching 0.005 USDC quote (HTTP ${response.status}). No payment was sent.`);
    }
  }

  for (const [index, route] of routes.entries()) {
    try {
      const response = await pay(route);
      if (!response.ok) throw new Error(`purchase returned HTTP ${response.status}`);
      const body = await response.json();
      const settlement = decodePaymentResponseHeader(response.headers.get('payment-response'));
      if (!settlement.success || settlement.network !== NETWORK || settlement.transaction !== body.transaction ||
          !/^0x[0-9a-fA-F]{64}$/.test(body.transaction) || !isAddressEqual(body.credential.wallet, wallets[index]) ||
          body.domain.chain_id !== chain_id || !isAddressEqual(body.domain.verifying_contract, manager)) {
        throw new Error('settlement or credential does not match the purchase');
      }
      const typed = credential_typed_data(body.credential, chain_id, manager);
      const signer = await recoverTypedDataAddress({ ...typed, signature: body.signature });
      if (!await read_manager('hasRole', [oracle_role, signer])) throw new Error('credential signer lacks ORACLE_ROLE');
      console.log(JSON.stringify(body));
    } catch (error) {
      throw new Error(`Purchase for ${wallets[index]} could not be confirmed: ${error.message}. Check the buyer wallet and treasury before retrying.`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
