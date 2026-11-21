import { expect, test } from '@playwright/test';
import type { Address } from 'viem';
import { ORACLE, RPC, rpc } from './chain';
import { install_injected_wallet } from './injected_provider';

const SITE = 'https://courses.ctda.hcmus.edu.vn';

test('a saved Moodle link stays visible when a token update fails', async ({ page }) => {
  const wallet = ((await rpc('eth_accounts')) as Address[])[8]!;
  await install_injected_wallet(page, RPC, { address: wallet });
  let saved: { linked: boolean; lms: 'moodle'; site: string; cleared?: boolean } = { linked: true, lms: 'moodle', site: SITE };
  let reject_update = true;
  await page.route(new RegExp(`^${ORACLE}/link(?:/${wallet})?$`, 'i'), async (route) => {
    if (route.request().method() === 'POST') {
      if (reject_update) {
        await route.fulfill({ status: 502, json: { error: { code: 'moodle_unavailable', message: 'Moodle unavailable' } } });
        return;
      }
      saved = { linked: true, lms: 'moodle', site: SITE };
    }
    await route.fulfill({ json: saved });
  });
  await page.goto('/link');

  const status = page.getByRole('heading', { name: /^(Đã liên kết Moodle|Moodle linked)$/ });
  const edit = page.getByRole('button', { name: /^(Cập nhật liên kết|Update link)$/ });
  const token = page.getByLabel('Token', { exact: true });
  const consent = page.getByRole('checkbox', { name: /Tôi đồng ý|I allow StudyStake/ });
  const submit = page.getByRole('button', { name: /^(Lưu thay đổi|Save changes)$/ });

  await expect(status).toBeVisible();
  await expect(status.locator('..')).toContainText(SITE);
  await expect(token).toHaveCount(0);
  await edit.click();
  await token.fill('1'.repeat(32));
  await consent.check();
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: /Chưa cập nhật được liên kết|The LMS link could not be updated/ })).toBeVisible();
  await expect(status).toBeVisible();

  await page.getByRole('button', { name: /^(Hủy thay đổi|Cancel changes)$/ }).click();
  await expect(token).toHaveCount(0);
  await edit.click();
  await expect(token).toHaveValue('');
  await expect(consent).not.toBeChecked();
  reject_update = false;
  await token.fill('2'.repeat(32));
  await consent.check();
  await submit.click();
  await expect(edit).toBeVisible();
  await expect(token).toHaveCount(0);
  await page.reload();
  await expect(status).toBeVisible();
  await expect(token).toHaveCount(0);

  saved = { linked: false, lms: 'moodle', site: SITE, cleared: true };
  await page.reload();
  await expect(page.getByRole('heading', { name: /^(Cần liên kết lại Moodle|Reconnect Moodle)$/ })).toBeVisible();
  await expect(token).toBeVisible();
  await expect(status).toHaveCount(0);
});
