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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="dark" className={font.className}>
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
