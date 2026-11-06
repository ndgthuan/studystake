# StudyStake — Detailed contract spec (Phase 1)

Source of truth for implementation and tests. When in conflict, this file wins over SPEC.md §4. Any change must go through the lead.

## General
- Foundry, `solc 0.8.28`, `evm_version = "cancun"` (supported by Avalanche C-Chain), optimizer 200 runs, `via_ir = false`.
- OpenZeppelin Contracts **v5.x** (`lib/openzeppelin-contracts`), imported through the `@openzeppelin/contracts/` remapping.
- **Naming:** self-defined functions/variables/parameters use `snake_case`. Names required by standards/OZ/Foundry stay as they are: `transfer`, `permit`, `totalAssets`, `supportsInterface`, `tokenURI`, `locked`, `run`, `setUp`, `test_*`, `invariant_*`. Events and custom errors use PascalCase, structs/contracts PascalCase, constants UPPER_CASE.
- NatSpec on every external function.
- Custom errors, no `require` with strings.

## Files
```
contracts/
  foundry.toml
  src/StudyStakeManager.sol
  src/StudyBadge.sol
  src/interfaces/IStudyBadge.sol
  src/mocks/MockYieldVault.sol
  src/mocks/TestUSDC.sol
  script/Deploy.s.sol
  test/...
```

---

## TestUSDC (`src/mocks/TestUSDC.sol`)
`ERC20("Test USDC","tUSDC") + ERC20Permit`, `decimals() = 6`.
- `faucet()`: mints 1_000e6 to `msg.sender`, once per address per 24h (`last_faucet[addr]`). Error `FaucetCooldown(uint256 next_time)`.
- `mint(address to, uint256 amount)` owner only (Ownable).

## MockYieldVault (`src/mocks/MockYieldVault.sol`)
`ERC4626` (OZ) + `Ownable`. `_decimalsOffset() = 6`.
Simulates yield with a **linear drip**:
- `fund_yield(uint256 amount, uint64 duration)` (owner): `safeTransferFrom` amount into the vault. Yield not yet released from the previous drip is added to the new one: `new_total = unreleased() + amount`, `drip_start = now`, `drip_end = now + duration`. `duration > 0`.
- `unreleased()`: `now >= drip_end ? 0 : drip_total * (drip_end - now) / (drip_end - drip_start)`.
- `totalAssets() = asset.balanceOf(this) - unreleased()`.
- Event `YieldFunded(uint256 amount, uint64 drip_end)`.
- `loss_for_testing(uint256 amount)` (owner): transfers `amount` of the asset to the owner to simulate a vault loss (used in tests and demos). Comment clearly: TESTNET ONLY.

## StudyBadge (`src/StudyBadge.sol`) — soulbound ERC-721 + ERC-5192
`ERC721("StudyStake Badge","STUDY") + AccessControl`. `MANAGER_ROLE`.
- At most 1 token per wallet. `badge_of[account] → token_id` (0 = none, token ids start at 1).
- Struct `Stats { uint32 streak; uint32 best_streak; uint32 total_completed; uint32 total_failed; uint64 last_update; }`, `stats_of[token_id]`.
- `record_result(address account, bool completed)` (MANAGER):
  - completed: mint if there is no badge. `streak++`, `best_streak = max`, `total_completed++`.
  - not completed: if there is a badge → `streak = 0`, `total_failed++`. Without a badge, do nothing.
  - emit `ResultRecorded(account, token_id, completed, streak)`.
- Soulbound: override `_update` → revert `Soulbound()` if `from != 0 && to != 0`. `approve`/`setApprovalForAll` revert `Soulbound()`.
- ERC-5192: `locked(uint256) → true` (reverts if the token does not exist), emit `Locked(token_id)` on mint, `supportsInterface(0xb45a3c0e) = true`.
- `tokenURI`: `data:application/json;base64,...` with `name`, `description`, `attributes` (streak, best_streak, total_completed, tier) and `image` as a base64 SVG generated on-chain. Tier: `best_streak >= 10` Gold, `>= 3` Silver, otherwise Bronze. SVG with black `#000` background, tier color, large streak display. Uses OZ `Base64`, `Strings`.

