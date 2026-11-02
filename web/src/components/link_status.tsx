'use client';
// Shows the current LMS link for the connected wallet (GET /link/:wallet). Links to the /link page to change it.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { oracle } from '@/lib/oracle';

export function LinkStatus() {
  const { lang } = use_ui();
  const { address } = useAccount();
  const q = useQuery({
    queryKey: ['link', address ?? null],
    enabled: !!address,
    queryFn: () => oracle.get_link(address!),
  });
  if (!address) return null;
  const linked = q.data?.linked ? q.data : null;
  return (
    <section className="card flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
      <span>
        {t(lang, 'link_title')}:{' '}
        {linked ? (
          <span className="font-semibold">{linked.lms === 'demo' ? t(lang, 'link_demo') : t(lang, 'link_moodle')}</span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </span>
      <Link href="/link" className="underline">
        {t(lang, 'nav_link')}
      </Link>
    </section>
  );
}
