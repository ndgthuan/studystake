// End-to-end check on Anvil: deploy, demo challenge, join, demo submissions, settle job, finalize, claims with proofs.
// Usage: npm run e2e:anvil   (requires anvil and forge on PATH, or in ~/.foundry/bin)
// Exits nonzero on any failure. Uses anvil's PUBLIC default test keys only.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, http, keccak256, parseAbi, recoverTypedDataAddress, toBytes, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { manager_abi } from '../src/abi/manager.ts';
import { build_chain, chain_for, STATUS } from '../src/chain.ts';
import { canonical_json } from '../src/canonical.ts';
import { credential_typed_data, issue_credential } from '../src/credential.ts';
import { decrypt_token } from '../src/crypto.ts';
import { record_demo_submission, create_demo_adapter } from '../src/lms/demo.ts';
import { metadata_hash, metadata_key } from '../src/metadata.ts';
import { committed_proof } from '../src/evidence.ts';
import { evidence_key } from '../src/merkle.ts';
import { run_settle_job } from '../src/settle.ts';
import { put_json } from '../src/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const oracle_root = resolve(here, '..');
const contracts_root = resolve(oracle_root, '..', 'contracts');
const foundry_bin = join(homedir(), '.foundry', 'bin');

/** Absolute path to a Foundry tool when installed under ~/.foundry/bin, otherwise the bare name from PATH. */
function tool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = join(foundry_bin, exe);
  return existsSync(candidate) ? candidate : name;
}

/** Demo LMS subject hash, same formula as the link handler in src/index.ts. */
function demo_subject_hash(wallet) {
  return keccak256(toBytes(`demo|${wallet.toLowerCase()}`));
}
const RPC = 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;
const TREASURY = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const ORACLE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
// Anvil default dev keys (public, well known). Never use on a real network.
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  oracle: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  p1: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  p2: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  p3: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};