## StudyStakeManager (`src/StudyStakeManager.sol`)
`AccessControl + ReentrancyGuard + Pausable`. Roles: `DEFAULT_ADMIN_ROLE`, `CREATOR_ROLE`, `ORACLE_ROLE`, `GUARDIAN_ROLE`.

### Constants
- `MAX_PARTICIPANTS` not needed (no loops).
- `CLAIM_PERIOD = 180 days` from `finalized_at`.
- `DISPUTE_TIMEOUT = 7 days`.
- Parameter bounds: `dispute_window ∈ [5 minutes, 7 days]`, `settle_grace ∈ [10 minutes, 14 days]`, `join_deadline > now`, `end_time >= join_deadline`, `0 < min_stake <= max_stake`.

### State
```solidity
enum Status { None, Open, Settled, Disputed, Finalized, Expired }
// "Open" covers both the join period and the work period; the UI derives the phase from time.

struct Challenge {
  // config
  IERC20 token; IERC4626 vault; address creator;
  uint128 min_stake; uint128 max_stake;
  uint64 join_deadline; uint64 end_time; uint64 settle_grace; uint64 dispute_window;
  bytes32 metadata_hash;
  // live
  Status status;
  uint128 total_principal; uint128 total_bonus; uint256 total_shares;
  uint32 participant_count;
  // settle
  bytes32 root; bytes32 evidence_hash; uint64 settled_at; uint64 disputed_at;
  uint32 completed_count; uint128 completed_stake;
  // finalize/expire
  uint64 finalized_at; uint256 final_assets;        // assets received from the vault
  uint128 reward_pot; uint128 reward_paid;
  uint128 principal_paid;                            // total "principal" part paid out
  bool loss;                                         // final_assets < total_principal
  bool rewards_swept;
}
mapping(uint256 => Challenge) public challenges;   // separate getter get_challenge(id) returns the struct
mapping(uint256 => mapping(address => uint128)) public stake_of;
mapping(uint256 => mapping(address => uint64)) public joined_at;
mapping(uint256 => mapping(address => bool)) public claimed;
mapping(uint256 => mapping(address => bool)) public has_disputed;
mapping(uint256 => mapping(address => uint128)) public sponsor_amount_of;
mapping(uint256 => mapping(address => bool)) public sponsor_refunded;
mapping(address => bool) public allowed_token;
mapping(address => bool) public allowed_vault;   // vault.asset() must be an allowed token
address public treasury; IStudyBadge public immutable badge;
uint256 public challenge_count;  // ids start at 1
```

### Functions
**Admin**
- `constructor(address admin, address treasury_, IStudyBadge badge_)`.
- `set_treasury(address)`, `set_allowed_token(address,bool)`, `set_allowed_vault(address,bool)` (DEFAULT_ADMIN).
- `pause()/unpause()` (GUARDIAN). Pause blocks: `create_challenge`, `join*`, `sponsor`, `settle`. Does **NOT** block: `claim`, `finalize`, `expire`, `dispute`, `resolve_dispute`, `claim_sponsor_refund`, `sweep_rewards`.

**create_challenge** (CREATOR, whenNotPaused)
`(IERC20 token, IERC4626 vault, uint128 min_stake, uint128 max_stake, uint64 join_deadline, uint64 end_time, uint64 settle_grace, uint64 dispute_window, bytes32 metadata_hash, string calldata metadata_uri) → uint256 id`
- Checks: token allowed, vault allowed, `vault.asset() == token`, parameter bounds. Status = Open.
- emit `ChallengeCreated(id, creator, token, vault, join_deadline, end_time, metadata_hash, metadata_uri)`.

**sponsor(id, amount)** (whenNotPaused): status Open, `now < end_time`, amount > 0. The token stays raw in the Manager (not deposited in the vault). `total_bonus += amount`, `sponsor_amount_of[id][msg.sender] += amount`. emit `Sponsored`.

**join(id, amount)** / **join_with_permit(id, amount, deadline, v, r, s)** (whenNotPaused, nonReentrant)
- status Open, `now < join_deadline`, not joined yet (`stake_of == 0`), `min_stake <= amount <= max_stake`.
- permit wrapped in `try ... catch {}` (prevents front-run griefing); then always `safeTransferFrom`.
- `forceApprove(vault, amount)`, `shares = vault.deposit(amount, address(this))`. Updates `total_principal`, `total_shares`, `participant_count`, `stake_of`, `joined_at = now`.
- emit `Joined(id, account, amount, shares, joined_at)`. The oracle only counts submissions with `timefinish >= joined_at`.

