'use client';
// Reads one challenge and its phase from chain. Refetches on an interval so countdowns and phase badges stay live.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { addresses, abis, public_client, to_challenge, PHASE_NAMES, type PhaseName, type ChallengeView } from '@/lib/contracts';

export interface ChallengeData {
  id: bigint;
  ch: ChallengeView;
  phase: PhaseName;
}

export function use_challenge(id: bigint | null) {
  return useQuery<ChallengeData>({
    queryKey: ['challenge', id?.toString() ?? null],
    enabled: id !== null,
    refetchInterval: 15_000,
    queryFn: async () => {
      const raw = await public_client.readContract({
        address: addresses.manager,
        abi: abis.manager,
        functionName: 'get_challenge',
        args: [id!],
      });
      const phase_idx = await public_client.readContract({
        address: addresses.manager,
        abi: abis.manager,
        functionName: 'phase_of',
        args: [id!],
      });
      return { id: id!, ch: to_challenge(raw), phase: PHASE_NAMES[Number(phase_idx)] ?? 'Joining' };
    },
  });
}

/** Query key prefix that every write invalidates, so the detail, list and me pages all refetch after a tx. */
export const CHALLENGE_QUERY_PREFIXES = ['challenge', 'challenges', 'me', 'progress', 'roles', 'balance', 'stake', 'claim_receipt', 'preview', 'proof'] as const;

/** Invalidates every query that a state-changing transaction can affect. */
export function invalidate_challenge_queries(qc: QueryClient) {
  for (const prefix of CHALLENGE_QUERY_PREFIXES) {
    void qc.invalidateQueries({ queryKey: [prefix] });
  }
}
