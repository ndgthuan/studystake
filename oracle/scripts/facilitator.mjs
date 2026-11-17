// StudyStake x402 facilitator on Avalanche Fuji or a local fork. The facilitator pays gas for EIP-3009 transfers.
// Usage: FACILITATOR_PRIVATE_KEY=0x... FACILITATOR_RPC_URL=http://... node scripts/facilitator.mjs [port]
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { x402Facilitator } from '@x402/core/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { registerExactEvmScheme } from '@x402/evm/exact/facilitator';
import { createWalletClient, http, isAddress, isAddressEqual, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

const NETWORK = 'eip155:43113';
const CIRCLE_USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';
const MAX_BODY_BYTES = 64 * 1024;
const port = Number(process.argv[2] ?? process.env.PORT ?? 4022);
const host = process.env.FACILITATOR_HOST ?? '127.0.0.1';
const key = process.env.FACILITATOR_PRIVATE_KEY ?? '';
const rpc_url = process.env.FACILITATOR_RPC_URL ?? '';
const auth_token = process.env.FACILITATOR_AUTH_TOKEN?.trim();
const treasury = process.env.FACILITATOR_TREASURY;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!auth_token || !treasury)) {
  throw new Error('Hosted facilitator requires FACILITATOR_AUTH_TOKEN and FACILITATOR_TREASURY');
}
if (treasury && !isAddress(treasury)) throw new Error('FACILITATOR_TREASURY is malformed');
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('FACILITATOR_PRIVATE_KEY is missing or malformed');
if (rpc_url.length === 0) throw new Error('FACILITATOR_RPC_URL is missing');

const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpc_url) }).extend(publicActions);
if (await wallet.getChainId() !== avalancheFuji.id) throw new Error('FACILITATOR_RPC_URL must be on Fuji (43113)');
const signer = toFacilitatorEvmSigner({
  address: account.address,
  getCode: (args) => wallet.getCode(args),
  readContract: (args) => wallet.readContract(args),
  verifyTypedData: (args) => wallet.verifyTypedData(args),
  writeContract: (args) => wallet.writeContract(args),
  sendTransaction: (args) => wallet.sendTransaction(args),
  waitForTransactionReceipt: (args) => wallet.waitForTransactionReceipt(args),
});
const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, { signer, networks: NETWORK });

const digest = (value) => createHash('sha256').update(value).digest();
const expected_auth = auth_token ? digest(`Bearer ${auth_token}`) : null;

function matches_studystake(body) {
  const requirements = body?.paymentRequirements;
  return body?.x402Version === 2 && requirements?.network === NETWORK && requirements.scheme === 'exact' &&
    requirements.amount === '5000' && isAddress(requirements.asset) && isAddressEqual(requirements.asset, CIRCLE_USDC) &&
    isAddress(requirements.payTo) && isAddressEqual(requirements.payTo, treasury) &&
    requirements.extra?.name === 'USD Coin' && requirements.extra?.version === '2';
}

function send_json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function read_json(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/supported') return send_json(res, 200, facilitator.getSupported());
    if (req.method === 'GET' && req.url === '/health') {
      const balance = await wallet.getBalance({ address: account.address });
      return send_json(res, 200, { chain_id: avalancheFuji.id, signer: account.address, balance_wei: balance.toString() });
    }
    if (req.method !== 'POST' || (req.url !== '/verify' && req.url !== '/settle')) {
      return send_json(res, 404, { error: 'not found' });
    }
    if (expected_auth && !timingSafeEqual(expected_auth, digest(req.headers.authorization ?? ''))) {
      return send_json(res, 401, { error: 'unauthorized' });
    }
    const body = await read_json(req);
    if (treasury && !matches_studystake(body)) return send_json(res, 400, { error: 'unsupported payment requirements' });
    if (req.url === '/verify') {
      const result = await facilitator.verify(body.paymentPayload, body.paymentRequirements);
      console.log(JSON.stringify({ event: 'verify', is_valid: result.isValid, reason: result.invalidReason ?? null, payer: result.payer ?? null }));
      return send_json(res, 200, result);
    }
    const result = await facilitator.settle(body.paymentPayload, body.paymentRequirements);
    console.log(JSON.stringify({ event: 'settle', success: result.success, reason: result.errorReason ?? null, transaction: result.transaction ?? null }));
    return send_json(res, 200, result);
  } catch (err) {
    console.warn(JSON.stringify({ event: 'request_failed', path: req.url }));
    return send_json(res, 400, { error: 'facilitator request failed' });
  }
});

server.listen(port, host, () => {
  console.log(`facilitator for ${NETWORK} listening on ${host}:${port}, gas paid by ${account.address}`);
});