**settle(id, root, completed_count, completed_stake, evidence_hash)** (ORACLE, whenNotPaused)
- status Open, `end_time <= now < end_time + settle_grace`.
- `completed_count <= participant_count`, `completed_stake <= total_principal`, `(completed_count == 0) == (completed_stake == 0)`, root != 0 unless completed_count == 0.
- Stores them, `settled_at = now`, status Settled. emit `Settled(...)`.

**dispute(id, bytes32 reason_hash)**: status Settled, `now < settled_at + dispute_window`, `stake_of[id][msg.sender] > 0`, no `has_disputed` yet. Status Disputed, `disputed_at = now`. emit `Disputed(id, account, reason_hash)`.

**resolve_dispute(id, root, completed_count, completed_stake, evidence_hash)** (GUARDIAN): status Disputed. Same checks as settle. Overwrites, `settled_at = now` (reopens the dispute window; each person can dispute only once so it cannot be spammed forever), status Settled. emit `DisputeResolved(...)`.

**finalize(id)** (anyone, nonReentrant): status Settled, `now >= settled_at + dispute_window`. Calls `_redeem_all(id)`, then:
- `final_assets = vault.redeem(total_shares, address(this), address(this))` (if total_shares > 0).
- If `final_assets >= total_principal`: `yield = final_assets - total_principal`, `loss = false`.
- Otherwise: `yield = 0`, `loss = true`.
- If `completed_stake > 0`: `reward_pot = yield + total_bonus`.
- If `completed_stake == 0`: `reward_pot = 0`; `yield` goes straight to `treasury`; sponsors take their bonus back through `claim_sponsor_refund`.
- status Finalized, `finalized_at = now`. emit `Finalized(id, final_assets, reward_pot, loss)`.

**expire(id)** (anyone, nonReentrant): allowed when
- status Open and `now >= end_time + settle_grace`, **or**
- status Disputed and `now >= disputed_at + DISPUTE_TIMEOUT`.
Redeems everything like finalize. `reward_pot = 0`. status Expired, `finalized_at = now`. Every participant receives `stake * final_assets / total_principal` (principal + yield pro rata, or principal shared with the loss). The bonus is refunded to sponsors. emit `Expired(id, final_assets)`.

**claim(id, bool completed, bytes32[] calldata proof)** (nonReentrant, even when paused)
- `stake = stake_of[id][msg.sender] > 0`, not yet `claimed`. Status Finalized or Expired.
- Sets `claimed = true` **before** transferring funds.
- **Principal part:**
  - Expired: `principal_out = stake * final_assets / total_principal` (includes yield).
  - Finalized and loss: `principal_out = stake * final_assets / total_principal`.
  - Finalized and no loss: `principal_out = stake`.
- **Reward part** (Finalized only, `completed == true`):
  - Verify: `leaf = keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(this), id, msg.sender, stake))))`, `MerkleProof.verifyCalldata(proof, root, leaf)` → revert `InvalidProof()` if wrong.
  - If `block.timestamp > finalized_at + CLAIM_PERIOD` or `rewards_swept`: reward = 0 (principal still paid).
  - `reward = min(reward_pot * stake / completed_stake, reward_pot - reward_paid)`; `reward_paid += reward`.
- `completed == false` needs no proof and receives no reward (a completer who picks wrong does not lose principal).
- `principal_paid += principal_out`. Transfers `principal_out + reward`.
- Badge (Finalized only): `badge.record_result(msg.sender, completed && proof_ok)`. No badge write when Expired. Wrapped in `try/catch` so a badge failure cannot block withdrawals; emit `BadgeUpdateFailed(id, account)` on failure.
- emit `Claimed(id, account, completed, principal_out, reward)`.

**claim_sponsor_refund(id)** (nonReentrant): status Expired, or (Finalized && completed_stake == 0). A sponsor with `sponsor_amount_of > 0` who has not been refunded → gets back exactly what they put in. emit `SponsorRefunded`.

