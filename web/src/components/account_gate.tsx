'use client';

import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { WalletButton } from './wallet_button';

export function AccountGate({ page }: { page: 'me' | 'link' }) {
  const { lang } = use_ui();
  const purpose = page === 'me'
    ? { vi: 'Kết nối ví để xem tiền cọc, tiến độ và huy hiệu của bạn.', en: 'Connect your wallet to see your stakes, progress and badges.' }
    : { vi: 'Kết nối ví để liên kết tài khoản Moodle hoặc lớp học demo.', en: 'Connect your wallet to link your Moodle account or demo class.' };
  return (
    <section className="gate">
      <h1>{t(lang, page === 'me' ? 'me_title' : 'link_title')}</h1>
      <p>{purpose[lang]}</p>
      <WalletButton />
    </section>
  );
}
