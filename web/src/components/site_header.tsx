'use client';
// Top navigation: links, language toggle (vi default, en), theme toggle, wallet connect.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { WalletButton } from './wallet_button';
import { ThemeToggle } from './theme_toggle';
import { use_roles } from '@/hooks/use_roles';

export function SiteHeader() {
  const { lang, set_lang } = use_ui();
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="site-bar">
        <Link href="/" className="wordmark">
          <span className="brand-mark" aria-hidden="true">▰</span>StudyStake
        </Link>
        <nav className="site-nav">
          <Link href="/challenges" aria-current={path === '/challenges' || path.startsWith('/challenges/') ? 'page' : undefined}>{t(lang, 'nav_challenges')}</Link>
          <Link href="/me" aria-current={path === '/me' || path.startsWith('/me/') ? 'page' : undefined}>{t(lang, 'nav_me')}</Link>
          <Link href="/link" aria-current={path === '/link' || path.startsWith('/link/') ? 'page' : undefined}>{t(lang, 'nav_link')}</Link>
          <AdminLink />
        </nav>
        <div className="site-tools">
          <button
            type="button"
            className="btn btn-ghost min-w-[44px]"
            onClick={() => set_lang(lang === 'vi' ? 'en' : 'vi')}
            aria-label="language"
          >
            {t(lang, 'lang_toggle')}
          </button>
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

/** Admin link shows only when the connected wallet holds CREATOR_ROLE or GUARDIAN_ROLE on chain. */
function AdminLink() {
  const { lang } = use_ui();
  const { can_access_admin } = use_roles();
  const path = usePathname();
  if (!can_access_admin) return null;
  return <Link href="/admin" aria-current={path === '/admin' ? 'page' : undefined}>{t(lang, 'nav_admin')}</Link>;
}
