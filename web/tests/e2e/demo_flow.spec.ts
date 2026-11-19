// Full demo flow on Anvil. Unlocked accounts only (no keys): participants a1, a2, a3 join through the UI, a sponsor
// adds a bonus, the deployer funds vault yield, two participants submit the demo, the oracle settles, the UI
// finalizes and claims, and every outcome is asserted on chain per address.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { install_injected_wallet, type AnvilAccount } from './injected_provider';
import type { Address } from 'viem';
import { chain_helpers, RPC, set_time, wait_for_wall_clock } from './chain';

test.describe.configure({ mode: 'serial' });

async function open_as(
  browser: { newContext: (o: { baseURL: string }) => Promise<BrowserContext> },
  account: AnvilAccount,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const page = await ctx.newPage();
  await install_injected_wallet(page, RPC, account);
  return { ctx, page };
}

test('demo challenge: join, sponsor, yield, submit, settle, finalize, claim, verify', async ({ browser }) => {
  const h = chain_helpers();
  const acc = await h.accounts();
  const now = await h.block_time();
  // Generous margins: UI steps take real time and each action mines blocks.
  const join_deadline = now + 900;
  const end_time = now + 1800;

  const meta = {
    version: 1,
    title: 'E2E demo challenge',
    lms: 'demo',
    site: 'demo',
    course_id: 1,
    activities: [
      { kind: 'quiz', instance_id: 1, name: 'Quiz 1', due: end_time },
      { kind: 'assign', instance_id: 2, name: 'Essay 1', due: end_time },
    ],
    min_grade: null,
  };
  const challenge_id = await h.create_demo_challenge(acc, meta, { join_deadline, end_time });
  const id = challenge_id;

  const stake = { a1: 100_000_000n, a2: 200_000_000n, a3: 300_000_000n } as const;
  const who: Record<'a1' | 'a2' | 'a3', Address> = { a1: acc.a1, a2: acc.a2, a3: acc.a3 };
  for (const key of ['a1', 'a2', 'a3'] as const) {
    await h.mint_tusdc(acc, who[key], 1_000_000_000n);
  }
  await h.mint_tusdc(acc, acc.sponsor, 100_000_000n);

  // Each participant joins from the UI. Amount is a decimal string (USDC).
  const amount_text = { a1: '100', a2: '200', a3: '300' } as const;
  for (const key of ['a1', 'a2', 'a3'] as const) {
    const { ctx, page } = await open_as(browser, { address: who[key] });
    await page.goto(`/challenges/${id}`);
    await page.getByLabel(/Số tiền cọc|Stake amount/).fill(amount_text[key]);
    await page.getByRole('button', { name: /^(Tham gia|Join)$/ }).click();
    await h.wait_until(`${key} joined`, async () => (await h.get_challenge(id)).participant_count >= ['a1', 'a2', 'a3'].indexOf(key) + 1);
    await ctx.close();
  }
  expect(Number((await h.get_challenge(id)).participant_count)).toBe(3);

  // Sponsor adds a 30 USDC bonus before end_time, and the deployer funds 60 USDC of vault yield.
  await h.sponsor(acc.sponsor, id, 30_000_000n);
  await h.fund_yield(acc, 60_000_000n, 100n);

  // Link all three to the Demo LMS through the oracle, so demo submissions are recognised.
  for (const key of ['a1', 'a2', 'a3'] as const) {
    await h.link_demo(who[key]);
  }

  await wait_for_wall_clock();

  // Demo submissions for a1 and a2 through the UI. Each click must be confirmed by the oracle's "DEMO · OK".
  for (const key of ['a1', 'a2'] as const) {
    const { ctx, page } = await open_as(browser, { address: who[key] });
    await page.goto(`/challenges/${id}`);
    for (const instance of [1, 2]) {
      await page.getByRole('button', { name: new RegExp(`(Làm bài demo|Submit demo) #${instance}$`) }).click();
      await expect(page.getByText('DEMO · OK')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('progressbar', { name: /Bài đủ điều kiện|Eligible submissions/ })).toHaveAttribute('aria-valuenow', String(instance));
    }
    await ctx.close();
  }

  // Past end_time, the oracle settles.
  await set_time(end_time + 1);
  await h.run_oracle_cron();
  const settled = await h.get_challenge(id);
  expect(settled.completed_count).toBe(2);
  expect(settled.completed_stake).toBe(300_000_000n);

  // Past the dispute window, a third party finalizes from the UI.
  await set_time(Number(settled.settled_at) + Number(settled.dispute_window) + 1);
  {
    const { ctx, page } = await open_as(browser, { address: acc.sponsor });
    await page.goto(`/challenges/${id}`);
    await page.getByRole('button', { name: /^(Chốt kết quả|Finalize)$/ }).click();
    await h.wait_until('challenge finalized', async () => (await h.get_challenge(id)).status === 4);
    await ctx.close();
  }

  const final = await h.get_challenge(id);
  // Reward pot = final yield + bonus, so it must be positive. The shares: a1 100/300, a2 200/300 of the pot.
  expect(final.reward_pot).toBeGreaterThan(0n);
  const pot = final.reward_pot;
  const expected_reward = { a1: (pot * 100_000_000n) / 300_000_000n, a2: (pot * 200_000_000n) / 300_000_000n };

  // Claims through the UI, then on-chain assertions per explicit address.
  const before = { a1: await h.token_balance(who.a1), a2: await h.token_balance(who.a2), a3: await h.token_balance(who.a3) };
  for (const key of ['a1', 'a2', 'a3'] as const) {
    const { ctx, page } = await open_as(browser, { address: who[key] });
    await page.goto(`/challenges/${id}`);
    await page.getByRole('button', { name: /^(Nhận tiền|Claim)$/ }).click();
    await h.wait_until(`${key} claimed`, () => h.is_claimed(id, who[key]));
    await ctx.close();
  }

  const after = { a1: await h.token_balance(who.a1), a2: await h.token_balance(who.a2), a3: await h.token_balance(who.a3) };
  // a1 and a2 receive principal + reward (within 2 wei), a3 receives principal only.
  const delta = (k: 'a1' | 'a2' | 'a3') => after[k] - before[k];
  expect(delta('a1') - stake.a1 - expected_reward.a1).toBeLessThanOrEqual(2n);
  expect(delta('a1') - stake.a1 - expected_reward.a1).toBeGreaterThanOrEqual(-2n);
  expect(delta('a2') - stake.a2 - expected_reward.a2).toBeLessThanOrEqual(2n);
  expect(delta('a2') - stake.a2 - expected_reward.a2).toBeGreaterThanOrEqual(-2n);
  expect(delta('a3')).toBe(stake.a3);

  // Badges: a1 and a2 have one each, a3 none.
  expect(await h.badge_balance(who.a1)).toBe(1n);
  expect(await h.badge_balance(who.a2)).toBe(1n);
  expect(await h.badge_balance(who.a3)).toBe(0n);

  // /me for a1 shows the badge. /verify shows the evidence matching on chain.
  {
    const { ctx, page } = await open_as(browser, { address: who.a1 });
    await page.goto('/me');
    await expect(page.getByText(/Huy hiệu|Badge/).first()).toBeVisible({ timeout: 60_000 });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/challenges/${id}`);
    await page.getByRole('button', { name: /Xem lại lượt nộp|Replay submissions/ }).click();
    const replay = page.getByRole('progressbar', { name: /Tiến độ phát lại|Playback progress/ });
    await expect(replay).toHaveAttribute('aria-valuenow', '0');
    for (const count of [1, 2]) {
      await page.getByRole('button', { name: /Mốc tiếp|Next event/ }).click();
      await expect(replay).toHaveAttribute('aria-valuenow', String(count));
    }
    await page.getByRole('link', { name: /Xác minh kết quả|Verify result/ }).click();
    await expect(page.getByText(/Khớp với on-chain|Matches on-chain/).first()).toBeVisible({ timeout: 60_000 });
    await ctx.close();
  }
});
