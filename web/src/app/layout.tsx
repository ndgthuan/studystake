import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site_header';
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
  themeColor: '#000000',
};

// The server cannot read localStorage, so its HTML always says dark. This runs before the body is parsed, so a saved
// light theme never flashes dark. Key and values must match the read_pref('ss_theme') call in providers.tsx.
const APPLY_SAVED_THEME = `try{if(localStorage.getItem('ss_theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: APPLY_SAVED_THEME may change data-theme on <html> before React hydrates.
    <html lang="vi" data-theme="dark" className={font.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SAVED_THEME }} />
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
