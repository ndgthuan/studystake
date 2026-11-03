// Stake tokens the app knows about, and the EIP-2612 domain each one signs permits with.
import { getAddress, isAddressEqual, zeroAddress, type Address } from 'viem';
import { addresses, abis, public_client } from './contracts';

export const CIRCLE_FAUCET_URL = 'https://faucet.circle.com';

export interface StakeToken {
  key: 'tusdc' | 'circle_usdc';
  label: string;
  token: Address;
  vault: Address;
}

/** Tokens a creator can open a challenge in. Circle USDC is listed only when the deployment allowlisted it. */
export function stake_tokens(): StakeToken[] {
  const out: StakeToken[] = [];
  if (addresses.circle_usdc !== zeroAddress && addresses.circle_usdc_vault !== zeroAddress) {
    out.push({ key: 'circle_usdc', label: 'USDC (Circle)', token: addresses.circle_usdc, vault: addresses.circle_usdc_vault });
  }
  out.push({ key: 'tusdc', label: 'tUSDC (test)', token: addresses.tusdc, vault: addresses.tusdc_vault });
  return out;
}

/** True for the in-app test token, which has a faucet() the UI can call. */
export function is_tusdc(token: Address): boolean {
  return isAddressEqual(token, addresses.tusdc);
}

const VERSION_ABI = [
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/**
 * Permit domain version. OpenZeppelin tokens expose eip712Domain() (EIP-5267); Circle USDC has no
 * eip712Domain but has version() = "2". Signing with the wrong version makes join_with_permit revert.
 */
export async function permit_version(token: Address): Promise<string> {
  try {
    const domain = (await public_client.readContract({ address: token, abi: abis.token, functionName: 'eip712Domain' })) as readonly unknown[];
    if (typeof domain[2] === 'string') return domain[2];
  } catch {
    // fall through
  }
  try {
    return (await public_client.readContract({ address: token, abi: VERSION_ABI, functionName: 'version' })) as string;
  } catch {
    return '1';
  }
}

export async function permit_domain(token: Address) {
  const [name, version] = await Promise.all([
    public_client.readContract({ address: token, abi: abis.token, functionName: 'name' }) as Promise<string>,
    permit_version(token),
  ]);
  return { name, version, chainId: public_client.chain!.id, verifyingContract: getAddress(token) };
}
