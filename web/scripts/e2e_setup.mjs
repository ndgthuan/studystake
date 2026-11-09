// Starts the local E2E stack: chain, contract deploy, oracle dev server and `next start`.
//
//   npm run e2e           Anvil stack, runs Playwright, stops everything, exits with Playwright's code
//   npm run e2e:setup     Anvil stack, stays up until Ctrl+C (run `npx playwright test` by hand)
//   npm run e2e:fork      Fuji fork stack with Circle USDC and a local x402 facilitator, stays up until Ctrl+C
//   npm run e2e:fork:run  Fuji fork stack, runs the fork spec and a real x402 payment, stops everything
//   npm run e2e:fork:api  Fuji fork stack without the web, stays up until Ctrl+C. Skips the build, which is the memory peak
//
// Plain Anvil has no Circle USDC and tUSDC has no EIP-3009, so x402 work needs the fork. A fork keeps chain id 43113,
// so deploy output must never land in contracts/deployments/43113.json, the file with the real Fuji addresses.
// Uses Anvil's PUBLIC default keys only. Logs go to web/e2e_logs/.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { encodeFunctionData, parseAbi } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const web_root = resolve(here, '..');
const repo_root = resolve(web_root, '..');
const contracts_root = join(repo_root, 'contracts');
const oracle_root = join(repo_root, 'oracle');
const log_dir = join(web_root, 'e2e_logs');
const next_bin = join(web_root, 'node_modules', 'next', 'dist', 'bin', 'next');

const FORK_RPC = process.env.E2E_FORK_RPC ?? 'https://api.avax-test.network/ext/bc/C/rpc';
const CIRCLE_USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';
const FORK_USDC_PER_ACCOUNT = 1_000_000_000n; // 1,000 USDC
const CHAIN_PORT = 8545;
const ORACLE_PORT = 8788;
const WEB_PORT = 3000;
const FACILITATOR_PORT = 4022;
const RPC = `http://127.0.0.1:${CHAIN_PORT}`;
const ORACLE_URL = `http://127.0.0.1:${ORACLE_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const FACILITATOR_URL = `http://127.0.0.1:${FACILITATOR_PORT}`;

// Anvil default dev keys (public, well known). Never use on a real network. Same roles as tests/e2e/chain.ts.
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  oracle: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  faucet: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  facilitator: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
};
const ORACLE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TREASURY_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const args = new Set(process.argv.slice(2));
const FORK = args.has('--fork');
const RUN_TESTS = args.has('--run');
const NO_WEB = args.has('--no-web');
const CHAIN_ID = FORK ? 43113 : 31337;
// Anvil runs every spec, and the fork spec skips itself there. The other specs read 31337.json, so the fork stops at its own.
const SPEC_FILTER = FORK ? ['fork_circle'] : [];
/** Where this stack's addresses end up. The fork copy is git-ignored and is not the real Fuji file. */
const deployments_path = join(contracts_root, 'deployments', FORK ? 'fork-43113.json' : '31337.json');

const children = [];
const restores = new Map();
let stopping = false;

function log(message) {
  console.log(`[e2e] ${message}`);
}

/** Absolute path to a Foundry tool when installed under ~/.foundry/bin, otherwise the bare name from PATH. */
function foundry_tool(name) {
  const candidate = join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(candidate) ? candidate : name;
}

