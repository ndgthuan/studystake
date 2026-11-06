# StudyStake — Threat model v0.1

Goal: list **every way** the system could be broken or cheated, and how each is blocked. Anything not yet blocked is stated plainly, because the team must be able to answer when judges ask.

**Core guarantee:** *Even if the oracle, creator, guardian or admin is hacked, users can still withdraw their principal*, except when the yield vault itself takes a loss.

## A. Attacks on money (smart contracts)

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| A1 | Reentrancy on claim/finalize | `nonReentrant` + CEI; marked as claimed before transferring | — |
| A2 | Claiming twice | `claimed[id][account]` | — |
| A3 | Forged proof / reusing a proof from another challenge, chain or contract | Leaf hashed twice, contains `chain_id, manager, id, account, stake`; the stake in the leaf must match the on-chain stake | — |
| A4 | Oracle misreports `completed_stake` to skew rewards | Rewards capped by `R − paid`, so they cannot eat into principal; dispute window + public evidence | Later claimers may receive less reward if the oracle is wrong and nobody disputes |
| A5 | Inflation/donation attack on the ERC-4626 vault | OpenZeppelin `_decimalsOffset`; the Manager tracks shares per challenge and does not use `balanceOf` for accounting | — |
| A6 | Malicious tokens (fee-on-transfer, rebasing, hooks) | Token/vault allowlist managed by admin | — |
| A7 | Admin withdraws funds | No function withdraws principal. `sweep_rewards` only takes unclaimed rewards after 180 days | Admin could allowlist a malicious vault for **new** challenges → the UI shows the vault address, only trusted creators can create challenges |
| A8 | Pausing to trap funds | Pause only blocks `join`/`settle`; `claim`/`expire` always work | — |
| A9 | Oracle never settles (dead or censored) | After `end_time + settle_grace` anyone can call `expire` → everyone receives principal + yield | — |
| A10 | Front-running `settle`/`finalize` | Only ORACLE can call `settle`; `finalize` gives the same result whoever calls it | — |
| A11 | Rounding creates dust or breaks invariants | Round down in the contract's favor; dust goes to the treasury on sweep; fuzz checks invariants | — |
| A12 | DoS through unbounded loops | No on-chain loop over participants; claim is pull-based per user | — |
| A13 | Vault takes a loss or gets hacked | Loss shared pro rata to stake; stated clearly in the UI/README | **Real risk**, no-loss depends on the yield source |
| A14 | Sponsor funds after knowing the result | `sponsor` only before `end_time` | — |
| A16 | A non-completer limits gas so the badge update (streak reset) silently fails, keeping a fake streak | Call the badge with fixed gas + check `gasleft()` first, revert the whole claim if there is not enough gas (R1) | — |
| A17 | Treasury blacklisted by USDC makes `finalize` revert, trapping principal | `finalize` does not push funds; treasury yield is collected separately through `collect_treasury` (R2) | — |
| A18 | Frivolous dispute, absent guardian, `expire` shares yield with non-completers too | After the dispute timeout, `finalize` with the existing settlement, no expire (R3) | If the oracle is wrong and the guardian is absent, rewards follow the oracle; principal stays safe |
| A15 | Joining right before the deadline when already certain of completing | `join_deadline` is before the work period; rewards are pro rata to stake so joining late brings no extra benefit | Someone who submitted before joining → only submissions **after** joining count (`timefinish ≥ joined_at`) |

## B. Study fraud (oracle / Moodle)

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| B1 | Using a diligent friend's Moodle to "complete" | `(site,userid) ↔ wallet` bound 1-1, only the first link counts | **Cannot be blocked** if 2 people collude and share tokens, but that only earns a small yield, so it makes no economic sense |
| B2 | Submitting empty work to tick the box | `min_grade` can be set per challenge | Moodle cannot measure study quality |
| B3 | One person creates many wallets (sybil) | Rewards are pro rata to stake, so splitting brings no benefit; one Moodle binds to only one wallet | — |
| B4 | Oracle hacked or misreporting | Public evidence (R2 + on-chain hash), the `/verify` page for self-checking, disputes + guardian. The oracle cannot touch principal | Rewards depend on an honest oracle. Roadmap: zkTLS / a Moodle plugin run by the school |
| B5 | Moodle token leak (the token has full account access) | AES-GCM encrypted at rest, key in a Worker secret; only read APIs are called; deleted after settle; users can revoke the token in Moodle | **Largest privacy risk** → stated on the consent screen; roadmap: zkTLS |
| B6 | Changing times or deadlines in Moodle | Uses `min(duedate, end_time)` fixed in the metadata (hash on-chain) | If a teacher extends the deadline, students do not benefit |
| B7 | Moodle down at settle time | Cron retries; `settle_grace` of 3 days; `expire` as the last resort | — |

## C. Web, accounts and operations

| # | Threat | Mitigation |
|---|---|---|
| C1 | Draining the gas faucet | Limits per Privy user + address + IP, Turnstile, daily cap, hot wallet holds little AVAX |
| C2 | Forged JWT when calling the oracle | Verify the Privy JWT with JWKS, check `aud`/`iss`/`exp` |
| C3 | Oracle key leak | Stored in a Worker secret, a separate wallet with only the ORACLE role; admin can revoke the role immediately |
| C4 | Phishing or unexpected transactions | The UI decodes and shows the amount and contract; only hardcoded, verified addresses |
| C5 | XSS, injection through metadata | Metadata rendered as text, strict CSP, no HTML rendered from users |
| C6 | Evidence reveals identity | JSON contains only wallet + hash(site,userid) + status, no names or student IDs |
| C7 | Admin key is an EOA | The demo uses an EOA; the roadmap is a multisig (Safe on C-Chain) + timelock |

## D. x402 Study Credential

See [`X402.md`](X402.md), section "Threats".
