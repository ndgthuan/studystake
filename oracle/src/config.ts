// Reads environment bindings into a typed config. Secrets come from env (wrangler secrets / .dev.vars), never from files.

export interface Env {
  STATE: KVNamespace;
  EVIDENCE: R2Bucket;
  CHAIN_ID: string;
  RPC_URL: string;
  MANAGER_ADDRESS: string;
  DEPLOY_BLOCK: string;
  ALLOWED_ORIGINS: string;
  MOODLE_SITES: string;
  FAUCET_AMOUNT_WEI: string;
  FAUCET_DAILY_CAP: string;
  ORACLE_PRIVATE_KEY: string;
  FAUCET_PRIVATE_KEY?: string;
  TOKEN_ENC_KEY: string;
  PRIVY_APP_ID: string;
  TURNSTILE_SECRET?: string;
  X402_FACILITATOR_URL?: string;
  X402_ASSET?: string;
  X402_PRICE?: string;
}

export interface X402Config {
  facilitator_url: string;
  /** Token with EIP-3009. tUSDC does not work. */
  asset: string;
  /** Base units as a decimal string. */
  price: string;
}

export interface Config {
  chain_id: number;
  rpc_url: string;
  manager: `0x${string}`;
  deploy_block: bigint;
  allowed_origins: string;
  moodle_sites: string[];
  faucet_amount_wei: bigint;
  faucet_daily_cap: number;
  oracle_private_key: `0x${string}`;
  faucet_private_key: `0x${string}` | null;
  token_enc_key: string;
  privy_app_id: string;
  turnstile_secret: string | null;
  /** Null when no facilitator is set, which turns the paid route off. */
  x402: X402Config | null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function load_config(env: Env): Config {
  const manager = env.MANAGER_ADDRESS;
  if (!ADDRESS_RE.test(manager) || manager === '0x0000000000000000000000000000000000000000') {
    throw new Error('MANAGER_ADDRESS is not set (placeholder)');
  }
  if (!KEY_RE.test(env.ORACLE_PRIVATE_KEY)) throw new Error('ORACLE_PRIVATE_KEY missing or malformed');
  const faucet_key = env.FAUCET_PRIVATE_KEY && env.FAUCET_PRIVATE_KEY.length > 0 ? env.FAUCET_PRIVATE_KEY : null;
  if (faucet_key !== null && !KEY_RE.test(faucet_key)) throw new Error('FAUCET_PRIVATE_KEY malformed');

  return {
    chain_id: parse_int(env.CHAIN_ID, 'CHAIN_ID'),
    rpc_url: env.RPC_URL,
    manager: manager as `0x${string}`,
    deploy_block: BigInt(env.DEPLOY_BLOCK),
    allowed_origins: env.ALLOWED_ORIGINS,
    moodle_sites: env.MOODLE_SITES.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    faucet_amount_wei: BigInt(env.FAUCET_AMOUNT_WEI),
    faucet_daily_cap: parse_int(env.FAUCET_DAILY_CAP, 'FAUCET_DAILY_CAP'),
    oracle_private_key: env.ORACLE_PRIVATE_KEY as `0x${string}`,
    faucet_private_key: faucet_key as `0x${string}` | null,
    token_enc_key: env.TOKEN_ENC_KEY,
    privy_app_id: env.PRIVY_APP_ID,
    turnstile_secret: env.TURNSTILE_SECRET && env.TURNSTILE_SECRET.length > 0 ? env.TURNSTILE_SECRET : null,
    x402: load_x402(env),
  };
}

function load_x402(env: Env): X402Config | null {
  const url = env.X402_FACILITATOR_URL ?? '';
  if (url.length === 0) return null;
  if (!ADDRESS_RE.test(env.X402_ASSET ?? '')) throw new Error('X402_ASSET missing or malformed');
  if (!/^[1-9][0-9]*$/.test(env.X402_PRICE ?? '')) throw new Error('X402_PRICE must be positive base units');
  return { facilitator_url: url.replace(/\/+$/, ''), asset: env.X402_ASSET!, price: env.X402_PRICE! };
}

function parse_int(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

/** Allowed moodle site check. Only https origins listed in MOODLE_SITES. */
export function is_allowed_site(site: string, cfg: Pick<Config, 'moodle_sites'>): boolean {
  return cfg.moodle_sites.includes(site.replace(/\/+$/, ''));
}
