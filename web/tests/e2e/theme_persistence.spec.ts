// Saved theme and language must apply on page load and follow the toggles. Needs only the web server on port 3000, no
// chain or oracle: npx playwright test theme_persistence
//
// The Privy tests at the end run only when NEXT_PUBLIC_PRIVY_APP_ID is set, for both the build and this command. Privy's
// server is stubbed, so any 25-character value works: cl0placeholder00000000000
import { test, expect, type Page } from '@playwright/test';
import { install_stub_wallet, stub_privy_server } from './privy_stub';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const PRIVY_LIGHT_BACKGROUND = '#FFFFFF';

const THEMES = [
  { saved: 'light', background: 'rgb(255, 255, 255)', icon: '☾', color: '#ffffff' },
  { saved: 'dark', background: 'rgb(0, 0, 0)', icon: '☀', color: '#000000' },
] as const;

const theme_button = (page: Page) => page.getByRole('button', { name: /^(Sáng\/Tối|Light\/Dark)$/ });
const lang_button = (page: Page) => page.getByRole('button', { name: 'language' });
const body_background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const html_lang = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('lang'));

/** All theme-color tags, not just the first, so a duplicate added during hydration or navigation fails the test. */
const theme_colors = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute('content')),
  );

/** Sets localStorage before any page script runs, on this and every later navigation. */
async function save_prefs(page: Page, prefs: Record<string, string>): Promise<void> {
  await page.addInitScript((p) => {
    for (const [key, value] of Object.entries(p)) window.localStorage.setItem(key, value);
  }, prefs);
}

/** Collects React hydration failures. Production builds report them as minified errors 418, 423 and 425. */
function watch_hydration_errors(page: Page): string[] {
  const errors: string[] = [];
  const record = (text: string) => {
    if (/hydrat|Minified React error #(418|423|425)/i.test(text)) errors.push(text);
  };
  page.on('pageerror', (e) => record(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') record(m.text());
  });
  return errors;
}

/** Fails the requests for the app's bundles, so only the HTML and its inline scripts run and React never hydrates. */
async function block_app_scripts(page: Page): Promise<void> {
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
}

/** A click before hydration does nothing, and the toggle shows no outward sign of being ready, so ask React. */
async function wait_for_hydration(page: Page): Promise<void> {
  await theme_button(page).waitFor();
  await theme_button(page).evaluate(
    (button) =>
      new Promise<void>((resolve) => {
        const check = () =>
          Object.keys(button).some((k) => k.startsWith('__reactProps')) ? resolve() : requestAnimationFrame(check);
        check();
      }),
  );
}

/** Client-side navigation through the header link, so the root layout stays mounted and Next swaps only the page. */
async function go_to_challenges(page: Page): Promise<void> {
  await page.locator('header a[href="/challenges"]').click();
  await page.waitForURL('**/challenges');
  await expect(page.locator('main')).not.toBeEmpty();
}

for (const { saved, background, icon, color } of THEMES) {
  test(`saved ${saved} theme applies on load and the toggle matches`, async ({ page }) => {
    const hydration_errors = watch_hydration_errors(page);
    await save_prefs(page, { ss_theme: saved });
    await page.goto('/');

    await expect(theme_button(page)).toHaveText(icon);
    await wait_for_hydration(page);
    expect(await body_background(page)).toBe(background);
    expect(await theme_colors(page)).toEqual([color]);
    expect(hydration_errors).toEqual([]);
  });

  test(`saved ${saved} theme is in place before React hydrates`, async ({ page }) => {
    await block_app_scripts(page);
    await save_prefs(page, { ss_theme: saved });
    await page.goto('/');

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(saved);
    expect(await body_background(page)).toBe(background);
    expect(await theme_colors(page)).toEqual([color]);
  });
}

test('toggling the theme survives a reload, in both directions', async ({ page }) => {
  await page.goto('/');
  await wait_for_hydration(page);

  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☾');
  await page.reload();
  await expect(theme_button(page)).toHaveText('☾');
  expect(await body_background(page)).toBe('rgb(255, 255, 255)');

  await wait_for_hydration(page);
  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☀');
  await page.reload();
  await expect(theme_button(page)).toHaveText('☀');
  expect(await body_background(page)).toBe('rgb(0, 0, 0)');
});

test('the browser UI color follows the toggle, in both directions, and survives a reload', async ({ page }) => {
  await page.goto('/');
  await wait_for_hydration(page);
  expect(await theme_colors(page)).toEqual(['#000000']);

  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☾');
  expect(await theme_colors(page)).toEqual(['#ffffff']);
  await page.reload();
  await wait_for_hydration(page);
  expect(await theme_colors(page)).toEqual(['#ffffff']);

  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☀');
  expect(await theme_colors(page)).toEqual(['#000000']);
  await page.reload();
  await wait_for_hydration(page);
  expect(await theme_colors(page)).toEqual(['#000000']);
});

test('a color set by the toggle stays right after moving to another page', async ({ page }) => {
  await page.goto('/');
  await wait_for_hydration(page);

  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☾');
  await go_to_challenges(page);
  expect(await theme_colors(page)).toEqual(['#ffffff']);

  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☀');
  expect(await theme_colors(page)).toEqual(['#000000']);
});

test('a saved color stays right after moving to another page', async ({ page }) => {
  await save_prefs(page, { ss_theme: 'light' });
  await page.goto('/');
  await wait_for_hydration(page);

  await go_to_challenges(page);
  expect(await theme_colors(page)).toEqual(['#ffffff']);

  await theme_button(page).click();
  await expect(theme_button(page)).toHaveText('☀');
  expect(await theme_colors(page)).toEqual(['#000000']);
});

test('saved language applies without a hydration failure', async ({ page }) => {
  const hydration_errors = watch_hydration_errors(page);
  await save_prefs(page, { ss_lang: 'en', ss_theme: 'light' });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Challenges', exact: true }).first()).toBeVisible();
  await expect(lang_button(page)).toHaveText('VI');
  expect(await html_lang(page)).toBe('en');
  expect(hydration_errors).toEqual([]);
});

test('saved language is on <html> before React hydrates', async ({ page }) => {
  await block_app_scripts(page);
  await save_prefs(page, { ss_lang: 'en' });
  await page.goto('/');

  expect(await html_lang(page)).toBe('en');
});

test('with nothing saved the page is Vietnamese and dark', async ({ page }) => {
  await page.goto('/');
  await wait_for_hydration(page);

  expect(await html_lang(page)).toBe('vi');
  expect(await theme_colors(page)).toEqual(['#000000']);
});

test('unknown saved values fall back to Vietnamese and dark', async ({ page }) => {
  await save_prefs(page, { ss_lang: 'fr', ss_theme: 'sepia' });
  await page.goto('/');
  await wait_for_hydration(page);

  await expect(lang_button(page)).toHaveText('EN');
  expect(await html_lang(page)).toBe('vi');
  expect(await theme_colors(page)).toEqual(['#000000']);
});

test('<html lang> follows the toggle, in both directions, and survives a reload and a page change', async ({ page }) => {
  await page.goto('/');
  await wait_for_hydration(page);
  expect(await html_lang(page)).toBe('vi');

  await lang_button(page).click();
  await expect(lang_button(page)).toHaveText('VI');
  expect(await html_lang(page)).toBe('en');

  await go_to_challenges(page);
  expect(await html_lang(page)).toBe('en');

  await page.reload();
  await wait_for_hydration(page);
  expect(await html_lang(page)).toBe('en');

  await lang_button(page).click();
  await expect(lang_button(page)).toHaveText('EN');
  expect(await html_lang(page)).toBe('vi');
  await page.reload();
  await wait_for_hydration(page);
  expect(await html_lang(page)).toBe('vi');
});

test('unusable localStorage leaves the page dark and raises no error', async ({ page }) => {
  const page_errors: string[] = [];
  page.on('pageerror', (e) => page_errors.push(e.message));
  await block_app_scripts(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('storage denied');
    };
  });
  await page.goto('/');

  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  expect(await body_background(page)).toBe('rgb(0, 0, 0)');
  expect(await html_lang(page)).toBe('vi');
  expect(await theme_colors(page)).toEqual(['#000000']);
  expect(page_errors).toEqual([]);
});

