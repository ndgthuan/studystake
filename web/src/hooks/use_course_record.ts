'use client';
import { useQuery } from '@tanstack/react-query';
import { oracle } from '@/lib/oracle';
import { verify_evidence, ZERO_ROOT, type Evidence } from '@/lib/verify';
import type { ChallengeView } from '@/lib/contracts';

export function use_course_metadata(hash?: string) {
  return useQuery({
    queryKey: ['metadata', hash], enabled: !!hash,
    queryFn: () => oracle.get_metadata(hash!), staleTime: Infinity,
  });
}

export function use_course_evidence(id: bigint | null, ch?: ChallengeView) {
  return useQuery({
    queryKey: ['evidence', id?.toString(), ch?.evidence_hash, ch?.root],
    enabled: id !== null && !!ch && ch.evidence_hash !== ZERO_ROOT,
    queryFn: async () => {
      const evidence = await oracle.get_evidence(Number(id)) as unknown as Evidence;
      const checks = verify_evidence(evidence, ch!.evidence_hash, ch!.root);
      return { evidence, checks, verified: checks.hash_ok && checks.root_ok };
    },
    staleTime: Infinity,
  });
}
