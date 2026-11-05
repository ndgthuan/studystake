// Local x402 facilitator on Avalanche Fuji or a fork of it. A facilitator verifies a buyer's signed USDC payment and
// submits it, paying the gas, so the seller needs no wallet logic. Public facilitators cannot see a local fork.
// Usage: FACILITATOR_PRIVATE_KEY=0x... FACILITATOR_RPC_URL=http://... node scripts/facilitator.mjs [port]
import { createServer } from 'node:http';
import { x402Facilitator } from '@x402/core/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { registerExactEvmScheme } from '@x402/evm/exact/facilitator';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

const NETWORK = 'eip155:43113';
const MAX_BODY_BYTES = 64 * 1024;
const port = Number(process.argv[2] ?? process.env.PORT ?? 4022);
const key = process.env.FACILITATOR_PRIVATE_KEY ?? '';
const rpc_url = process.env.FACILITATOR_RPC_URL ?? '';
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('FACILITATOR_PRIVATE_KEY is missing or malformed');
if (rpc_url.length === 0) throw new Error('FACILITATOR_RPC_URL is missing');

const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpc_url) }).extend(publicActions);
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
    if (req.method === 'POST' && req.url === '/verify') {
      const body = await read_json(req);
      const result = await facilitator.verify(body.paymentPayload, body.paymentRequirements);
      console.log(JSON.stringify({ event: 'verify', is_valid: result.isValid, reason: result.invalidReason ?? null, payer: result.payer ?? null }));
      return send_json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/settle') {
      const body = await read_json(req);
      const result = await facilitator.settle(body.paymentPayload, body.paymentRequirements);
      console.log(JSON.stringify({ event: 'settle', success: result.success, reason: result.errorReason ?? null, transaction: result.transaction ?? null }));
      return send_json(res, 200, result);
    }
    return send_json(res, 404, { error: 'not found' });
  } catch (err) {
    return send_json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`facilitator for ${NETWORK} on http://127.0.0.1:${port}, gas paid by ${account.address}`);
});
