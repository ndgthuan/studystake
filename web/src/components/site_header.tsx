'use client';
// Top navigation: links, language toggle (vi default, en), theme toggle, wallet connect.
import Link from 'next/link';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { WalletButton } from './wallet_button';
import { ThemeToggle } from './theme_toggle';
import { use_roles } from '@/hooks/use_roles';

export function SiteHeader() {
  const { lang, set_lang } = use_ui();
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-bold" style={{ color: 'var(--accent)' }}>
          StudyStake
        </Link>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/challenges">{t(lang, 'nav_challenges')}</Link>
          <Link href="/me">{t(lang, 'nav_me')}</Link>
          <Link href="/link">{t(lang, 'nav_link')}</Link>
          <AdminLink />
        </nav>
        <div className="ml-auto flex items-center gap-2">
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
  if (!can_access_admin) return null;
  return <Link href="/admin">{t(lang, 'nav_admin')}</Link>;
}
