// Saved theme and language must apply on page load. Needs only the web server on port 3000, no chain or oracle:
// npx playwright test theme_persistence
import { test, expect, type Page } from '@playwright/test';

const THEMES = [
  { saved: 'light', background: 'rgb(255, 255, 255)', icon: '☾' },
  { saved: 'dark', background: 'rgb(0, 0, 0)', icon: '☀' },
] as const;

const theme_button = (page: Page) => page.getByRole('button', { name: /^(Sáng\/Tối|Light\/Dark)$/ });
const body_background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

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

for (const { saved, background, icon } of THEMES) {
  test(`saved ${saved} theme applies on load and the toggle matches`, async ({ page }) => {
    const hydration_errors = watch_hydration_errors(page);
    await save_prefs(page, { ss_theme: saved });
    await page.goto('/');

    await expect(theme_button(page)).toHaveText(icon);
    expect(await body_background(page)).toBe(background);
    expect(hydration_errors).toEqual([]);
  });

  test(`saved ${saved} theme is in place before React hydrates`, async ({ page }) => {
    await block_app_scripts(page);
    await save_prefs(page, { ss_theme: saved });
    await page.goto('/');

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(saved);
    expect(await body_background(page)).toBe(background);
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

test('saved language applies without a hydration failure', async ({ page }) => {
  const hydration_errors = watch_hydration_errors(page);
  await save_prefs(page, { ss_lang: 'en', ss_theme: 'light' });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Challenges', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'language' })).toHaveText('VI');
  expect(hydration_errors).toEqual([]);
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
  expect(page_errors).toEqual([]);
});
