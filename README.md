<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cover-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/cover-light.svg">
    <img src="assets/cover-light.svg" alt="StudyStake course challenges and verifiable results." width="100%">
  </picture>
</p>

<p align="center">
  <b><a href="#why-studystake">Why</a></b> &nbsp;·&nbsp;
  <b><a href="#features">Features</a></b> &nbsp;·&nbsp;
  <b><a href="#how-it-works">How it works</a></b> &nbsp;·&nbsp;
  <b><a href="#product-tour">Product tour</a></b> &nbsp;·&nbsp;
  <b><a href="#guarantees">Guarantees</a></b> &nbsp;·&nbsp;
  <b><a href="#quick-start">Quick start</a></b>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-0e6ba8?style=flat"></a>
  <img alt="Avalanche" src="https://img.shields.io/badge/Avalanche-E84142?style=flat&logo=avalanche&logoColor=white">
  <img alt="369 contract and unit tests passing" src="https://img.shields.io/badge/tests-369%20passing-2EA44F?style=flat">
  <img alt="Network: live on Fuji" src="https://img.shields.io/badge/network-live%20on%20Fuji-E84142?style=flat">
  <img alt="UniHack 2026" src="https://img.shields.io/badge/UniHack-2026-E84142?style=flat">
</p>

<p align="center">
  Part of <b>Team1 Vietnam UniHack 2026</b> on Avalanche. &nbsp;·&nbsp;
  Specs: <a href="docs/SPEC.md">Spec</a> · <a href="docs/THREAT_MODEL.md">Threat model</a> · <a href="docs/CONTRACTS.md">Contracts</a> · <a href="docs/ORACLE.md">Oracle</a> · <a href="docs/WEB.md">Web</a> · <a href="docs/X402.md">x402 Credential</a>
</p>

---

## Why StudyStake

