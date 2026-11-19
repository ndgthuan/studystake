import type { Lang } from '@/lib/i18n';
import { format_usdc } from '@/lib/usdc';

export function PayoutLines({lang,principal,estimate,reward}: {lang:Lang; principal:bigint|null; estimate?:bigint|null; reward?:bigint}) {
  const vi = lang === 'vi';
  const rows = [
    [vi ? 'Vốn gốc hoàn lại' : 'Returnable principal', principal],
    [vi ? 'Thưởng ước tính' : 'Estimated reward', estimate],
    [vi ? 'Thưởng đã chốt' : 'Final reward', reward],
  ] as const;
  return <dl className="payout-lines">{rows.map(([label,n]) => <div className="money-line" key={label}>
    <dt>{label}</dt><dd>{n == null ? '—' : `${format_usdc(n,6)} USDC`}</dd></div>)}</dl>;
}
