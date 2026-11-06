'use client';
import { t } from '@/lib/i18n';
import { use_ui } from '@/hooks/use_ui';

export function ThemeToggle() {
  const { lang, theme, set_theme } = use_ui();
  return (
    <button
      type="button"
      className="btn btn-ghost min-w-[44px]"
      aria-label={t(lang, 'theme_toggle')}
      onClick={() => set_theme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