function log_tail(name, lines = 25) {
  const path = join(log_dir, `${name}.log`);
  if (!existsSync(path)) return '(no log)';
  return readFileSync(path, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
}

/** Spawns a process with its output in web/e2e_logs/<name>.log. */
function start_logged(name, command, command_args, options = {}) {
  const fd = openSync(join(log_dir, `${name}.log`), 'w');
  const child = spawn(command, command_args, { ...options, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return child;
}

/** Starts a long-running service. Its unexpected exit stops the whole stack with the end of its log. */
function start_service(name, command, command_args, options = {}) {
  const child = start_logged(name, command, command_args, options);
  children.push(child);
  child.on('error', (err) => void shutdown(1, `${name} failed to start: ${err.message}`));
  child.on('exit', (code) => {
    if (!stopping) void shutdown(1, `${name} exited early (code ${code}):\n${log_tail(name)}`);
  });
}

/** Runs a command to completion and throws with the end of its log on failure. */
function run_step(name, command, command_args, options = {}) {
  return new Promise((ok, fail) => {
    const child = start_logged(name, command, command_args, options);
    child.on('error', (err) => fail(new Error(`${name} failed to start: ${err.message}`)));
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${name} failed (code ${code}):\n${log_tail(name)}`))));
  });
}

/** Stops a process and its children. Windows has no process groups for this, so it needs taskkill /T. */
function stop_child(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((done) => {
    child.once('exit', () => done());
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    setTimeout(done, 5000).unref();
  });
}

/** Remembers a file's bytes so it comes back even on Ctrl+C. A file that did not exist is removed. */
function protect_file(path) {
  if (!restores.has(path)) restores.set(path, existsSync(path) ? readFileSync(path) : null);
}

function restore_file(path) {
  if (!restores.has(path)) return;
  const original = restores.get(path);
  if (original === null) rmSync(path, { force: true });
  else writeFileSync(path, original);
  restores.delete(path);
}

async function shutdown(code, message) {
  if (stopping) return;
  stopping = true;
  if (message) console.error(`[e2e] ${message}`);
  for (const path of [...restores.keys()]) restore_file(path);
  await Promise.all(children.map(stop_child));
  process.exit(code);
}

function port_in_use(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

/** Fails early with instructions, instead of a confusing error halfway through. */
async function preflight() {
  const ports = [CHAIN_PORT, ORACLE_PORT, ...(NO_WEB ? [] : [WEB_PORT]), ...(FORK ? [FACILITATOR_PORT] : [])];
  for (const port of ports) {
    if (await port_in_use(port)) throw new Error(`port ${port} is already in use. Stop what is running there and try again.`);
  }
  const forge_std = join(contracts_root, 'lib', 'forge-std');
  if (!existsSync(forge_std) || readdirSync(forge_std).length === 0) {
    throw new Error('Foundry libraries are missing. Run: git submodule update --init --recursive');
  }
  if (!existsSync(join(oracle_root, 'node_modules'))) throw new Error('oracle dependencies are missing. Run: cd oracle && npm install');
  if (RUN_TESTS && !NO_WEB && !existsSync(chromium.executablePath())) throw new Error('the Playwright browser is missing. Run: npx playwright install chromium');
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function wait_for(label, probe, timeout_ms = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeout_ms) {
    if (stopping) return;
    try {
      if (await probe()) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function wait_http(label, url) {
  return wait_for(label, async () => (await fetch(url)).ok);
}

async function start_chain() {
  log(FORK ? `forking Fuji from ${FORK_RPC}` : 'starting Anvil');
  const fork_args = FORK ? ['--fork-url', FORK_RPC] : [];
  start_service('chain', foundry_tool('anvil'), ['--port', String(CHAIN_PORT), '--silent', ...fork_args]);
  await wait_for('the chain', async () => Number(await rpc('eth_chainId')) === CHAIN_ID);
}

/**
 * Deploys with explicit env and a local RPC, so a developer's contracts/.env can never send this anywhere else.
 * forge writes to deployments/<chainid>.json, so on the fork the real Fuji file is put back right after.
 */
async function deploy_contracts() {
  log('deploying contracts');
  const forge_output = join(contracts_root, 'deployments', `${CHAIN_ID}.json`);
  const broadcast_dir = mkdtempSync(join(tmpdir(), 'studystake-broadcast-'));
  if (FORK) protect_file(forge_output);
  try {
    await run_step('deploy', foundry_tool('forge'), ['script', 'script/Deploy.s.sol', '--rpc-url', RPC, '--broadcast'], {
      cwd: contracts_root,
      env: {
        ...process.env,
        PRIVATE_KEY: KEYS.deployer,
        ORACLE_ADDRESS,
        TREASURY_ADDRESS,
        USE_CIRCLE_USDC: FORK ? 'true' : 'false',
        CIRCLE_USDC,
        FOUNDRY_BROADCAST: broadcast_dir,
      },
    });
    if (FORK) writeFileSync(deployments_path, readFileSync(forge_output));
  } finally {
    restore_file(forge_output);
    rmSync(broadcast_dir, { recursive: true, force: true });
  }
  return JSON.parse(readFileSync(deployments_path, 'utf8'));
}

/** Mints fork-only USDC to the participant accounts by impersonating the token's masterMinter. */
async function fund_fork_accounts() {
  log('minting fork-only Circle USDC to test accounts');
  const abi = parseAbi([
    'function masterMinter() view returns (address)',
    'function configureMinter(address minter, uint256 allowance)',
    'function mint(address to, uint256 amount)',
  ]);
  const raw = await rpc('eth_call', [{ to: CIRCLE_USDC, data: encodeFunctionData({ abi, functionName: 'masterMinter' }) }, 'latest']);
  const master_minter = `0x${raw.slice(-40)}`;
  await rpc('anvil_impersonateAccount', [master_minter]);
  await rpc('anvil_setBalance', [master_minter, '0x56BC75E2D63100000']);
  const send_as_minter = async (data) => {
    const hash = await rpc('eth_sendTransaction', [{ from: master_minter, to: CIRCLE_USDC, data }]);
    await wait_for('a mint transaction', async () => (await rpc('eth_getTransactionReceipt', [hash]))?.status === '0x1', 30_000);
  };
  const accounts = (await rpc('eth_accounts')).slice(4, 8);
  await send_as_minter(
    encodeFunctionData({ abi, functionName: 'configureMinter', args: [master_minter, FORK_USDC_PER_ACCOUNT * BigInt(accounts.length)] }),
  );
  for (const account of accounts) {
    await send_as_minter(encodeFunctionData({ abi, functionName: 'mint', args: [account, FORK_USDC_PER_ACCOUNT] }));
  }
  await rpc('anvil_stopImpersonatingAccount', [master_minter]);
  return accounts;
}

function start_oracle(deployments, deploy_block) {
  log('starting the oracle dev server');
  start_service('oracle', process.execPath, ['scripts/dev_server.mjs', String(ORACLE_PORT)], {
    cwd: oracle_root,
    env: {
      ...process.env,
      CHAIN_ID: String(CHAIN_ID),
      RPC_URL: RPC,
      MANAGER_ADDRESS: deployments.manager,
      DEPLOY_BLOCK: String(deploy_block),
      ORACLE_PRIVATE_KEY: KEYS.oracle,
      FAUCET_PRIVATE_KEY: KEYS.faucet,
      TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
      PRIVY_APP_ID: 'e2e-local',
      ALLOWED_ORIGINS: `${WEB_URL},http://localhost:${WEB_PORT}`,
      // The paid route needs EIP-3009, so it only runs on the fork. Plain Anvil leaves it off (503).
      ...(FORK ? { X402_FACILITATOR_URL: FACILITATOR_URL, X402_ASSET: CIRCLE_USDC, X402_PRICE: '5000' } : {}),
    },
  });
  return wait_http('the oracle', `${ORACLE_URL}/health`);
}

function start_facilitator() {
  log('starting the local x402 facilitator');
  start_service('facilitator', process.execPath, ['scripts/facilitator.mjs', String(FACILITATOR_PORT)], {
    cwd: oracle_root,
    env: { ...process.env, FACILITATOR_PRIVATE_KEY: KEYS.facilitator, FACILITATOR_RPC_URL: RPC },
  });
  return wait_http('the facilitator', `${FACILITATOR_URL}/supported`);
}

/** Privy is forced off so a developer's .env.local cannot change the wallet flow. */
function web_env(deploy_block) {
  return {
    ...process.env,
    NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID),
    NEXT_PUBLIC_RPC_URL: RPC,
    NEXT_PUBLIC_ORACLE_URL: ORACLE_URL,
    NEXT_PUBLIC_PRIVY_APP_ID: '',
    NEXT_PUBLIC_DEPLOY_BLOCK: String(deploy_block),
    DEPLOYMENTS_FILE: deployments_path,
  };
}

/**
 * NEXT_PUBLIC_* values are inlined at build time, so the web must be built for this stack. The build needs these
 * addresses in src/generated/deployments.json, a tracked file, which goes back to its committed bytes afterwards.
 */
async function build_web(deploy_block) {
  log('building the web (this takes a minute or two)');
  const env = web_env(deploy_block);
  const generated = join(web_root, 'src', 'generated', 'deployments.json');
  protect_file(generated);
  try {
    await run_step('sync', process.execPath, ['scripts/sync_deployments.mjs'], { cwd: web_root, env });
    await run_step('build', process.execPath, [next_bin, 'build'], { cwd: web_root, env });
  } finally {
    restore_file(generated);
  }
}

async function start_web(deploy_block) {
  log('starting the web');
  start_service('web', process.execPath, [next_bin, 'start', '-p', String(WEB_PORT), '-H', '127.0.0.1'], { cwd: web_root, env: web_env(deploy_block) });
  await wait_http('the web', WEB_URL);
}

function run_playwright() {
  return new Promise((done) => {
    const cli = join(web_root, 'node_modules', '@playwright', 'test', 'cli.js');
    const child = spawn(process.execPath, [cli, 'test', ...SPEC_FILTER], {
      cwd: web_root,
      stdio: 'inherit',
      env: { ...process.env, E2E_MODE: FORK ? 'fork' : 'anvil', E2E_DEPLOYMENTS: deployments_path },
    });
    child.on('error', () => done(1));
    child.on('exit', (code) => done(code ?? 1));
  });
}

/** A real payment through the paid route. Its output goes straight to the terminal, like Playwright's. */
function run_x402_check() {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/x402_fork_check.mjs'], { cwd: oracle_root, stdio: 'inherit' });
    child.on('error', () => done(1));
    child.on('exit', (code) => done(code ?? 1));
  });
}