const TUSDC_ABI = parseAbi([
  'function faucet()',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const VAULT_ABI = parseAbi(['function fund_yield(uint256 amount, uint64 duration)']);
const BADGE_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

const STAKES = { p1: 100_000_000n, p2: 200_000_000n, p3: 300_000_000n };
const YIELD = 60_000_000n;
const JOIN_DEADLINE_OFFSET = 120;
const END_OFFSET = 300;
const SETTLE_GRACE = 600;
const DISPUTE_WINDOW = 300;

function fail(msg) {
  throw new Error(`ASSERT: ${msg}`);
}
function expect_eq(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
  console.log(`  ok ${label} = ${actual}`);
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

function start_anvil() {
  const child = spawn(tool('anvil'), ['--port', '8545', '--chain-id', String(CHAIN_ID), '--silent'], { stdio: 'ignore' });
  child.on('error', (err) => {
    console.error('failed to start anvil:', err.message);
    process.exitCode = 1;
  });
  return child;
}

async function wait_for_rpc(timeout_ms = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeout_ms) {
    try {
      const id = await rpc('eth_chainId');
      if (Number(id) === CHAIN_ID) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('anvil did not start');
}

function run_forge_deploy() {
  const env = {
    ...process.env,
    PRIVATE_KEY: KEYS.deployer,
    ORACLE_ADDRESS,
    TREASURY_ADDRESS: TREASURY,
    USE_CIRCLE_USDC: 'false',
  };
  execFileSync(tool('forge'), ['script', 'script/Deploy.s.sol', '--broadcast', '--rpc-url', RPC], {
    cwd: contracts_root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** In-memory R2 shim with the same put/get surface used by src/store.ts. */
function make_r2() {
  const data = new Map();
  return {
    async put(key, value) {
      data.set(key, value);
    },
    async get(key) {
      return data.has(key) ? { text: async () => data.get(key) } : null;
    },
    _data: data,
  };
}

function make_kv() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

async function run_scenario(dep) {
  const cfg = {
    chain_id: CHAIN_ID,
    rpc_url: RPC,
    manager: dep.manager,
    deploy_block: 0n,
    oracle_private_key: KEYS.oracle,
  };
  const chain = chain_for(cfg);
  const transport = http(RPC);
  const { port, public_client } = build_chain(chain, cfg, transport);
  const wallet_of = (key) => createWalletClient({ account: privateKeyToAccount(key), chain, transport });
  const deployer = wallet_of(KEYS.deployer);
  const p = { p1: privateKeyToAccount(KEYS.p1), p2: privateKeyToAccount(KEYS.p2), p3: privateKeyToAccount(KEYS.p3) };
  const wallets = { p1: wallet_of(KEYS.p1), p2: wallet_of(KEYS.p2), p3: wallet_of(KEYS.p3) };

  expect_eq(privateKeyToAccount(KEYS.oracle).address, ORACLE_ADDRESS, 'oracle key matches ORACLE_ADDRESS');
  const oracle_address = port.oracle_address();
  expect_eq(oracle_address.toLowerCase(), ORACLE_ADDRESS.toLowerCase(), 'port oracle address');

  const tusdc = dep.tusdc;
  const vault = dep.tusdc_vault;
  const badge = dep.badge;

  async function send(wallet, address, abi, functionName, args) {
    const hash = await wallet.writeContract({ address, abi, functionName, args });
    const receipt = await public_client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') fail(`${functionName} reverted (${hash})`);
    return receipt;
  }
  async function chain_time() {
    const b = await public_client.getBlock();
    return Number(b.timestamp);
  }
  async function advance_to(target) {
    const now = await chain_time();
    if (target > now) await rpc('evm_increaseTime', [target - now]);
    await rpc('evm_mine');
  }
  async function balance(addr) {
    return public_client.readContract({ address: tusdc, abi: TUSDC_ABI, functionName: 'balanceOf', args: [addr] });
  }

  console.log('setup: faucet, approvals');
  for (const key of [KEYS.deployer, KEYS.p1, KEYS.p2, KEYS.p3]) {
    await send(wallet_of(key), tusdc, TUSDC_ABI, 'faucet', []);
  }
  for (const key of [KEYS.p1, KEYS.p2, KEYS.p3]) {
    await send(wallet_of(key), tusdc, TUSDC_ABI, 'approve', [dep.manager, maxUint256]);
  }

  const t0 = await chain_time();
  const end_time = t0 + END_OFFSET;

  const kv = make_kv();
  const r2 = make_r2();
  const meta_doc = {
    version: 1,
    title: 'E2E demo challenge',
    lms: 'demo',
    site: 'demo',
    course_id: 1,
    activities: [
      { kind: 'quiz', instance_id: 1, name: 'Quiz 1', due: end_time },
      { kind: 'assign', instance_id: 2, name: 'Essay 1', due: end_time },
    ],
    min_grade: null,
  };
  const hash = metadata_hash(meta_doc);
  await r2.put(metadata_key(hash), canonical_json(meta_doc));

  console.log('create challenge');
  await send(deployer, dep.manager, manager_abi, 'create_challenge', [
    tusdc,
    vault,
    1_000_000n,
    500_000_000n,
    BigInt(t0 + JOIN_DEADLINE_OFFSET),
    BigInt(end_time),
    BigInt(SETTLE_GRACE),
    BigInt(DISPUTE_WINDOW),
    hash,
    'demo://metadata',
  ]);
  const challenge_id = Number(await port.challenge_count());
  expect_eq(challenge_id, 1, 'challenge id');

  console.log('join: p1 (completes), p2 (completes), p3 (no submission)');
  await send(wallets.p1, dep.manager, manager_abi, 'join', [BigInt(challenge_id), STAKES.p1]);
  await send(wallets.p2, dep.manager, manager_abi, 'join', [BigInt(challenge_id), STAKES.p2]);
  await send(wallets.p3, dep.manager, manager_abi, 'join', [BigInt(challenge_id), STAKES.p3]);
  for (const k of ['p1', 'p2', 'p3']) {
    await put_json(kv, `link:${p[k].address.toLowerCase()}`, {
      wallet: p[k].address.toLowerCase(),
      lms: 'demo',
      site: 'demo',
      userid: null,
      subject_hash: demo_subject_hash(p[k].address),
      // demo links carry no token, so token_enc stays null
      token_enc: null,
    });
  }

  console.log('yield: deployer funds vault (drip 100s)');
  await send(deployer, tusdc, TUSDC_ABI, 'approve', [vault, YIELD]);
  await send(deployer, vault, VAULT_ABI, 'fund_yield', [YIELD, 100n]);

  console.log('demo submissions: p1 and p2 submit both activities');
  const t_sub = await chain_time();
  await record_demo_submission(kv, p.p1.address, challenge_id, 1, t_sub);
  await record_demo_submission(kv, p.p1.address, challenge_id, 2, t_sub);
  await record_demo_submission(kv, p.p2.address, challenge_id, 1, t_sub);
  await record_demo_submission(kv, p.p2.address, challenge_id, 2, t_sub);
  const demo_adapter = create_demo_adapter(kv);
  const demo_check = await demo_adapter.get_activity_status(
    { lms: 'demo', site: 'demo', userid: null, wallet: p.p1.address, token: null, challenge_id },
    { kind: 'quiz', instance_id: 1, name: 'Quiz 1', due: end_time },
  );
  expect_eq(demo_check.submitted, true, 'demo adapter sees p1 submission');

  let chain_now = await chain_time();
  const deps = {
    port,
    store: { kv, r2 },
    chain_id: CHAIN_ID,
    manager: dep.manager,
    deploy_block: 0n,
    token_enc_key: 'unused-in-demo',
    decrypt_token,
    demo_adapter: create_demo_adapter(kv),
    moodle_adapter: () => {
      throw new Error('moodle adapter not used in E2E');
    },
    now: () => chain_now,
    log: (event, data) => console.log(`  log ${event} ${JSON.stringify(data)}`),
  };

  console.log('advance past end_time, run settle job');
  await advance_to(end_time + 1);
  chain_now = await chain_time();
  const settle_report = await run_settle_job(deps);
  const settled_entry = settle_report.challenges.find((c) => c.id === challenge_id && c.action === 'settled');
  if (!settled_entry) fail(`settle job did not settle: ${JSON.stringify(settle_report)}`);
  expect_eq(settled_entry.action, 'settled', 'settle action');

  const settled_row = await port.get_challenge(challenge_id);
  const evidence_text = await r2.get(evidence_key(CHAIN_ID, challenge_id, settled_row.evidence_hash)).then((o) => o.text());
  const evidence = JSON.parse(evidence_text);
  expect_eq(evidence.completed_count, 2, 'completed_count in evidence');
  const reasons = Object.fromEntries(evidence.entries.map((e) => [e.account, e.reason]));
  expect_eq(reasons[p.p1.address.toLowerCase()], 'ok', 'p1 reason');
  expect_eq(reasons[p.p2.address.toLowerCase()], 'ok', 'p2 reason');
  expect_eq(reasons[p.p3.address.toLowerCase()], 'missing', 'p3 reason');

  const settled_ch = await port.get_challenge(challenge_id);
  expect_eq(settled_ch.status, STATUS.Settled, 'on-chain status after settle');
  expect_eq(settled_ch.completed_stake, STAKES.p1 + STAKES.p2, 'on-chain completed_stake');

  console.log('advance past dispute window, run job to finalize');
  await advance_to(settled_ch.settled_at + DISPUTE_WINDOW + 1);
  chain_now = await chain_time();
  const finalize_report = await run_settle_job(deps);
  const fin = finalize_report.challenges.find((c) => c.id === challenge_id && c.action === 'finalized');
  if (!fin) fail(`finalize not performed: ${JSON.stringify(finalize_report)}`);

  const ch = await port.get_challenge(challenge_id);
  expect_eq(ch.status, STATUS.Finalized, 'on-chain status after finalize');
  const total_principal = STAKES.p1 + STAKES.p2 + STAKES.p3;
  expect_eq(ch.total_principal, total_principal, 'total_principal');
  expect_eq(ch.loss, false, 'no loss');
  const pot = ch.final_assets - ch.total_principal;
  const pot_delta = pot > YIELD ? pot - YIELD : YIELD - pot;
  if (pot_delta > 10n) fail(`pot ${pot} differs from funded yield ${YIELD} by more than 10 wei`);
  console.log(`  ok yield pot = ${pot} (funded ${YIELD}, diff ${pot - YIELD} wei from ERC-4626 rounding)`);
  expect_eq(ch.reward_pot, pot, 'reward_pot equals final yield pot (no bonus)');

  console.log('claims: p1 and p2 with proofs, p3 without');
  const before = {};
  for (const k of ['p1', 'p2', 'p3']) before[k] = await balance(p[k].address);

  const expected_reward = {
    p1: (ch.reward_pot * STAKES.p1) / ch.completed_stake,
    p2: (ch.reward_pot * STAKES.p2) / ch.completed_stake,
  };
  for (const k of ['p1', 'p2']) {
    // Proof comes from the committed-evidence lookup, the same path GET /proof/:id/:account uses.
    const lookup = await committed_proof(r2, CHAIN_ID, ch, p[k].address);
    if (lookup.kind !== 'ok' || !lookup.proof.completed) fail(`no completed proof for ${k}`);
    const proof_result = lookup.proof;
    const preview = await public_client.readContract({
      address: dep.manager,
      abi: manager_abi,
      functionName: 'preview_claim',
      args: [BigInt(challenge_id), p[k].address, true],
    });
    expect_eq(preview[1], expected_reward[k], `${k} preview reward`);
    await send(wallets[k], dep.manager, manager_abi, 'claim', [BigInt(challenge_id), true, proof_result.proof]);
    const after = await balance(p[k].address);
    expect_eq(after - before[k], STAKES[k] + expected_reward[k], `${k} balance delta (principal + reward)`);
  }
  await send(wallets.p3, dep.manager, manager_abi, 'claim', [BigInt(challenge_id), false, []]);
  expect_eq((await balance(p.p3.address)) - before.p3, STAKES.p3, 'p3 balance delta (principal only)');

  expect_eq(await public_client.readContract({ address: badge, abi: BADGE_ABI, functionName: 'balanceOf', args: [p.p1.address] }), 1n, 'p1 badge minted');
  expect_eq(await public_client.readContract({ address: badge, abi: BADGE_ABI, functionName: 'balanceOf', args: [p.p2.address] }), 1n, 'p2 badge minted');
  expect_eq(await public_client.readContract({ address: badge, abi: BADGE_ABI, functionName: 'balanceOf', args: [p.p3.address] }), 0n, 'p3 no badge');

  // Credential: stats come from the real StudyBadge, and the signer is checked the way a buyer checks it.
  const p1_stats = await port.badge_stats(p.p1.address);
  expect_eq(p1_stats.streak, 1, 'p1 credential streak');
  expect_eq(p1_stats.total_completed, 1, 'p1 credential total_completed');
  expect_eq((await port.badge_stats(p.p3.address)).total_completed, 0, 'p3 credential stats are zero without a badge');
  const signed = await issue_credential({
    link: { wallet: p.p1.address.toLowerCase(), lms: 'demo', site: 'demo', userid: null, subject_hash: demo_subject_hash(p.p1.address), token_enc: null },
    stats: p1_stats,
    now_seconds: Math.floor(Date.now() / 1000),
    chain_id: CHAIN_ID,
    manager: dep.manager,
    oracle_private_key: KEYS.oracle,
  });
  const typed = credential_typed_data(signed.credential, signed.domain.chain_id, signed.domain.verifying_contract);
  const recovered = await recoverTypedDataAddress({ ...typed, signature: signed.signature });
  const oracle_role = await public_client.readContract({ address: dep.manager, abi: manager_abi, functionName: 'ORACLE_ROLE' });
  expect_eq(await public_client.readContract({ address: dep.manager, abi: manager_abi, functionName: 'hasRole', args: [oracle_role, recovered] }), true, 'credential signer holds ORACLE_ROLE');

  console.log(`  manager: ${dep.manager}, oracle: ${oracle_address}, evidence key: ${evidence_key(CHAIN_ID, challenge_id, ch.evidence_hash)}`);
}

async function main() {
  const anvil = start_anvil();
  try {
    await wait_for_rpc();
    run_forge_deploy();
    const dep = JSON.parse(readFileSync(join(contracts_root, 'deployments', `${CHAIN_ID}.json`), 'utf8'));
    await run_scenario(dep);
    console.log('E2E PASS');
  } catch (err) {
    console.error('E2E FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    anvil.kill();
  }
}

await main();