**sweep_rewards(id)** (anyone, funds go to the treasury): status Finalized, `now > finalized_at + CLAIM_PERIOD`, not swept yet. Transfers `reward_pot - reward_paid` to the treasury, sets `rewards_swept = true`. Does **not** touch principal. emit `RewardsSwept`.

**View helpers** (for web/oracle): `get_challenge(id)`, `phase_of(id)` returns the derived enum (`Joining, Running, AwaitingSettle, DisputeWindow, Disputed, Finalized, Expired, Expirable`), `preview_claim(id, account, completed)` returns `(principal_out, reward)` (skips proof verification).

### Post-review fixes v0.2 (mandatory, win over the sections above when in conflict)
- **R1 (gas griefing to keep a streak):** Call the badge in `claim` with fixed gas `BADGE_GAS = 300_000`. Before the call, if `gasleft() < BADGE_GAS * 64 / 63 + 20_000` then revert `InsufficientGas()`. Then `try badge.record_result{gas: BADGE_GAS}(...)`. Purpose: the caller cannot deliberately supply too little gas so that the `completed=false` badge update (streak reset) silently fails. A badge failure for any other reason still cannot block withdrawals.
- **R2 (no pushing funds to the treasury in finalize):** `finalize` no longer transfers tokens. When `completed_stake == 0`, write `treasury_due = yield` to the challenge. A new function `collect_treasury(id)` (anyone, nonReentrant) transfers `treasury_due` to the treasury once, emit `TreasuryCollected(id, amount)`. Reason: a treasury blacklisted by USDC would make `finalize` revert and trap everyone's principal.
- **R3 (disputes must not profit from an absent guardian):** When status is `Disputed` and `now >= disputed_at + DISPUTE_TIMEOUT`, **`finalize` is allowed** and uses the current settlement. `expire` **no longer** applies to Disputed, only to Open past `end_time + settle_grace`. `phase_of`: Disputed past the timeout returns `Finalizable`. Reason: prevents non-completers from filing frivolous disputes to force `expire` and share the yield. A wrong oracle only affects rewards, not principal. `resolve_dispute` must still happen before the timeout.

### Errors (suggested)
`TokenNotAllowed, VaultNotAllowed, VaultAssetMismatch, InvalidParams, WrongStatus, TooEarly, TooLate, AlreadyJoined, StakeOutOfRange, NotParticipant, AlreadyClaimed, AlreadyDisputed, InvalidProof, InvalidSettlement, NothingToRefund, AlreadySwept, ZeroAddress, ZeroAmount`.

### Mandatory invariants (invariant test with a handler)
1. For every unfinished challenge: `vault.convertToAssets(total_shares) + tokens held ≥ total_principal` when the vault has no loss.
2. Total paid out of a challenge ≤ `total_principal + total_bonus + yield`.
3. Outside a vault loss, each participant can claim at least exactly `stake`.
4. `reward_paid <= reward_pot`.
5. Each person claims once; claim/expire/finalize work when paused.
6. The Manager's token balance ≥ total owed (unclaimed principal + unclaimed rewards + unrefunded bonus) after finalize/expire.

## Deploy (`script/Deploy.s.sol`)
- Reads env: `PRIVATE_KEY` (deployer = admin), `ORACLE_ADDRESS`, `TREASURY_ADDRESS`, `USE_CIRCLE_USDC` (bool), `CIRCLE_USDC` (defaults to `0x5425890298aed601595a70AB815c96711a31Bc65`).
- Deploys TestUSDC (always, as a backup), MockYieldVault for tUSDC, and if `USE_CIRCLE_USDC` another MockYieldVault for Circle USDC. Deploys StudyBadge, StudyStakeManager. Grants `MANAGER_ROLE` to the manager, `ORACLE_ROLE` to the oracle, `CREATOR_ROLE` + `GUARDIAN_ROLE` to the deployer. Allows the token/vault.
- Writes addresses to `deployments/<chainid>.json` (using `vm.writeJson`), read by web/oracle.
- Runs on Anvil (`--rpc-url http://127.0.0.1:8545`) and Fuji (`https://api.avax-test.network/ext/bc/C/rpc`, chainid 43113).
