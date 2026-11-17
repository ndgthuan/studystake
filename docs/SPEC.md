# StudyStake — Spec v0.1 (Phase 0, pending approval)

> **Commit to studying, never lose your principal.** Students stake USDC to commit to submitting Moodle work on time. The stake goes into a yield vault. Those who keep the commitment get their principal back, plus the group's yield and a sponsored reward pool. Those who miss the deadline still get **100% of their principal** back and only lose the reward.

Hackathon: Team1 Vietnam UniHack. Deadline: **23:59 21/11/2026**. Network: **Avalanche Fuji** (C-Chain testnet).

---

## 1. Problem and solution

| | |
|---|---|
| **Problem** | Students miss Moodle quizzes and submissions because they lack short-term motivation. Reminder apps are easy to ignore. "Bet your money" models (StickK, Beeminder) feel like gambling, and losing real money makes people reluctant to try. |
| **Solution** | A **no-loss** stake (you never lose principal). Motivation comes from 3 sources: (1) the pool's yield is shared only among completers, (2) a reward pool funded by schools, clubs and sponsors, (3) soulbound badges and a public on-chain streak. |
| **Why blockchain** | The stake is in nobody's hands: no treasurer or company holds it. The reward rules are public and cannot be changed. Results are verified with evidence anyone can check. Badges are a study record students own themselves. |

## 2. User flow

1. **Log in** with Google through **Privy**. The user gets an embedded wallet without installing MetaMask or knowing a seed phrase. External wallets (Core/MetaMask) still work.
2. **Get first-time gas:** the Worker faucet automatically sends 0.05 Fuji AVAX to new accounts, rate limited.
3. **Link Moodle:** paste a Moodle mobile token. The oracle calls `core_webservice_get_site_info` to identify the `userid`, then binds `(site, userid) ↔ wallet` one-to-one.
4. **Pick a challenge**, for example "CSC10002 – Quiz weeks 10–12". The challenge states the course, the activities (quiz/assign) and the deadline.
5. **Stake** 1–100 USDC in **one transaction** (EIP-2612 `permit` + join).
6. **Track progress:** the dashboard shows whether each activity is submitted and a countdown.
7. **End:** the oracle aggregates the results into a Merkle root and posts it on the contract with an evidence hash. Then comes a **dispute window** (24h, 10 minutes in the demo).
8. **Get paid:** completers receive principal + reward + an SBT badge, streak +1. Non-completers get their principal back.

## 3. Architecture

```
┌──────────────┐  Privy auth   ┌──────────────────────────┐
│  web (Next)  │──────────────▶│  oracle (CF Worker)       │
│ Privy+wagmi  │  link/status  │  - Moodle adapter         │
│ viem, i18n   │◀──────────────│  - Demo LMS adapter       │
└──────┬───────┘               │  - Merkle builder         │
       │ tx (join/claim)       │  - faucet drip            │
       ▼                       │  - cron: settle()         │
┌─────────────────────────────┐└───────┬──────────────────┘
│ Avalanche Fuji C-Chain       │◀───────┘ settle(root, evidence_hash)
│  StudyStakeManager           │
│  ├─ IYieldSource → MockYieldVault (ERC-4626, Fuji)       │
│  │                 AaveV3Adapter (mainnet, roadmap)       │
│  └─ StudyBadge (ERC-721 soulbound, ERC-5192)             │
└─────────────────────────────┘
Evidence (JSON, hashes only, no names): Cloudflare R2, keccak stored on-chain
```

**Repo** (monorepo `unihack/`):
- `contracts/`: Foundry, Solidity 0.8.28, OpenZeppelin v5
- `oracle/`: Cloudflare Worker, TypeScript, viem, KV + R2
- `web/`: Next.js App Router, Privy, wagmi/viem, Tailwind, Vietnamese/English UI, pure black dark mode
- `docs/`: SPEC, THREAT_MODEL, DEMO_SCRIPT, PITCH

