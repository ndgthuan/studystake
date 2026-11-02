// Local Node server for the oracle Worker. Used by the web E2E when `wrangler dev --local` cannot run.
// It imports the Worker's default export (fetch + scheduled) unchanged, backs KV and R2 with in-memory
// shims, and adds POST /__test/run_cron to trigger the scheduled handler. Test-only; never deployed.
// Usage: node scripts/dev_server.mjs [port]   (reads oracle env from process.env; see .dev.vars.example)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const oracle_root = resolve(here, '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);

/** Loads KEY=VALUE pairs from .dev.vars into process.env (local, git-ignored file). */
function load_dev_vars() {
  const path = join(oracle_root, '.dev.vars');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function make_kv() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value) {
      data.set(key, String(value));
    },
    async delete(key) {
      data.delete(key);
    },
    _data: data,
  };
}

function make_r2() {
  const data = new Map();
  return {
    async put(key, value) {
      data.set(key, String(value));
    },
    async get(key) {
      if (!data.has(key)) return null;
      const text = data.get(key);
      return { text: async () => text };
    },
    _data: data,
  };
}

const env = {
  ...load_dev_vars(),
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
  STATE: make_kv(),
  EVIDENCE: make_r2(),
};
// Defaults that wrangler.toml would normally supply.
env.CHAIN_ID ??= '31337';
env.RPC_URL ??= 'http://127.0.0.1:8545';
env.DEPLOY_BLOCK ??= '0';
env.ALLOWED_ORIGINS ??= 'http://localhost:3000,http://127.0.0.1:3000';
env.MOODLE_SITES ??= 'https://courses.ctda.hcmus.edu.vn';
env.FAUCET_AMOUNT_WEI ??= '50000000000000000';
env.FAUCET_DAILY_CAP ??= '20';

const worker = (await import(new URL('../src/index.ts', import.meta.url).href)).default;

/** Latest Anvil block timestamp (seconds). Used only by the test-only cron route. */
async function chain_latest_timestamp() {
  const rpc = env.RPC_URL;
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
  });
  const json = await res.json();
  return Number(BigInt(json.result.timestamp));
}

function to_request(req, body) {
  const url = `http://127.0.0.1:${port}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
  }
  return new Request(url, { method: req.method, headers, body: body.length > 0 ? body : undefined });
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  // Test-only: stores canonical metadata under its hash in the R2 shim. The hash is recomputed here, so a
  // caller cannot store bytes under a hash they do not match. Never reachable in a deployed Worker.
  if (req.method === 'POST' && req.url === '/__test/put_metadata') {
    try {
      const { hash, canonical } = JSON.parse(body.toString('utf8'));
      const { keccak256, toBytes } = await import('viem');
      if (keccak256(toBytes(canonical)) !== hash) throw new Error('hash does not match canonical bytes');
      await env.EVIDENCE.put(`metadata/${String(hash).toLowerCase()}.json`, canonical);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/__test/run_cron') {
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
    try {
      // Anvil time is moved with evm_increaseTime, so wall clock lags behind it. The settle job compares
      // now() with on-chain deadlines, so for this test-only cron call we report the chain's latest timestamp.
      const latest = await chain_latest_timestamp();
      const real_now = Date.now;
      Date.now = () => latest * 1000;
      try {
        await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: latest * 1000 }, env, ctx);
        await Promise.all(waits);
      } finally {
        Date.now = real_now;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  try {
    const response = await worker.fetch(to_request(req, body), env, { waitUntil() {}, passThroughOnException() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'dev_server', message: err instanceof Error ? err.message : String(err) } }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`oracle dev server on http://127.0.0.1:${port}`);
});