async function main() {
  mkdirSync(log_dir, { recursive: true });
  await preflight();
  await start_chain();
  const deploy_block = FORK ? Number(await rpc('eth_blockNumber')) : 0;
  const deployments = await deploy_contracts();
  const funded = FORK ? await fund_fork_accounts() : [];
  // The build is the memory peak and needs neither service, so it runs before they start.
  if (!NO_WEB) await build_web(deploy_block);
  await start_oracle(deployments, deploy_block);
  if (FORK) await start_facilitator();
  if (!NO_WEB) await start_web(deploy_block);

  if (RUN_TESTS) {
    const spec_code = NO_WEB ? 0 : await run_playwright();
    await shutdown(spec_code === 0 && FORK ? await run_x402_check() : spec_code);
    return;
  }
  log(`stack is up. Logs: ${log_dir}`);
  log(`  chain        ${RPC} (chain id ${CHAIN_ID})`);
  log(`  oracle       ${ORACLE_URL}`);
  if (!NO_WEB) log(`  web          ${WEB_URL}`);
  log(`  addresses    ${deployments_path}`);
  if (FORK) {
    log(`  facilitator  ${FACILITATOR_URL}`);
    log(`  USDC holders ${funded.join(', ')}`);
  }
  log('press Ctrl+C to stop');
}

process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));
main().catch((err) => void shutdown(1, err instanceof Error ? err.message : String(err)));