Open the [public Moodle pilot result on Avalanche Fuji](https://studystake-puce.vercel.app/verify/2) to check the evidence hash and Merkle root in your browser. Round #2 recorded one completion from one participant and a reward pool of 10 test USDC. The participant claimed their payout.

Students miss Moodle quizzes and assignment deadlines. Reminder apps are easy to ignore. Betting-style commitment apps such as StickK and Beeminder add real stakes, but they feel like gambling, and losing real money puts many people off trying them.

StudyStake takes a different route. A student stakes an amount within the challenge's displayed range. One example is the CSC10002 quiz challenge for weeks 10 to 12. Finishing the work earns a share of the pool's yield and sponsor bonus. All participants can claim their principal after finalization, subject to any loss in the underlying vault.

Stakes, yield shares, and proofs are settled through a Merkle root on Avalanche, so anyone can verify the payout math instead of trusting a company that holds the money.

## Features

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/feature-noloss-dark.svg">
        <source media="(prefers-color-scheme: light)" srcset="assets/feature-noloss-light.svg">
        <img src="assets/feature-noloss-light.svg" alt="Stake flows into a yield vault and returns with yield" width="100%">
      </picture>
      <h3>No-loss staking</h3>
      <p>Your stake sits in an ERC-4626 yield vault. Missing a deadline affects your share of yield and bonuses. Principal is available to claim even after a missed deadline, subject to any vault loss.</p>
    </td>
    <td align="center" valign="top" width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/feature-oracle-dark.svg">
        <source media="(prefers-color-scheme: light)" srcset="assets/feature-oracle-light.svg">
        <img src="assets/feature-oracle-light.svg" alt="A Merkle tree with a verified root" width="100%">
      </picture>
      <h3>Verifiable oracle</h3>
      <p>The oracle posts a Merkle root and an evidence hash on-chain. Anyone can re-check the evidence in the browser.</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/feature-streaks-dark.svg">
        <source media="(prefers-color-scheme: light)" srcset="assets/feature-streaks-light.svg">
        <img src="assets/feature-streaks-light.svg" alt="A soulbound badge with a streak number" width="100%">
      </picture>
      <h3>Soulbound streaks</h3>
      <p>A non-transferable ERC-721 badge (ERC-5192) records your completions and streak on-chain. It is yours and cannot be sold.</p>
    </td>
    <td align="center" valign="top" width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/feature-onboarding-dark.svg">
        <source media="(prefers-color-scheme: light)" srcset="assets/feature-onboarding-light.svg">
        <img src="assets/feature-onboarding-light.svg" alt="Privy sign-in, embedded wallet, and permit signature" width="100%">
      </picture>
      <h3>Email sign-in and permit staking</h3>
      <p>Sign in with an email code or connect a wallet. Privy shows the providers enabled for the deployment. Permit-enabled tokens let students submit a single staking transaction.</p>
    </td>
  </tr>
</table>

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/architecture-light.svg">
    <img src="assets/architecture-light.svg" alt="Architecture: web app, oracle, Moodle or demo LMS, and the Avalanche contracts" width="100%">
  </picture>
</p>

**Components**

- **Web app** (`web/`): Next.js App Router with Privy sign-in, wagmi and viem, and a bilingual course notebook. Light mode is the default, with a saved light or dark preference.
- **Oracle** (`oracle/`): Cloudflare Worker in TypeScript. It has a Moodle adapter, a Demo LMS adapter, an evaluator, the Merkle builder, the AVAX faucet, and a cron job that settles challenges.
- **Evidence store:** public evidence JSON in Cloudflare R2. Only its hash goes on-chain, and the evidence contains no names or student IDs.
- **StudyStakeManager** (`contracts/`): holds challenges, stakes, sponsor bonuses, settlement, disputes, and claims.
- **MockYieldVault:** ERC-4626 yield source used on Fuji. Its yield is simulated.
- **StudyBadge:** soulbound ERC-721 streak badge (ERC-5192).

**Lifecycle**

1. **Join.** Sign in or connect a wallet, link Moodle or Demo LMS, and stake within the challenge limit. The app uses `join_with_permit` for permit-enabled tokens and supports approval followed by a join for other tokens.
2. **Submit.** Complete the required quiz or assignment and check your progress on the challenge page. Demo LMS challenges accept demo submissions in the web app.
3. **Settle.** After the end time, the oracle reads submission status, builds the Merkle root of completers, and calls `settle(root, completed_count, completed_stake, evidence_hash)`.
4. **Dispute window.** Anyone who staked can dispute the result during the window (24 hours in production, 10 minutes in the demo). A guardian can then replace the root.
5. **Finalize.** Anyone can call `finalize`. It redeems all vault shares and fixes the reward pot.
6. **Claim.** Each student claims once. Completers receive principal, a yield share, and the reward. The badge is minted on first completion, and the streak goes up by one.

Everyone can claim their share of the vault principal. Only students who completed their work receive a share of the yield and sponsor bonus.

### Payout example

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/payout-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/payout-light.svg">
    <img src="assets/payout-light.svg" alt="Payout bars: Student A 100 to 129.99, Student B 200 to 259.99, Student C 300 with no reward" width="100%">
  </picture>
</p>

*Real numbers from the end-to-end test on local Anvil: 60 USDC simulated yield + 30 USDC sponsor bonus, split pro-rata between completers. Nobody loses principal.*

## Product tour

Open the [CSC10002 Demo LMS challenge on Fuji](https://studystake-puce.vercel.app/challenges/1). You can browse the challenge and its evidence without connecting a wallet. The screenshots below show the course-notebook UI running against the same Fuji round.

<p align="center">
  <img src="web/screenshots/course-notebook-detail.jpg" alt="CSC10002 challenge notebook showing the course deadline, two activities, verified result, and settlement totals" width="100%">
</p>

1. **Browse the course notebook** from the home page or filter the challenge catalog by status.
2. **Open a challenge** to see its deadline, required activities, LMS progress, and settlement slip. The slip distinguishes principal, estimated rewards, and final rewards.
3. **Replay submissions** on a finalized challenge with verified evidence. The replay uses recorded submission times and supports manual stepping with reduced motion.
4. **Verify the result** to compare the evidence hash and Merkle root against Fuji and open the finalization transaction in Snowtrace. [Verification page](https://studystake-puce.vercel.app/verify/1)
5. **Open My stakes** to see in-progress challenges, challenges awaiting settlement, claimable stakes, claim history, and your badge. This page uses the connected wallet. [My stakes](https://studystake-puce.vercel.app/me)

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="web/screenshots/course-notebook-home.jpg" alt="StudyStake home page in the default light theme" width="100%">
      <sub><b>Home.</b> Open the course notebook and see on-chain activity.</sub>
    </td>
    <td align="center" valign="top" width="50%">
      <img src="web/screenshots/course-notebook-verify.jpg" alt="Evidence verification page with matching hashes and a finalization transaction link" width="100%">
      <sub><b>Verify.</b> Compare both commitments and inspect the transaction.</sub>
    </td>
  </tr>
</table>

<details>
  <summary>Mobile challenge view</summary>
  <p align="center"><img src="web/screenshots/course-notebook-mobile.jpg" alt="Mobile layout with the deadline, activities, settlement slip, and result stacked vertically" width="390"></p>
</details>

## Guarantees

The core guarantee: even if the oracle, creator, guardian, or admin is compromised, users can still withdraw their principal, unless the yield vault itself takes a loss.

1. **Principal is always withdrawable.** No admin function can withdraw principal. Vault losses are shared pro rata, see [`StudyStakeManager.t.sol`](contracts/test/StudyStakeManager.t.sol).
2. **`claim` and `expire` are never paused.** Pause blocks only `join` and `settle`, see [`StudyStakeManager.t.sol`](contracts/test/StudyStakeManager.t.sol).
3. **The oracle cannot move principal.** It only sets the reward split, and an under-reported stake is still capped by the reward pot, see [`StudyStakeManager.t.sol`](contracts/test/StudyStakeManager.t.sol).
4. **Rewards are capped by the pot.** Total rewards paid never exceed `reward_pot`, and only unclaimed rewards are swept to the treasury after 180 days, see [`StudyStakeManager.t.sol`](contracts/test/StudyStakeManager.t.sol).
5. **One claim per address.** A second `claim` reverts with `AlreadyClaimed`, see [`StudyStakeManager.t.sol`](contracts/test/StudyStakeManager.t.sol).

Invariant and fuzz coverage: [`StudyStakeFuzz.t.sol`](contracts/test/StudyStakeFuzz.t.sol) and [`invariant/`](contracts/test/invariant/).

Full threat list and residual risks: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Avalanche integration

- [x] **ERC-4626 yield vault.** `MockYieldVault` is the yield source. Its yield is simulated on testnet.
- [x] **Merkle settlement with evidence hash.** The oracle posts a root plus a hash of public evidence, so results are auditable without names or student IDs.
- [x] **Soulbound badge (ERC-721 + ERC-5192).** Completion streaks are on-chain and non-transferable.
- [x] **Live on Fuji.** Contracts, oracle and web have public endpoints. The first tUSDC round reached claim. See [Live on Fuji](#live-on-fuji).
- [ ] **One-transaction stake via EIP-2612 `permit`.** The Circle USDC path passed a Fuji-fork browser test. Public Fuji verification needs a `join_with_permit` receipt from the web flow and a check that no separate approval was sent.
- **AVAX gas faucet for new users.** The repository configures a 0.001 AVAX grant for eligible Fuji wallets. The web shows the confirmed transfer when the faucet succeeds. See the [Fuji runbook](docs/DEPLOY_FUJI.md).
- [x] **Privy email sign-in and embedded wallet.** An email-code sign-in and session restore were verified on the live site.
- [ ] **Google sign-in on public Fuji.** The live sign-in button opens the Google account chooser. The callback and restored wallet session still need an end-to-end check with an authorized Google account.
- [ ] **Aave V3 adapter.** A join-to-claim lifecycle with real StataToken yield passed on a local C-Chain mainnet fork. The public app on Fuji uses simulated yield.
- [ ] **x402 Study Credential API.** Paid endpoint and verification UI implemented. Circle USDC settlement has passed on a local Fuji fork. A public Fuji payment and Snowtrace receipt are pending.
- [ ] **StudyNet L1 for the school (ICM, Builder Console).** Roadmap, not started.
- [ ] **zkTLS (Reclaim or TLSNotary) to replace the trusted oracle.** Roadmap, not started.

## Why Avalanche

- **C-Chain settlement.** The Fuji [100 tUSDC join receipt](https://testnet.snowtrace.io/tx/0xbec2d81e11e5b39de4653a4a4320483102d3e5173f0acaee009b1cc2157c3476) used 283,023 gas at 155 wei per gas, costing 43,868,565 wei of test AVAX. This records the fee for that transaction; gas prices vary.
- **Native Circle USDC and EIP-3009.** The buyer signs a payment authorization and a facilitator submits the transfer, so an x402 buyer can pay with USDC without holding AVAX for that transaction. The [x402 fork check](oracle/scripts/x402_fork_check.mjs) verifies the exact treasury payment and the credential signer.
- **Public evidence.** The browser recalculates the evidence hash and Merkle root for [challenge #1](https://studystake-puce.vercel.app/verify/1) and compares both with the commitments on Fuji. The same round links each step through to [claim and badge mint](https://testnet.snowtrace.io/tx/0x4a877c95516d2bc0b8daf38a068fa611c40781e68b0b7d54a92e9e833d1f092c).

## Live on Fuji

- **Web:** <https://studystake-puce.vercel.app>
- **Oracle:** <https://studystake-oracle.qalert-7k3m9x.workers.dev/health>
- **Contracts** (all verified, deploy block 61216349):

| Contract | Address |
|---|---|
| StudyStakeManager | [`0xe642306aBB4bD8BB452B3089aCD84960F88B9786`](https://testnet.snowtrace.io/address/0xe642306aBB4bD8BB452B3089aCD84960F88B9786) |
| StudyBadge | [`0xBC4F2CC0Ad719Bd172EF1E82cF8081311754aaD3`](https://testnet.snowtrace.io/address/0xBC4F2CC0Ad719Bd172EF1E82cF8081311754aaD3) |
| MockYieldVault (Circle USDC) | [`0x0993638f443d14511fCa9109c80DcE537860a8D7`](https://testnet.snowtrace.io/address/0x0993638f443d14511fCa9109c80DcE537860a8D7) |
| TestUSDC | [`0x5e03D1D6067BbC411f312fA833c0F9B7a22b4D9b`](https://testnet.snowtrace.io/address/0x5e03D1D6067BbC411f312fA833c0F9B7a22b4D9b) |
| MockYieldVault (tUSDC) | [`0x93665BE40a8D2686A08197a9F7a55624c3360679`](https://testnet.snowtrace.io/address/0x93665BE40a8D2686A08197a9F7a55624c3360679) |

### Real transactions: challenge #1

Two students staked tUSDC. Student A finished both demo activities, student B finished none. A 20 tUSDC sponsor bonus and 10 tUSDC of simulated yield made a reward pot of 29.999999 tUSDC. Evidence check: [`/verify/1`](https://studystake-puce.vercel.app/verify/1).

| Step | Who | Tx |
|---|---|---|
| Create challenge | Creator | [`0xd4ca1de7…`](https://testnet.snowtrace.io/tx/0xd4ca1de7f0400ae3bc7c0049aeb2fa1ef2935663b157447f376092a3021197ca) |
| Join, 100 tUSDC | Student A | [`0xbec2d81e…`](https://testnet.snowtrace.io/tx/0xbec2d81e11e5b39de4653a4a4320483102d3e5173f0acaee009b1cc2157c3476) |
| Join, 50 tUSDC | Student B | [`0xe9db568e…`](https://testnet.snowtrace.io/tx/0xe9db568ec7d14231f20a95c173e765b6f9d866c9ee683c11e49370e6983c5971) |
| Sponsor bonus, 20 tUSDC | Sponsor | [`0x65710c0b…`](https://testnet.snowtrace.io/tx/0x65710c0b20b4c1333acb6971d1c988206557675ed66f184b500591e3840c551d) |
| Fund simulated yield, 10 tUSDC | Vault owner | [`0x8f51d56e…`](https://testnet.snowtrace.io/tx/0x8f51d56e50ac79b2d268038663b1d31af326bb66ce6387e90eb8e6c753b7332f) |
| Settle (Merkle root + evidence hash) | Oracle cron | [`0x1ed49d83…`](https://testnet.snowtrace.io/tx/0x1ed49d830effbec395b65c9912a6505ac62aca5f0728c891cc7b539cbd16f2f1) |
| Finalize | Anyone | [`0xa9d588a0…`](https://testnet.snowtrace.io/tx/0xa9d588a0672c28708fd95c128e6774e95330605ca336bd1230a775959009c5a0) |
| Claim: 129.999999 tUSDC + badge | Student A | [`0x4a877c95…`](https://testnet.snowtrace.io/tx/0x4a877c95516d2bc0b8daf38a068fa611c40781e68b0b7d54a92e9e833d1f092c) |
| Claim: 50 tUSDC, full principal | Student B | [`0x151d773f…`](https://testnet.snowtrace.io/tx/0x151d773f6bbfd8cd647d47ab6cd15a77e5e983e5e22d345b75d84fe2d6d506b2) |

## Quality

| Component | Tests | Command |
|---|---|---|
| Contracts (Foundry) | 92, including fuzz and invariant. `StudyStakeManager` at about 98% line coverage. | `forge test` |
| Oracle (Cloudflare Worker) | 192 Vitest tests plus E2E on Anvil and x402 on a Fuji fork | `npm test`, `npm run e2e:anvil` |
| Web (Next.js) | 85 Vitest tests plus Playwright E2E on Anvil and a Fuji fork | `npm test`, `npm run e2e`, `npm run e2e:fork:run` |
| **Total** | **369** contract and unit tests | |

> [!NOTE]
> Honesty notes:
> - Automated transaction tests run on local Anvil and forks. Public Fuji evidence is available for the [Demo LMS round](https://studystake-puce.vercel.app/verify/1) and the [Moodle pilot](https://studystake-puce.vercel.app/verify/2).
> - **Yield is simulated** on testnet by `MockYieldVault`. It is not real market yield.
> - **The documented Fuji round used test wallets.** Email sign-in and session restore were verified separately. Google sign-in depends on the deployment’s Privy settings.
> - Rewards depend on an honest oracle until zkTLS replaces it.

## Quick start

1. **Clone with submodules.** Foundry dependencies live in `contracts/lib/`.

   ```bash
   git clone --recurse-submodules https://github.com/ndgthuan/studystake.git
   cd studystake
   ```

   If you already cloned without submodules, run `git submodule update --init --recursive`.

2. **Run the contract tests.**

   ```bash
   cd contracts
   forge test
   ```

3. **Run the oracle tests.**

   ```bash
   cd oracle
   npm i
   npm test
   npm run e2e:anvil
   ```

   To start the Worker, create `oracle/.dev.vars` from `oracle/.dev.vars.example`, then run `npm run dev`. This file is git-ignored and must never be committed.

4. **Start the web app.**

   ```bash
   cd web
   npm i --legacy-peer-deps
   npm run sync      # copy deployment addresses into web
   npm run dev
   ```

   Create `web/.env.local` with the public chain, RPC, oracle and optional Privy settings in the [Fuji runbook](docs/DEPLOY_FUJI.md). Without a Privy App ID the local app uses an injected wallet. Use `http://localhost:3000` when pointing this app at the public Fuji oracle, which checks the browser origin.

> [!IMPORTANT]
> `.dev.vars` and `.env.local` hold secrets. Both are git-ignored. Keep them out of commits and screenshots.

## Repository layout

```text
contracts/   Foundry, Solidity 0.8.28 (StudyStakeManager, StudyBadge, mocks)
oracle/      Cloudflare Worker (TypeScript): Moodle adapter, Demo LMS adapter, Merkle builder
web/         Next.js App Router: Privy, wagmi/viem, Tailwind, Vietnamese/English UI
docs/        Spec, contracts, threat model, oracle and web notes
assets/      Images for this README (cover, architecture, features, payout chart)
```

## Team

- Nguyễn Dương Gia Thuận
- Nguyễn Kiều Anh Quân

## License

MIT. See [LICENSE](LICENSE).
