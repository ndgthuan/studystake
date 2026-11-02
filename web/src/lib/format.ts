// Display helpers for times and phases. Pure, no I/O.
import type { Lang } from './i18n';

/** Human countdown to a unix time, e.g. "2h 05m" or "45s". Returns "-" when already past. */
export function countdown(target_unix: number, now_unix: number, lang: Lang): string {
  const diff = target_unix - now_unix;
  if (diff <= 0) return '-';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return lang === 'vi' ? `${d} ngày ${h} giờ` : `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Formats a unix time for display in the browser's locale (vi-VN by default in the UI). */
export function format_time(unix: number, lang: Lang): string {
  return new Date(unix * 1000).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Maps a PhaseName from the contract to its i18n dictionary key. Explicit, so keys cannot drift. */
const PHASE_KEYS: Record<string, 'phase_joining' | 'phase_running' | 'phase_awaiting' | 'phase_dispute' | 'phase_disputed' | 'phase_finalized' | 'phase_expired' | 'phase_expirable' | 'phase_finalizable'> = {
  Joining: 'phase_joining',
  Running: 'phase_running',
  AwaitingSettle: 'phase_awaiting',
  DisputeWindow: 'phase_dispute',
  Disputed: 'phase_disputed',
  Finalized: 'phase_finalized',
  Expired: 'phase_expired',
  Expirable: 'phase_expirable',
  Finalizable: 'phase_finalizable',
};

export function phase_key(phase: string) {
  return PHASE_KEYS[phase] ?? 'phase_joining';
}
