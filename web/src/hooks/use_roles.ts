'use client';
// Reads CREATOR_ROLE and GUARDIAN_ROLE for the connected wallet from the manager contract.
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { addresses, abis, public_client } from '@/lib/contracts';
import { keccak256, toBytes } from 'viem';

const CREATOR_ROLE = keccak256(toBytes('CREATOR_ROLE'));
const GUARDIAN_ROLE = keccak256(toBytes('GUARDIAN_ROLE'));
const ADMIN_ROLE = `0x${'0'.repeat(64)}` as const;

export function use_roles() {
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ['roles', address ?? null],
    enabled: !!address,
    queryFn: async () => {
      const who = address!;
      const read = (role: `0x${string}`) =>
        public_client.readContract({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'hasRole',
          args: [role, who],
        }) as Promise<boolean>;
      const [creator, guardian, admin] = await Promise.all([
        read(CREATOR_ROLE),
        read(GUARDIAN_ROLE),
        read(ADMIN_ROLE),
      ]);
      return { creator, guardian, admin };
    },
  });
  const roles = query.data ?? { creator: false, guardian: false, admin: false };
  return {
    ...roles,
    is_admin: roles.creator || roles.guardian || roles.admin,
    loading: query.isLoading,
  };
}
