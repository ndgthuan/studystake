# StudyStake — Web spec (Phase 3)

Source of truth for `web/`. When in conflict with SPEC.md §6, this file wins.

## Stack
- Next.js 15 App Router, strict TypeScript, Tailwind v4. No separate backend: the web calls contracts directly (viem/wagmi) and the oracle Worker (REST).
- `@privy-io/react-auth` (Google/email login with an embedded wallet) + `@privy-io/wagmi` + `wagmi` v2 + `viem` + `@tanstack/react-query`. Users can still use external wallets (Core, MetaMask).
- Chain: Fuji (43113) and Anvil (31337), selected through the `NEXT_PUBLIC_CHAIN_ID` env. Contract addresses are read from `contracts/deployments/<chain_id>.json`: the `scripts/sync_deployments.mjs` script copies this file to `web/src/generated/deployments.json` and generates the ABI into `web/src/generated/abi.ts`.
- Env: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_ORACLE_URL`, `NEXT_PUBLIC_EXPLORER_URL` (defaults to `https://testnet.snowtrace.io`). Without a Privy App ID it **automatically switches to external wallets only** (wagmi injected), so local runs and E2E tests need no Privy.
- Naming: self-defined functions, variables and fields use `snake_case`. Components use PascalCase; hooks stay `useXxx` following the React convention.

## Design
- Dark mode by default, **pure black background `#000`** (no dark gray), card `#0a0a0a`, border `#1f1f1f`. Avalanche red accent `#E84142`, green `#22c55e` for the "completed" state. Light mode through a toggle.
- Be Vietnam Pro font (Google Fonts) for Vietnamese text, numbers use `tabular-nums`.
- Bilingual vi/en (vi by default), using one simple dictionary file, no heavy i18n library.
- Mobile-first, no horizontal scrollbar at 375px, 44px minimum touch targets.
- Google/Core/MetaMask logos use the **official SVG logos**, no substitute icons.

## Pages
1. `/`: landing. Hero ("Cam kết học, không mất gốc", i.e. "Commit to studying, never lose your principal"), 3 how-it-works steps, real on-chain figures (total USDC staked, number of challenges, number of completers) read from contracts/events, a "Get started" button.
2. `/challenges`: challenge list (reads `challenge_count` + `get_challenge` + metadata from the oracle). Filter by phase; each card shows the name, course, total stake, number of people, countdown and phase badge.
3. `/challenges/[id]`:
   - Info: activities and deadlines, stake range, total stake, reward pool (bonus + yield estimated from `vault.convertToAssets`), vault/token addresses with explorer links.
   - **Join:** enter an amount (min/max), shows the USDC balance. If the token supports permit, sign a permit then send `join_with_permit` (1 transaction), otherwise `approve` + `join`. A button to get tUSDC (`faucet()`) when using tUSDC.
   - **Progress:** For Moodle, a wallet signature opens a private session for `GET /progress/:id/:wallet`. The checklist shows recorded and eligible submissions separately and explains a submission that missed a rule. Demo challenges still have a "Submit demo" button (signs a message then calls `POST /demo/submit`).
   - **After the end:** phase badge, evidence link (`/verify/[id]`). During the dispute window there is a dispute button (enter a reason, send its `keccak` to `dispute`).
   - **Claim:** `preview_claim` shows principal and reward. Gets the proof from `GET /proof/:id/:account`, sends `claim(id, completed, proof)` with estimated `gas` plus a margin (mind `InsufficientGas`). Finalize/expire buttons appear when the phase is `Finalizable`/`Expirable` (anyone can press them).
4. `/me`: stakes (scans the wallet's `Joined` events), the state of each stake, quick claim, badge (reads `tokenURI`, renders the on-chain SVG), streak, current LMS link.
5. `/link`: Moodle link (guide to getting the token, a **consent** screen explaining the token risk and how to revoke it), signs a `link_message` identical to the oracle's. Demo LMS option. An unlink button.
6. `/verify/[id]`: loads the evidence, recomputes `keccak(canonical_json)` in the browser and compares it with the on-chain `evidence_hash`, rebuilds the root from `tree` and compares it with the on-chain `root`, shows a participant table (shortened wallet, completed, reason). Anyone can check without trusting the oracle.
7. `/admin` (only shown when the wallet has `CREATOR_ROLE`/`GUARDIAN_ROLE`): challenge creation form (metadata → signed `POST /metadata` → `create_challenge`), sponsor, pause/unpause, resolve dispute.

## Transaction UX (mandatory)
- One shared `use_tx` hook, with these states: `idle → signing → pending (hash + explorer link) → confirmed | error`. Uses `simulateContract` before sending to catch errors early.
- Maps contract custom errors (decoded with the ABI) to plain Vietnamese sentences, for example `TooLate` → "Đã quá hạn tham gia" ("The join deadline has passed").
- Pre-checks: wrong network shows a switch button; missing AVAX gas shows a gas button (oracle `/faucet` with the Privy JWT, or a faucet link); missing USDC shows a faucet link.
- After a transaction is confirmed, invalidate related queries.
- All strings from metadata/evidence render as plain text (no `dangerouslySetInnerHTML`). The badge SVG alone renders through `<img src="data:...">`.

## Testing (Definition of Done)
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass.
- Unit tests with vitest: error mapping, `canonical_json` (must give results identical to the oracle's, tested with the same fixture), evidence verification, USDC number formatting.
- **Playwright E2E on Anvil** (`npm run e2e`): starts anvil, deploys, runs the oracle with `wrangler dev --local` (or calls the oracle module through a small Node server), web `next start`. Uses an injected wallet (a fake EIP-1193 provider signing with an Anvil private key) to join, submit demos, advance time, run cron settle (call the oracle test endpoint or run the job), finalize, claim. Checks displayed balances and the badge.
- Screenshot each page at 375px and 1280px, both dark and light, saved in `web/screenshots/`.
