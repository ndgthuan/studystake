import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Spectral } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site_header';
import { THEME_COLORS } from '@/lib/theme';
import './globals.css';

const font = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const display_font = Spectral({
  subsets: ['latin', 'vietnamese'],
  weight: '500',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-spectral',
});

export const metadata: Metadata = {
  title: 'StudyStake',
  description: 'Theo dõi bài nộp Moodle và đối chiếu kết quả thử thách trên Avalanche Fuji.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// The server cannot read localStorage, so its HTML defaults to light and Vietnamese. This runs before the body is parsed,
// so a saved dark theme applies before paint. Keys and values must match the read_pref calls in providers.tsx.
// It also creates <meta name="theme-color">, and viewport.themeColor stays unset: React would add a second tag during
// hydration if the content had changed, and Next replaces its own tag on navigation, which resets the color to dark.
const APPLY_SAVED_PREFS = `(function(){var t,l,r=document.documentElement,m=document.createElement('meta');try{t=localStorage.getItem('ss_theme');l=localStorage.getItem('ss_lang')}catch(e){}if(t==='dark')r.setAttribute('data-theme','dark');if(l==='en')r.setAttribute('lang','en');m.name='theme-color';m.content=t==='dark'?'${THEME_COLORS.dark}':'${THEME_COLORS.light}';document.head.appendChild(m)})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: APPLY_SAVED_PREFS may change data-theme and lang on <html> before React hydrates.
    <html lang="vi" data-theme="light" className={`${font.className} ${display_font.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SAVED_PREFS }} />
      </head>
      <body>
        <Providers>
          <SiteHeader />
          <main className="app-main">{children}</main>
          <footer className="site-footer">
            StudyStake <span>Avalanche Team1 UniHack</span>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
