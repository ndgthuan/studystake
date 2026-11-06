// Captures every page at 375px and 1280px, in dark and light theme, into web/screenshots/.
// Needs the E2E stack running (Anvil 8545, oracle dev server 8788, next start 3000) and at least one challenge
// on chain, so pages show real data. Uses the same injected test wallet as the E2E for account-specific pages.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web_root = resolve(here, '..');
const out_dir = join(web_root, 'screenshots');
mkdirSync(out_dir, { recursive: true });

const BASE = 'http://127.0.0.1:3000';
const SS_LANG = process.env.SS_LANG ?? 'en';
const CHALLENGE_ID = process.env.CHALLENGE_ID ?? '1';
const VERIFY_ID = process.env.VERIFY_ID ?? CHALLENGE_ID;
// Participant a1 (Anvil account index 4): has a stake, a completed claim and a badge after the E2E run.
// Address only; the wallet provider forwards signing to the unlocked Anvil account.
const A1 = { address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' };
const RPC = 'http://127.0.0.1:8545';

const routes = [
  { name: 'landing', path: '/', wallet: false },
  { name: 'challenges', path: '/challenges', wallet: false },
  { name: 'challenge_detail', path: `/challenges/${CHALLENGE_ID}`, wallet: true },
  { name: 'me', path: '/me', wallet: true },
  { name: 'link', path: '/link', wallet: true },
  { name: 'verify', path: `/verify/${VERIFY_ID}`, wallet: false },
  { name: 'admin', path: '/admin', wallet: true },
];
const viewports = [
  { tag: '375', width: 375, height: 812 },
  { tag: '1280', width: 1280, height: 900 },
];
const themes = ['dark', 'light'];

/** Mirrors the E2E injected wallet, forwarding to Anvil with the account address. Runs in the page. */
function wallet_init_script({ acct, rpc_url }) {
  {
    let id = 1;
    async function call(method, params = []) {
      const res = await fetch(rpc_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.result;
    }
    const provider = {
      isInjectedTestWallet: true,
      selectedAddress: acct.address,
      chainId: '0x7a69',
      request: async ({ method, params = [] }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acct.address];
        if (method === 'eth_sendTransaction') return call('eth_sendTransaction', [{ ...params[0], from: acct.address }]);
        if (method === 'personal_sign') return call('personal_sign', [params[0], acct.address]);
        if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
          return call('eth_signTypedData_v4', [acct.address, typeof params[1] === 'string' ? params[1] : JSON.stringify(params[1])]);
        }
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        return call(method, params);
      },
      on() {
        return provider;
      },
      removeListener() {
        return provider;
      },
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  }
}

const browser = await chromium.launch();
const failures = [];
let count = 0;
try {
  for (const vp of viewports) {
    for (const theme of themes) {
      for (const route of routes) {
        const ctx = await browser.newContext({
          baseURL: BASE,
          viewport: { width: vp.width, height: vp.height },
          colorScheme: theme,
        });
        // The app reads its language from localStorage 'ss_lang' ('vi' | 'en') right after hydrating.
        await ctx.addInitScript(
          (lang) => {
            try {
              window.localStorage.setItem('ss_lang', lang);
            } catch {
              // storage unavailable: app falls back to its default language
            }
          },
          SS_LANG,
        );
        const page = await ctx.newPage();
        if (route.wallet) {
          await page.addInitScript(wallet_init_script, { acct: A1, rpc_url: RPC });
        }
        try {
          await page.goto(route.path, { waitUntil: 'networkidle', timeout: 60_000 });
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await page.waitForTimeout(800);
          const file = join(out_dir, `${route.name}_${vp.tag}_${theme}.png`);
          await page.screenshot({ path: file, fullPage: true });
          count += 1;
          console.log(`saved ${file}`);
        } catch (err) {
          failures.push(`${route.name} ${vp.tag} ${theme}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          await ctx.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`screenshots written: ${count}`);
if (failures.length > 0) {
  console.log('failures:');
  for (const f of failures) console.log(' ', f);
  process.exitCode = 1;
}
