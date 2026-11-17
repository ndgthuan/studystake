# StudyStake: Plan to raise the Avalanche Integration score

> Goal: the maximum 50 points of the qualifying round (Technical 25 + Avalanche Integration 25).
> Written on 3/11. Submission deadline: **23:59 21/11/2026**.

## Current problem

This plan started before the Fuji deployment. The current Fuji addresses and first completed tUSDC round are in [Live on Fuji](../README.md#live-on-fuji). The Circle USDC and x402 checks use a local Fuji fork. A public Fuji x402 payment still needs a receipt.

Judges score these 25 points by asking: *"Which part of the product only makes sense on Avalanche, and does it really run on-chain?"*

## Three tiers at a glance

| Tier | Content | Priority | Due |
|---|---|---|---|
| **P0** | Really running on Fuji: deploy, verify, Circle USDC, Privy, Core wallet | Mandatory | **9/11** |
| **P1** | x402 "Study Credential API", x402 revenue refills the reward pool | Should do | **15/11** |
| **P2** | StudyNet L1 + ICM: study records live on the school's L1 | Stretch | **18/11** |
| | Code freeze, video, slides, submission | | **19–21/11** |

Principle: **do not touch P1 until P0 is done. Do not touch P2 until P1 runs on Fuji.** One feature running for real on Fuji is worth more than three that only exist on Anvil.

---

## P0: Really running on Fuji (3/11 → 9/11)

### Tasks
1. **Switch the main token to Circle's Fuji USDC** (`0x5425890298aed601595a70AB815c96711a31Bc65`).
   - Why: this is Circle's native USDC, the same as USDC on C-Chain mainnet. It has both EIP-2612 (permit) and **EIP-3009** (`transferWithAuthorization`), and x402 in P1 **requires** EIP-3009. The current `TestUSDC` only has permit.
   - Deploy with `USE_CIRCLE_USDC=true`. Keep tUSDC as a backup (Circle's faucet has a captcha, so users must request funds themselves).
   - Web defaults (`/challenges`, `/admin`) use Circle USDC challenges.
2. **Deploy + verify all 4 contracts on Snowtrace** (Manager, Badge, 2 vaults). Paste the Snowtrace links into the README.
   - Check that `evm_version = "cancun"` in `foundry.toml` deploys fine on Fuji (dry-run `forge script` with the Fuji `--rpc-url` before broadcasting).
3. **Deploy the oracle Worker** with real addresses (`MANAGER_ADDRESS`, `DEPLOY_BLOCK`, KV id, R2 bucket, secrets). Set `ALLOWED_ORIGINS` to the web domain.
4. **Deploy the web** (Vercel or Cloudflare Pages), run `sync_deployments` to get the Fuji addresses.
5. **Privy with a real App ID**: test Google login → embedded wallet → AVAX faucet → join → claim, all on Fuji.
6. **Core wallet support** (Avalanche's wallet) alongside MetaMask, following the organizers' "Connect a wallet" starter.
7. **Run one real challenge on Fuji** with the Demo LMS, end to end (join → settle → dispute window → finalize → claim). Keep the tx hash of each step for the README and the video.

### Done when
- [x] The README has a table of Fuji addresses and Snowtrace links
- [ ] Someone outside the team can open the web, log in with Google, join and claim on Fuji without guidance
- [ ] Playwright E2E runs on Fuji (or at least a full screen recording)

---

## P1: x402 "Study Credential API" (9/11 → 15/11)

> The source of truth for this API is [`X402.md`](X402.md). This section explains the idea.

### Idea
Badges and streaks are already public on-chain, so we **do not sell that data**. Judges would ask: "Anyone can read it on-chain for free, so why pay?"

What only the oracle knows is: *this wallet is linked to a real Moodle account at school X, and has completed N challenges on time*. The oracle can **sign an attestation** (EIP-712) of that. This is what is worth paying for.

- **Buyers:** scholarship apps, internship recruiters, clubs, or **AI agents** that need to verify "a genuinely diligent student" without trusting a screenshot.
- **Price:** 0.001–0.01 USDC per call, paid through x402, and **the buyer needs no AVAX** (the facilitator pays gas).
- **Economic loop (the creative point):** x402 revenue flows to the treasury, then the treasury calls `sponsor()` to **refill the reward pool** of next term's challenges. This addresses the weak point "testnet yield is too small to motivate anyone" with a real, repeatable source of rewards.

### Design
```
GET /x402/credential/:wallet          (oracle Worker)
  → 402 Payment Required: 0.005 USDC, Avalanche Fuji, pay_to = TREASURY
  → client signs an EIP-3009 authorization, resends with a PAYMENT-SIGNATURE header
  → Worker calls facilitator /verify → reads the badge on-chain + KV link
  → signs the EIP-712 Credential → facilitator /settle → returns 200 + tx hash
```
`Credential` (EIP-712, signed with the oracle key):
```
{ wallet, subject_hash, site_hash, streak, best_streak, total_completed, total_failed, issued_at, expires_at }
```
- Contains no names, student IDs or raw userids (same rule as evidence).
- Only returns a credential when the wallet owner has **agreed to share** (a `share_credential` flag set at link time, signed by the wallet). Users control their data, in the spirit of the threat model.
- Add a `/credential/verify` web page: paste a credential, the web recovers the signer (`recoverTypedData`), compares it with the on-chain oracle address (`ORACLE_ROLE`), then reads the badge to cross-check.

### Technical notes
- Take code from the organizers' starter: <https://team1vn.xyz/demos.html#x402-pay-per-request> (Express, `@x402` pinned at 2.28).
- The oracle is a **Cloudflare Worker, not Express**, so the Express middleware cannot be used. Two options:
  1. Use the `@x402` core/fetch packages if they run on Workers (needs checking, about half a day).
  2. Write the 402 flow by hand (about 150 lines): return the `PAYMENT-REQUIRED` header, take `PAYMENT-SIGNATURE`, call the facilitator's HTTP `/verify` and `/settle`. The starter's `src/facilitator.mjs` shows the format.
- The starter says plainly: the x402 library **does not know USDC on Fuji**, so the token address, `name` and `version` must be stated in full (see the starter's `src/networks.mjs`).
- **Run our own facilitator for Demo Day** (included in the starter), so we do not depend on public facilitators.
- Add `scripts/agent_buyer.mjs`: a "scholarship agent" that pays by itself and gets the credentials of 3 wallets. This is the demo scene for the video.
- Tests: vitest for the 402 flow (missing header → 402, bad signature → 402, valid → 200 + a valid credential), plus one real payment on Fuji with a tx hash.

### Done when
- [ ] Calling the API on Fuji: USDC really moves to the treasury, with a Snowtrace tx
- [ ] The credential verifies on `/credential/verify`
- [ ] There is a script or admin button for the treasury to `sponsor()` a new challenge with x402 revenue

---

## P2 (stretch): StudyNet L1 + ICM (15/11 → 18/11)

### Idea
Each school runs its own **Avalanche L1** ("StudyNet"). Study records (badges, streaks) live on a chain the school controls, and students pay no gas. Money (USDC, vault) stays on **C-Chain**, where the real liquidity is. The two chains talk through **ICM (Teleporter)**.

```
C-Chain Fuji: StudyStakeManager.claim()
   → StudyBadge.record_result()   (unchanged)
   → BadgeICMSender.send(account, stats) ──ICM──▶ StudyNet L1: BadgeRegistry.receive()
```
- Goes in the C-Chain → L1 direction, adding a separate **sender contract**, **without changing `StudyStakeManager`**. That keeps the existing 92 tests green and adds no risk to principal.
- Create the L1 with Builder Console: <https://build.avax.network/console/create-l1?ref=HVHXK&utm_source=team1>

### Risks (read before starting)
- **To check:** whether testnet L1s created through Builder Console expire, and whether an ICM relayer is included. If the L1 goes down before judging (21–23/11), this part breaks. In that case present it only in the video (with tx hashes), and do **not** put it in the web's main flow.
- If P1 is not done by 15/11, **drop P2**. Present L1 + ICM in the slides only, as roadmap, with an architecture diagram.

### Decision on 17 November 2026

Use the Aave V3 fork fallback for the demo. A public Fuji x402 payment was still pending, and both the hosted relayer and the managed L1 node shut down after three days. Starting a managed setup on 17 November would leave a gap before judging from 21 to 23 November. A self-hosted setup would need a separate deployment with funded relaying on both chains. [Managed validator documentation](https://build.avax.network/academy/avalanche-l1/avalanche-fundamentals/04-creating-an-l1/06-run-a-node) · [Hosted relayer documentation](https://build.avax.network/academy/avalanche-l1/native-token-bridge/03-native-to-native/03-relayer-setup)

The adapter resolves the official Aave StataToken vault, which already implements ERC-4626. `StudyStakeManager` uses that vault directly. Run the lifecycle against a local Avalanche C-Chain mainnet fork from `contracts/`, without broadcasting:

```powershell
forge test --fork-url $env:AVALANCHE_MAINNET_RPC --match-contract AaveV3AdapterForkTest -vv
```

The check passed at C-Chain block `100563626`. It deployed the adapter and Manager on the fork, resolved the official USDC StataToken, staked 100 USDC, accrued Aave yield, and claimed principal plus rewards with a badge. The public Fuji app uses simulated yield. [Aave StataToken documentation](https://aave.com/docs/aave-v3/smart-contracts/tokenization#statatokenfactory)

### Done when
- [ ] At least one successful ICM message C-Chain → L1, with tx hashes on both sides
- [ ] The video has a scene of claiming on C-Chain and the badge appearing on the L1

---

## Small but worthwhile tasks (fit in between)
- The README and slides have a **"Why Avalanche"** section, each point with evidence:
  - Sub-second finality → money is visible right after claiming (screen recording)
  - Low fees → a 1 USDC stake still makes sense (record the real gas cost of `join_with_permit` on Fuji)
  - Native Circle USDC + EIP-3009 → gasless x402
  - An L1 per school → study data belongs to the school and students
- A "Real txs on Fuji" table in the README: join, settle, finalize, claim, x402 payment, one Snowtrace link per row.
- Keep the README's "Avalanche integration" table accurate. **Do not mark ✓ for anything not running on Fuji**, judges will try it.
- Complete Builder Pass (5 quests) for the whole team.

## Suggested assignment (team ≤ 3 people)
| Person | P0 | P1 | P2 |
|---|---|---|---|
| A (Solidity) | Deploy + verify on Fuji, Circle USDC | EIP-712 Credential, signing and verifying | ICM sender/receiver |
| B (Backend) | Deploy the Worker, R2/KV, secrets | x402 flow in the Worker, own facilitator, agent buyer | Relayer/L1 setup |
| C (Frontend/Pitch) | Real Privy, Core wallet, mobile testing | `/credential/verify`, treasury revenue panel | Slides, video, Demo Day script |

## Judge questions to prepare for
1. *"Why not build on Ethereum/Base?"* → answer with the 4 points of "Why Avalanche", with real numbers.
2. *"Badge data is public, why pay through x402?"* → what is sold is an attestation signed by the oracle (a verified real Moodle account), with the student's consent.
3. *"Testnet yield is fake?"* → yes, and we say so. On mainnet we use the Aave v3 adapter; the main reward source is sponsors plus x402 revenue.
4. *"What if the oracle cheats?"* → the oracle cannot touch principal, rewards are capped, there is a dispute window and public evidence on `/verify`; the roadmap is zkTLS.
