// Browser-side verification of a Study Credential, following docs/X402.md "How a buyer verifies". Pure: chain reads are
// passed in. Nothing in the pasted JSON is trusted, including the `signer` it names: the signer is always recovered.
import { hashTypedData, isAddressEqual, keccak256, recoverTypedDataAddress, toBytes, type Address, type Hex } from 'viem';
import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const uint32 = z.number().int().min(0).max(4_294_967_295);
const unix_time = z.number().int().positive();

// Strict, because a field outside the signed type could be shown as if the oracle had attested it.
const credential_schema = z.strictObject({
  wallet: address,
  lms: z.enum(['moodle', 'demo']),
  subject_hash: bytes32,
  site_hash: bytes32,
  streak: uint32,
  best_streak: uint32,
  total_completed: uint32,
  total_failed: uint32,
  issued_at: unix_time,
  expires_at: unix_time,
});

const signed_credential_schema = z.object({
  credential: credential_schema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(260),
  domain: z.strictObject({ name: z.string(), version: z.string(), chain_id: z.number().int().positive(), verifying_contract: address }),
});

export type Credential = z.infer<typeof credential_schema>;
export type SignedCredential = z.infer<typeof signed_credential_schema>;
export type BadgeStats = Pick<Credential, 'streak' | 'best_streak' | 'total_completed' | 'total_failed'>;
export type CheckResult = 'pass' | 'fail' | 'unknown';
export type Verdict = 'valid' | 'invalid' | 'expired' | 'unknown';

export const CREDENTIAL_DOMAIN_NAME = 'StudyStake Credential';
export const CREDENTIAL_DOMAIN_VERSION = '1';

// Must match oracle/src/credential.ts field for field. The test vector in tests/unit/credential.test.ts pins it.
const CREDENTIAL_TYPES = {
  Credential: [
    { name: 'wallet', type: 'address' },
    { name: 'lms', type: 'string' },
    { name: 'subject_hash', type: 'bytes32' },
    { name: 'site_hash', type: 'bytes32' },
    { name: 'streak', type: 'uint32' },
    { name: 'best_streak', type: 'uint32' },
    { name: 'total_completed', type: 'uint32' },
    { name: 'total_failed', type: 'uint32' },
    { name: 'issued_at', type: 'uint64' },
    { name: 'expires_at', type: 'uint64' },
  ],
} as const;

export function credential_typed_data(signed: Pick<SignedCredential, 'credential' | 'domain'>) {
  const { credential, domain } = signed;
  return {
    domain: { name: domain.name, version: domain.version, chainId: domain.chain_id, verifyingContract: domain.verifying_contract as Address },
    types: CREDENTIAL_TYPES,
    primaryType: 'Credential' as const,
    message: {
      ...credential,
      wallet: credential.wallet as Address,
      subject_hash: credential.subject_hash as Hex,
      site_hash: credential.site_hash as Hex,
      issued_at: BigInt(credential.issued_at),
      expires_at: BigInt(credential.expires_at),
    },
  };
}

export function credential_digest(signed: Pick<SignedCredential, 'credential' | 'domain'>): Hex {
  return hashTypedData(credential_typed_data(signed));
}

/** Same spelling rule as the oracle uses when linking, so a trailing slash cannot cause a false mismatch. */
export function site_hash_of(site: string): Hex {
  return keccak256(toBytes(site.trim().replace(/\/+$/, '')));
}

export interface VerifyDeps {
  chain_id: number;
  manager: Address;
  now_seconds: number;
  /** An empty string skips the comparison. */
  expected_site: string;
  /** Rejects when the chain cannot be read, which yields `unknown` and never `valid`. */
  has_oracle_role: (account: Address) => Promise<boolean>;
  read_badge_stats: (wallet: Address) => Promise<BadgeStats>;
}

export interface CredentialReport {
  verdict: Verdict;
  /** True only when our oracle signed these exact fields for this deployment. Otherwise they say nothing and must not be shown. */
  attested: boolean;
  credential: Credential;
  signer: Address | null;
  checks: { signature: CheckResult; deployment: CheckResult; freshness: CheckResult };
  /** Null when no school was given. */
  school_matches: boolean | null;
  /** Null when the chain could not be read. Live stats may differ, since a credential is a snapshot. */
  live_stats: BadgeStats | null;
}

export type VerifyOutcome = { ok: true; report: CredentialReport } | { ok: false; error: 'not_json' | 'wrong_shape' };

async function recover_signer(signed: SignedCredential): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({ ...credential_typed_data(signed), signature: signed.signature as Hex });
  } catch {
    return null;
  }
}

/** A forged signature is invalid whatever else is true, so an expired label is only given to genuine credentials. */
function decide(checks: CredentialReport['checks']): Verdict {
  if (checks.signature === 'fail' || checks.deployment === 'fail') return 'invalid';
  if (checks.signature === 'unknown') return 'unknown';
  return checks.freshness === 'fail' ? 'expired' : 'valid';
}

export async function verify_credential(text: string, deps: VerifyDeps): Promise<VerifyOutcome> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  const parsed = signed_credential_schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'wrong_shape' };
  const signed = parsed.data;
  const { credential, domain } = signed;

  const signer = await recover_signer(signed);
  let signature: CheckResult = 'fail';
  if (signer !== null) {
    try {
      signature = (await deps.has_oracle_role(signer)) ? 'pass' : 'fail';
    } catch {
      signature = 'unknown';
    }
  }

  const deployment_matches =
    domain.name === CREDENTIAL_DOMAIN_NAME &&
    domain.version === CREDENTIAL_DOMAIN_VERSION &&
    domain.chain_id === deps.chain_id &&
    isAddressEqual(domain.verifying_contract as Address, deps.manager);

  const checks: CredentialReport['checks'] = {
    signature,
    deployment: deployment_matches ? 'pass' : 'fail',
    freshness: deps.now_seconds < credential.expires_at ? 'pass' : 'fail',
  };

  const live_stats = await deps.read_badge_stats(credential.wallet as Address).catch(() => null);
  const school_matches = deps.expected_site.trim().length === 0 ? null : credential.site_hash.toLowerCase() === site_hash_of(deps.expected_site);
  const attested = checks.signature === 'pass' && checks.deployment === 'pass';
  return { ok: true, report: { verdict: decide(checks), attested, credential, signer, checks, school_matches, live_stats } };
}
