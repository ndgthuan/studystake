// The verify page against a credential made by the oracle's own issue_credential, so this fails if the web and the oracle
// ever disagree. Anvil's account 1 holds ORACLE_ROLE on the E2E deployment. Its key is public and only signs test data.
import { test, expect, type Page } from '@playwright/test';
import { keccak256, toBytes } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import type { Credential, SignedCredential } from '../../src/lib/credential';
import { ADDRS } from './chain';

const ORACLE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const SITE = 'https://courses.ctda.hcmus.edu.vn';
const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const STATS = { streak: 3, best_streak: 5, total_completed: 7, total_failed: 1 };
// A path in a variable, so tsc does not pull the Worker's sources and types into the web project.
const ORACLE_CREDENTIAL_MODULE = '../../../oracle/src/credential.ts';

interface LinkRecord {
  wallet: string;
  lms: Credential['lms'];
  site: string;
  userid: number;
  subject_hash: string;
  token_enc: null;
}

function link_of(lms: LinkRecord['lms'], site: string): LinkRecord {
  return { wallet: WALLET.toLowerCase(), lms, site, userid: 12345, subject_hash: keccak256(toBytes(`${site}|12345`)), token_enc: null };
}

async function issue(overrides: { key?: `0x${string}`; link?: LinkRecord; now?: number; chain_id?: number } = {}): Promise<SignedCredential & { signer: string }> {
  const { issue_credential } = (await import(ORACLE_CREDENTIAL_MODULE)) as { issue_credential: (params: unknown) => Promise<SignedCredential & { signer: string }> };
  return issue_credential({
    link: overrides.link ?? link_of('moodle', SITE),
    stats: STATS,
    now_seconds: overrides.now ?? Math.floor(Date.now() / 1000),
    chain_id: overrides.chain_id ?? 31337,
    manager: ADDRS.manager,
    oracle_private_key: overrides.key ?? ORACLE_KEY,
  });
}

const verdict = (page: Page) => page.getByRole('status');
const check_button = (page: Page) => page.getByRole('button', { name: /^(Kiểm tra|Check)$/ });

async function submit(page: Page, value: unknown) {
  await page.getByLabel(/Dán chứng nhận|Paste the credential/).fill(typeof value === 'string' ? value : JSON.stringify(value));
  await check_button(page).click();
}

test.describe('credential verify page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/credential/verify');
    await expect(check_button(page)).toBeDisabled();
  });

  test('accepts a credential from the oracle, with no wallet connected', async ({ page }) => {
    await submit(page, { ...(await issue()), transaction: `0x${'ab'.repeat(32)}` });
    await expect(verdict(page)).toHaveText(/Chứng nhận hợp lệ|Credential is valid/, { timeout: 30_000 });
    await expect(page.getByText(/Đúng trường cần đối chiếu|Matches the expected school/)).toBeVisible();
    await expect(page.locator('dd', { hasText: WALLET })).toBeVisible();
  });

  test('rejects a tampered credential', async ({ page }) => {
    const signed = await issue();
    await submit(page, { ...signed, credential: { ...signed.credential, streak: 99 } });
    await expect(verdict(page)).toHaveText(/không hợp lệ|not valid/, { timeout: 30_000 });
    // Nothing unsigned may look like a fact: no school match, no details, no numbers.
    await expect(page.getByText(/Đúng trường cần đối chiếu|Matches the expected school/)).toHaveCount(0);
    await expect(page.locator('dd')).toHaveCount(0);
    await expect(page.locator('table')).toHaveCount(0);
  });

  test('rejects a credential from a key without ORACLE_ROLE, even if it names the real signer', async ({ page }) => {
    const real = await issue();
    const forged = await issue({ key: generatePrivateKey() });
    await submit(page, { ...forged, signer: real.signer });
    await expect(verdict(page)).toHaveText(/không hợp lệ|not valid/, { timeout: 30_000 });
  });

  test('rejects a credential for another chain', async ({ page }) => {
    await submit(page, await issue({ chain_id: 43114 }));
    await expect(verdict(page)).toHaveText(/không hợp lệ|not valid/, { timeout: 30_000 });
  });

  test('calls an old credential expired', async ({ page }) => {
    await submit(page, await issue({ now: Math.floor(Date.now() / 1000) - 8 * 24 * 3600 }));
    await expect(verdict(page)).toHaveText(/đã hết hạn|has expired/, { timeout: 30_000 });
  });

  test('warns about a demo credential and another school', async ({ page }) => {
    await submit(page, await issue({ link: link_of('demo', 'demo') }));
    await expect(verdict(page)).toHaveText(/Chứng nhận hợp lệ|Credential is valid/, { timeout: 30_000 });
    await expect(page.getByText(/từ Demo LMS|from the Demo LMS/)).toBeVisible();
    await expect(page.getByText(/Không khớp trường|Does not match the expected school/)).toBeVisible();
  });

  test('explains input it cannot read, and clears a result when the input changes', async ({ page }) => {
    await submit(page, 'hello');
    await expect(page.getByText(/không phải JSON|not JSON/)).toBeVisible();

    await submit(page, await issue());
    await expect(verdict(page)).toHaveText(/Chứng nhận hợp lệ|Credential is valid/, { timeout: 30_000 });
    await page.getByLabel(/Dán chứng nhận|Paste the credential/).press('End');
    await page.getByLabel(/Dán chứng nhận|Paste the credential/).pressSequentially(' ');
    await expect(verdict(page)).toHaveCount(0);
  });
});
