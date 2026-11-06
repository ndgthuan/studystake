import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site_header';
import { THEME_COLORS } from '@/lib/theme';
import './globals.css';

const font = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'StudyStake',
  description: 'Cam kết học, không mất gốc. Commit to study, never lose principal.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// The server cannot read localStorage, so its HTML always says dark and Vietnamese. This runs before the body is parsed,
// so a saved light theme never flashes dark. Keys and values must match the read_pref calls in providers.tsx.
// It also creates <meta name="theme-color">, and viewport.themeColor stays unset: React would add a second tag during
// hydration if the content had changed, and Next replaces its own tag on navigation, which resets the color to dark.
const APPLY_SAVED_PREFS = `(function(){var t,l,r=document.documentElement,m=document.createElement('meta');try{t=localStorage.getItem('ss_theme');l=localStorage.getItem('ss_lang')}catch(e){}if(t==='light')r.setAttribute('data-theme','light');if(l==='en')r.setAttribute('lang','en');m.name='theme-color';m.content=t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}';document.head.appendChild(m)})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: APPLY_SAVED_PREFS may change data-theme and lang on <html> before React hydrates.
    <html lang="vi" data-theme="dark" className={font.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SAVED_PREFS }} />
      </head>
      <body>
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-[var(--muted)]">
            Fuji testnet · Avalanche Team1 UniHack
          </footer>
        </Providers>
      </body>
    </html>
  );
}
