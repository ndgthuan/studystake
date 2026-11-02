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
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        set_theme(next);
        document.documentElement.setAttribute('data-theme', next);
      }}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