test.describe('with Privy enabled', () => {
  test.skip(!PRIVY_APP_ID, 'needs a build and a test run with NEXT_PUBLIC_PRIVY_APP_ID set');

  const login_button = (page: Page) => page.getByRole('button', { name: /^(Đăng nhập|Log in)$/ });
  const login_modal = (page: Page) => page.locator('#privy-modal-content');
  /** The login modal's background, from the palette Privy derives from appearance.theme. */
  const modal_background = (page: Page) =>
    login_modal(page).evaluate((el) => getComputedStyle(el).getPropertyValue('--privy-color-background'));
  const page_background = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--privy-color-background'));

  test.beforeEach(async ({ page }) => {
    await stub_privy_server(page, PRIVY_APP_ID);
  });

  test('the login modal uses a saved light theme', async ({ page }) => {
    await save_prefs(page, { ss_theme: 'light' });
    await page.goto('/');
    await login_button(page).click();

    await expect(login_modal(page)).toBeVisible();
    expect(await modal_background(page)).toBe(PRIVY_LIGHT_BACKGROUND);
  });

  test('the login modal follows the toggle, in both directions', async ({ page }) => {
    await page.goto('/');
    await wait_for_hydration(page);

    await theme_button(page).click();
    await login_button(page).click();
    await expect(login_modal(page)).toBeVisible();
    expect(await modal_background(page)).toBe(PRIVY_LIGHT_BACKGROUND);

    await page.reload();
    await wait_for_hydration(page);
    await theme_button(page).click();
    await expect(theme_button(page)).toHaveText('☀');
    await login_button(page).click();
    await expect(login_modal(page)).toBeVisible();
    expect(await modal_background(page)).not.toBe(PRIVY_LIGHT_BACKGROUND);
  });

  test('toggling keeps the wallet connected and does not remount the page', async ({ page }) => {
    await install_stub_wallet(page);
    await page.goto('/');

    await login_button(page).click();
    await page.getByText('Continue with a wallet').click();
    await page.getByRole('button', { name: 'Browser Extension' }).click();
    const address = page.locator('header').getByText('0x7099…79C8');
    await expect(address).toBeVisible();
    await expect(login_modal(page)).toBeHidden();

    // A remounted provider would replace everything below it, so this node would no longer be in the page.
    await page.evaluate(() => document.querySelector('main')?.setAttribute('data-test-mounted', 'yes'));
    const still_mounted = () => expect(page.locator('main[data-test-mounted="yes"]')).toHaveCount(1);

    await theme_button(page).click();
    await expect(theme_button(page)).toHaveText('☾');
    await expect.poll(() => page_background(page)).toBe(PRIVY_LIGHT_BACKGROUND);
    await expect(address).toBeVisible();
    await still_mounted();

    await lang_button(page).click();
    await expect(lang_button(page)).toHaveText('VI');
    await expect(address).toBeVisible();
    await still_mounted();

    await theme_button(page).click();
    await expect(theme_button(page)).toHaveText('☀');
    await expect.poll(() => page_background(page)).not.toBe(PRIVY_LIGHT_BACKGROUND);
    await expect(address).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await still_mounted();
  });
});
