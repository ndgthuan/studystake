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
    <section className="folio">
      <div className="sheet-head"><h2>{linked?.lms === 'demo' ? t(lang, 'link_demo') : 'Moodle'}</h2></div>
      <p>{q.isPending ? t(lang, 'loading') : q.isError ? t(lang, 'error_load') :
        t(lang, linked ? (linked.lms === 'moodle' ? 'link_moodle_linked' : 'link_demo_linked') :
          q.data?.cleared ? 'link_token_cleared' : 'moodle_setup_needed')}</p>
      {linked?.lms === 'moodle' && linked.site && <p className="text-sm text-[var(--muted)] break-all">{linked.site}</p>}
      <Link href="/link" className="record-link">{t(lang, linked ? 'link_manage' : 'link_title')} ↗</Link>
    </section>
  );
}