**Code conventions:** functions, variables and methods use `snake_case` (the team's convention), including in Solidity and TS. Names required by standards such as ERC (`transferFrom`, `permit`, `supportsInterface`...) and React/Next hooks (`useXxx`, PascalCase components) stay as they are.

## 4. Smart contracts

### 4.1 `StudyStakeManager`
Roles (OpenZeppelin `AccessControl`):

| Role | Can | Cannot |
|---|---|---|
| `DEFAULT_ADMIN` | grant/revoke roles, set treasury, allowlist tokens/vaults | **Cannot** withdraw anyone's principal |
| `CREATOR_ROLE` | create challenges | |
| `ORACLE_ROLE` | `settle` (post the root), once per challenge | Cannot touch money |
| `GUARDIAN_ROLE` | handle disputes (replace the root), `pause` join/settle | Cannot pause `claim` or `expire` |

**Challenge states:** `Open → Active → Settling → (Disputed →) Finalized`, or `Expired` if the oracle does not settle in time.

```
create_challenge(token, vault, min_stake, max_stake, join_deadline, end_time,
                 settle_grace, dispute_window, metadata_uri, metadata_hash)
sponsor(id, amount)                      // anyone can add to the reward pool, before end_time
join(id, amount) / join_with_permit(...) // before join_deadline; one join per wallet
settle(id, root, completed_count, completed_stake, evidence_hash) // ORACLE, after end_time, before end_time+settle_grace
dispute(id, reason_hash)                 // participant, during dispute_window
resolve_dispute(id, new_root, completed_count, completed_stake, evidence_hash) // GUARDIAN
finalize(id)                             // anyone, after dispute_window; redeems the vault, fixes the pot
expire(id)                               // anyone, if end_time+settle_grace passed without a settle
claim(id, completed, proof)              // principal + (if completed and proof is valid) reward; mints/updates the badge
sweep_rewards(id)                        // after the 180-day claim_period: only UNCLAIMED REWARDS → treasury
```

**Merkle leaf:** `keccak256(bytes.concat(keccak256(abi.encode(chain_id, manager, id, account, stake))))`. The leaf is hashed twice following OpenZeppelin `StandardMerkleTree` to prevent second-preimage attacks. It contains `chain_id` and the contract address so it cannot be reused on another chain or contract. The tree contains only completers.

**Accounting at `finalize`:**
- `assets = vault.redeem(all_shares)`, `P` = total principal.
- If `assets ≥ P`: yield `Y = assets − P`, reward pot `R = Y + bonus`.
- If `assets < P` (vault loss): everyone receives `stake × assets / P` and `R = bonus`. The README states clearly: no-loss is only as safe as the yield source.
- Participant i's reward: `min(R × stake_i / completed_stake, R − paid)`. If the oracle misreports `completed_stake`, rewards are capped and **never eat into principal**.
- If `completed_stake == 0`: yield goes to the treasury, and the bonus is refunded to each sponsor pro rata.
- `expire`: everyone receives principal + yield pro rata to stake, and the bonus is refunded to sponsors.

**Invariants, checked with fuzz/invariant tests:**
1. `token.balanceOf(manager) + value of vault shares ≥ total unclaimed principal + unclaimed rewards` (unless the vault takes a loss).
2. Total paid out of a challenge ≤ money in + yield.
3. No role can reduce the principal a participant can claim (unless the vault takes a loss).
4. Each `(id, account)` can claim only once. Each challenge settles only once (except via resolve dispute).
5. `claim` and `expire` are never paused.

**Technical safety:** `ReentrancyGuard`, `SafeERC20`, checks-effects-interactions. Only allowlisted tokens/vaults are accepted, no fee-on-transfer or rebasing tokens. All time parameters are validated. Full events for indexers and the UI.

### 4.2 `MockYieldVault` (ERC-4626, Fuji only)
- Fuji has no live Aave/Benqi, so yield on testnet is **simulated**. The demo says so plainly.
- The owner funds a "yield pool", and the vault releases it at a configured APR (for example 8% per year) by increasing `totalAssets` linearly. Uses OpenZeppelin ERC-4626 with `_decimalsOffset` to prevent inflation attacks.
- For mainnet: an `IYieldSource` interface and an `AaveV3Adapter` via the static aToken ERC-4626 (roadmap, possibly with a fork test if time permits).

### 4.3 `StudyBadge` (soulbound ERC-721, ERC-5192)
- Minted on the first claim in the completed state. One badge per wallet; each completion increases `streak` and `total_completed`.
- `tokenURI` generates the SVG on-chain (Bronze/Silver/Gold tiers by streak). Non-transferable, `locked() = true`.
- Only the Manager can mint/update.

### 4.4 Token
- Defaults to **Circle's Fuji USDC** (`0x5425890298aed601595a70AB815c96711a31Bc65`, has `permit`). Users get USDC at faucet.circle.com.
- Backup: `tUSDC` (mock, 6 decimals, with an in-app faucet) if Circle's faucet is limited during the demo.

## 5. Oracle (Cloudflare Worker)

| Endpoint | Function |
|---|---|
| `POST /link/moodle` | Verifies the Privy JWT. Takes the Moodle token, calls site_info, binds `(site,userid)↔wallet` (1-1, stored in KV). The token is AES-GCM encrypted with a secret and **deleted after the challenge settles** |
| `POST /link/demo` | Links to the **Demo LMS** so judges and viewers can try it without HCMUS Moodle |
| `GET /progress/:id/:wallet` | Progress per activity |
| `POST /faucet` | Sends the configured grant to eligible new wallets (0.001 AVAX on Fuji). Limited per Privy user id and address, with optional Turnstile |
| `cron */5` | Finds challenges past `end_time` → checks each participant → builds a `StandardMerkleTree` → uploads evidence JSON to R2 → `settle()` |
| `GET /evidence/:id` | Downloads the evidence JSON and tree file for self-checking |

**What "completed" means:** every activity in the challenge has a submission/attempt in state `finished`/`submitted` with `timefinish ≤ min(duedate, end_time)`. A minimum grade can also be set.
- Quiz: `mod_quiz_get_user_attempts`
- Assign: `mod_assign_get_submission_status`

**Demo LMS:** a mini-LMS inside the same Worker, with a "Take demo quiz" page and a "Submit" button. Used for the video, Demo Day and judges, and clearly labeled DEMO.

## 6. Web (Next.js)
Pages: `/` landing · `/challenges` · `/challenges/[id]` (join, progress, countdown, evidence) · `/me` (stakes, badge, streak, claim) · `/link` (Moodle/Demo) · `/admin` (create challenge, sponsor, monitor settle/disputes) · `/verify/[id]` (anyone can check the Merkle root).

UX: every transaction has clear states (signing → confirming → done) and a Snowtrace link. Errors are translated into plain language. Checks for wrong network, missing gas and missing USDC, with faucet guidance.

## 7. Avalanche Integration points
1. Contracts **verified on Snowtrace**, all 3 of them.
2. **Privy embedded wallet + automatic gas faucet** for users who do not know crypto.
3. **Circle's Fuji USDC + EIP-2612 permit**: one transaction and done.
4. **ERC-4626 yield + Aave v3 adapter for C-Chain mainnet**: an architecture ready to run for real.
5. **SBT with on-chain SVG**: a study record students own.
6. *(Stretch)* **x402 "Study Reputation API"**: other apps pay 0.001 USDC to query a wallet's streak.
7. *(Stretch/roadmap)* A dedicated **StudyNet L1** for schools via Builder Console, with ICM to carry badges over to C-Chain.

## 8. Out of MVP scope (stated in the pitch)
- Real yield: only on mainnet through the Aave adapter.
- Decentralized oracle: the roadmap is zkTLS (Reclaim/TLSNotary) to prove Moodle data without handing over a token, or a Moodle plugin run by the school as the oracle.
- Guardian-free appeals: the roadmap is multi-oracle or voting.

## 9. Plan and Definition of Done

| Phase | Content | Done when | Due |
|---|---|---|---|
| 0 | Spec + threat model | Team approved | 3/11 |
| 1 | Contracts | Unit + fuzz + invariant tests green; Slither has no high/medium findings; coverage ≥ 95% | 7/11 |
| 2 | Oracle | Moodle adapter tested with real data (Thuận's token); Demo LMS works; settle on Anvil | 9/11 |
| 3 | Web | Full flow works on local Anvil; usable on 375px mobile | 13/11 |
| 4 | Fuji | Deploy + verify; Playwright E2E on Fuji; final full review | 16/11 |
| 5 | Users + submission | ≥ 20 real users; slides; 2–3 minute video; public repo/README | 21/11 |

Haiku agents write the code. The lead (Opus) writes the spec, reviews each PR against the threat model and reruns the tests to check.
