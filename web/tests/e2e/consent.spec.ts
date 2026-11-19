// Credential consent on /link, through the UI, checked against what the oracle reports. Sharing must be off until the
// student signs, must survive a reload, and must end when they unlink.
import { test, expect, type Page } from '@playwright/test';
import type { Address } from 'viem';
import { ORACLE, RPC, rpc } from './chain';
import { install_injected_wallet } from './injected_provider';

async function oracle_share(wallet: Address): Promise<boolean> {
  const res = await fetch(`${ORACLE}/x402/credential/${wallet}/consent`);
  return ((await res.json()) as { share: boolean }).share;
}

const heading = (page: Page) => page.getByRole('heading', { name: /Chia sẻ chứng nhận|Share your study credential/ });
const state = (page: Page) => page.getByRole('region', { name: /Chia sẻ chứng nhận|Share your study credential/ }).getByRole('status');
const enable = (page: Page) => page.getByRole('button', { name: /^(Bật chia sẻ|Turn sharing on)$/ });
const disable = (page: Page) => page.getByRole('button', { name: /^(Tắt chia sẻ|Turn sharing off)$/ });

test('a student turns credential sharing on and off from /link', async ({ browser }) => {
  // Anvil account 8: no other spec uses it, so it starts unlinked.
  const wallet = ((await rpc('eth_accounts')) as Address[])[8]!;
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const page = await ctx.newPage();
  await install_injected_wallet(page, RPC, { address: wallet });
  await page.goto('/link');

  // Nothing to share before a link exists.
  await expect(page.getByRole('heading', { name: /Liên kết LMS|LMS link/ })).toBeVisible();
  await expect(heading(page)).toHaveCount(0);

  await page.getByRole('button', { name: /^Demo LMS/ }).click();
  await page.getByRole('button', { name: /^(Liên kết LMS|LMS link)$/ }).click();
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });

  // Off by default, and linking alone does not turn it on.
  await expect(state(page)).toHaveText(/Đang tắt|Sharing is off/);
  expect(await oracle_share(wallet)).toBe(false);

  await enable(page).click();
  await expect(state(page)).toHaveText(/Đang bật|Sharing is on/, { timeout: 30_000 });
  expect(await oracle_share(wallet)).toBe(true);

  await page.reload();
  await expect(state(page)).toHaveText(/Đang bật|Sharing is on/, { timeout: 30_000 });

  await disable(page).click();
  await expect(state(page)).toHaveText(/Đang tắt|Sharing is off/, { timeout: 30_000 });
  expect(await oracle_share(wallet)).toBe(false);

  // Unlinking ends consent, and the page shows it without a reload. The same choice in the same second signs the same
  // message, which the oracle refuses as a replay, so move past that second as any real click would.
  await page.waitForTimeout(1100);
  await enable(page).click();
  await expect(state(page)).toHaveText(/Đang bật|Sharing is on/, { timeout: 30_000 });
  await page.getByRole('button', { name: /^(Hủy liên kết|Unlink)$/ }).click();
  await expect(heading(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.saved-link')).toHaveAttribute('data-linked', 'false');
  expect(await oracle_share(wallet)).toBe(false);

  await ctx.close();
});
