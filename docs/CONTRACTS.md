# StudyStake — Contract spec chi tiết (Phase 1)

Nguồn chuẩn để implement và viết test. Khi có mâu thuẫn, file này thắng SPEC.md §4. Mọi thay đổi phải hỏi lead.

## Chung
- Foundry, `solc 0.8.28`, `evm_version = "cancun"` (Avalanche C-Chain hỗ trợ), optimizer 200 runs, `via_ir = false`.
- OpenZeppelin Contracts **v5.x** (`lib/openzeppelin-contracts`), import theo remapping `@openzeppelin/contracts/`.
- **Đặt tên:** hàm/biến/tham số tự định nghĩa dùng `snake_case`. Giữ nguyên tên bắt buộc theo chuẩn/OZ/Foundry: `transfer`, `permit`, `totalAssets`, `supportsInterface`, `tokenURI`, `locked`, `run`, `setUp`, `test_*`, `invariant_*`. Event và custom error dùng PascalCase, struct/contract PascalCase, hằng số UPPER_CASE.
- NatSpec cho mọi hàm external.
- Custom error, không dùng `require` có chuỗi.

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
- `faucet()`: mint 1_000e6 cho `msg.sender`, mỗi địa chỉ 1 lần / 24h (`last_faucet[addr]`). Error `FaucetCooldown(uint256 next_time)`.
- `mint(address to, uint256 amount)` chỉ owner (Ownable).

## MockYieldVault (`src/mocks/MockYieldVault.sol`)
`ERC4626` (OZ) + `Ownable`. `_decimalsOffset() = 6`.
Mô phỏng lãi bằng **drip tuyến tính**:
- `fund_yield(uint256 amount, uint64 duration)` (owner): `safeTransferFrom` amount vào vault. Phần lãi chưa nhả còn lại của đợt drip trước được cộng vào đợt mới: `new_total = unreleased() + amount`, `drip_start = now`, `drip_end = now + duration`. `duration > 0`.
- `unreleased()`: `now >= drip_end ? 0 : drip_total * (drip_end - now) / (drip_end - drip_start)`.
- `totalAssets() = asset.balanceOf(this) - unreleased()`.
- Event `YieldFunded(uint256 amount, uint64 drip_end)`.
- `loss_for_testing(uint256 amount)` (owner): chuyển `amount` asset ra owner để mô phỏng vault lỗ (dùng trong test và demo). Comment rõ: CHỈ CHO TESTNET.

## StudyBadge (`src/StudyBadge.sol`) — ERC-721 soulbound + ERC-5192
`ERC721("StudyStake Badge","STUDY") + AccessControl`. `MANAGER_ROLE`.
- Mỗi ví tối đa 1 token. `badge_of[account] → token_id` (0 = chưa có, token id bắt đầu từ 1).
- Struct `Stats { uint32 streak; uint32 best_streak; uint32 total_completed; uint32 total_failed; uint64 last_update; }`, `stats_of[token_id]`.
- `record_result(address account, bool completed)` (MANAGER):
  - completed: nếu chưa có badge → mint. `streak++`, `best_streak = max`, `total_completed++`.
  - not completed: nếu có badge → `streak = 0`, `total_failed++`. Chưa có badge thì không làm gì.
  - emit `ResultRecorded(account, token_id, completed, streak)`.
- Soulbound: override `_update` → revert `Soulbound()` nếu `from != 0 && to != 0`. `approve`/`setApprovalForAll` revert `Soulbound()`.
- ERC-5192: `locked(uint256) → true` (revert nếu token không tồn tại), emit `Locked(token_id)` khi mint, `supportsInterface(0xb45a3c0e) = true`.
- `tokenURI`: `data:application/json;base64,...` có `name`, `description`, `attributes` (streak, best_streak, total_completed, tier) và `image` là SVG base64 sinh on-chain. Tier: `best_streak >= 10` Gold, `>= 3` Silver, còn lại Bronze. SVG nền đen `#000`, màu tier, hiển thị streak lớn. Dùng OZ `Base64`, `Strings`.

## StudyStakeManager (`src/StudyStakeManager.sol`)
`AccessControl + ReentrancyGuard + Pausable`. Roles: `DEFAULT_ADMIN_ROLE`, `CREATOR_ROLE`, `ORACLE_ROLE`, `GUARDIAN_ROLE`.

### Hằng số
- `MAX_PARTICIPANTS` không cần (không lặp).
- `CLAIM_PERIOD = 180 days` tính từ `finalized_at`.
- `DISPUTE_TIMEOUT = 7 days`.
- Giới hạn tham số: `dispute_window ∈ [5 minutes, 7 days]`, `settle_grace ∈ [10 minutes, 14 days]`, `join_deadline > now`, `end_time >= join_deadline`, `0 < min_stake <= max_stake`.

### State
```solidity
enum Status { None, Open, Settled, Disputed, Finalized, Expired }
// "Open" bao gồm cả giai đoạn join và giai đoạn làm bài; UI suy ra phase từ thời gian.

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
  uint64 finalized_at; uint256 final_assets;        // assets nhận về từ vault
  uint128 reward_pot; uint128 reward_paid;
  uint128 principal_paid;                            // tổng phần "gốc" đã trả
  bool loss;                                         // final_assets < total_principal
  bool rewards_swept;
}
mapping(uint256 => Challenge) public challenges;   // getter riêng get_challenge(id) trả struct
mapping(uint256 => mapping(address => uint128)) public stake_of;
mapping(uint256 => mapping(address => uint64)) public joined_at;
mapping(uint256 => mapping(address => bool)) public claimed;
mapping(uint256 => mapping(address => bool)) public has_disputed;
mapping(uint256 => mapping(address => uint128)) public sponsor_amount_of;
mapping(uint256 => mapping(address => bool)) public sponsor_refunded;
mapping(address => bool) public allowed_token;
mapping(address => bool) public allowed_vault;   // vault.asset() phải là token được allow
address public treasury; IStudyBadge public immutable badge;
uint256 public challenge_count;  // id bắt đầu từ 1
```

### Hàm
**Admin**
- `constructor(address admin, address treasury_, IStudyBadge badge_)`.
- `set_treasury(address)`, `set_allowed_token(address,bool)`, `set_allowed_vault(address,bool)` (DEFAULT_ADMIN).
- `pause()/unpause()` (GUARDIAN). Pause chặn: `create_challenge`, `join*`, `sponsor`, `settle`. **KHÔNG** chặn: `claim`, `finalize`, `expire`, `dispute`, `resolve_dispute`, `claim_sponsor_refund`, `sweep_rewards`.

**create_challenge** (CREATOR, whenNotPaused)
`(IERC20 token, IERC4626 vault, uint128 min_stake, uint128 max_stake, uint64 join_deadline, uint64 end_time, uint64 settle_grace, uint64 dispute_window, bytes32 metadata_hash, string calldata metadata_uri) → uint256 id`
- Kiểm: token allowed, vault allowed, `vault.asset() == token`, giới hạn tham số. Status = Open.
- emit `ChallengeCreated(id, creator, token, vault, join_deadline, end_time, metadata_hash, metadata_uri)`.

**sponsor(id, amount)** (whenNotPaused): status Open, `now < end_time`, amount > 0. Token giữ dạng raw trong Manager (không gửi vào vault). `total_bonus += amount`, `sponsor_amount_of[id][msg.sender] += amount`. emit `Sponsored`.

**join(id, amount)** / **join_with_permit(id, amount, deadline, v, r, s)** (whenNotPaused, nonReentrant)
- status Open, `now < join_deadline`, chưa join (`stake_of == 0`), `min_stake <= amount <= max_stake`.
- permit gói trong `try ... catch {}` (chống front-run griefing); sau đó luôn `safeTransferFrom`.
- `forceApprove(vault, amount)`, `shares = vault.deposit(amount, address(this))`. Cập nhật `total_principal`, `total_shares`, `participant_count`, `stake_of`, `joined_at = now`.
- emit `Joined(id, account, amount, shares, joined_at)`. Oracle chỉ tính bài nộp có `timefinish >= joined_at`.

**settle(id, root, completed_count, completed_stake, evidence_hash)** (ORACLE, whenNotPaused)
- status Open, `end_time <= now < end_time + settle_grace`.
- `completed_count <= participant_count`, `completed_stake <= total_principal`, `(completed_count == 0) == (completed_stake == 0)`, root != 0 trừ khi completed_count == 0.
- Lưu, `settled_at = now`, status Settled. emit `Settled(...)`.

**dispute(id, bytes32 reason_hash)**: status Settled, `now < settled_at + dispute_window`, `stake_of[id][msg.sender] > 0`, chưa `has_disputed`. Status Disputed, `disputed_at = now`. emit `Disputed(id, account, reason_hash)`.

**resolve_dispute(id, root, completed_count, completed_stake, evidence_hash)** (GUARDIAN): status Disputed. Kiểm như settle. Ghi đè, `settled_at = now` (mở lại cửa sổ khiếu nại; mỗi người chỉ khiếu nại được 1 lần nên không spam vô hạn được), status Settled. emit `DisputeResolved(...)`.

**finalize(id)** (ai cũng gọi, nonReentrant): status Settled, `now >= settled_at + dispute_window`. Gọi `_redeem_all(id)`, rồi:
- `final_assets = vault.redeem(total_shares, address(this), address(this))` (nếu total_shares > 0).
- Nếu `final_assets >= total_principal`: `yield = final_assets - total_principal`, `loss = false`.
- Ngược lại: `yield = 0`, `loss = true`.
- Nếu `completed_stake > 0`: `reward_pot = yield + total_bonus`.
- Nếu `completed_stake == 0`: `reward_pot = 0`; `yield` chuyển ngay cho `treasury`; bonus để sponsor tự lấy lại qua `claim_sponsor_refund`.
- status Finalized, `finalized_at = now`. emit `Finalized(id, final_assets, reward_pot, loss)`.

**expire(id)** (ai cũng gọi, nonReentrant): cho phép khi
- status Open và `now >= end_time + settle_grace`, **hoặc**
- status Disputed và `now >= disputed_at + DISPUTE_TIMEOUT`.
Redeem toàn bộ như finalize. `reward_pot = 0`. status Expired, `finalized_at = now`. Mọi participant nhận `stake * final_assets / total_principal` (gốc + lãi theo tỉ lệ, hoặc gốc bị chia lỗ). Bonus được refund cho sponsor. emit `Expired(id, final_assets)`.

**claim(id, bool completed, bytes32[] calldata proof)** (nonReentrant, kể cả khi paused)
- `stake = stake_of[id][msg.sender] > 0`, chưa `claimed`. Status Finalized hoặc Expired.
- Đặt `claimed = true` **trước** khi chuyển tiền.
- **Phần gốc:**
  - Expired: `principal_out = stake * final_assets / total_principal` (đã gồm lãi).
  - Finalized và loss: `principal_out = stake * final_assets / total_principal`.
  - Finalized và không loss: `principal_out = stake`.
- **Phần thưởng** (chỉ Finalized, `completed == true`):
  - Verify: `leaf = keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(this), id, msg.sender, stake))))`, `MerkleProof.verifyCalldata(proof, root, leaf)` → nếu sai revert `InvalidProof()`.
  - Nếu `block.timestamp > finalized_at + CLAIM_PERIOD` hoặc `rewards_swept`: reward = 0 (vẫn trả gốc).
  - `reward = min(reward_pot * stake / completed_stake, reward_pot - reward_paid)`; `reward_paid += reward`.
- `completed == false` thì không cần proof và không nhận thưởng (người hoàn thành tự chọn sai cũng không bị mất gốc).
- `principal_paid += principal_out`. Chuyển `principal_out + reward`.
- Badge (chỉ khi Finalized): `badge.record_result(msg.sender, completed && proof_ok)`. Khi Expired thì không ghi badge. Bọc trong `try/catch` để badge lỗi không chặn được việc rút tiền; emit `BadgeUpdateFailed(id, account)` nếu lỗi.
- emit `Claimed(id, account, completed, principal_out, reward)`.

**claim_sponsor_refund(id)** (nonReentrant): status Expired, hoặc (Finalized && completed_stake == 0). Sponsor có `sponsor_amount_of > 0` và chưa refund → nhận lại đúng số đã góp. emit `SponsorRefunded`.

**sweep_rewards(id)** (ai cũng gọi, tiền về treasury): status Finalized, `now > finalized_at + CLAIM_PERIOD`, chưa swept. Chuyển `reward_pot - reward_paid` cho treasury, đặt `rewards_swept = true`. **Không** đụng phần gốc. emit `RewardsSwept`.

**View helpers** (cho web/oracle): `get_challenge(id)`, `phase_of(id)` trả enum suy ra (`Joining, Running, AwaitingSettle, DisputeWindow, Disputed, Finalized, Expired, Expirable`), `preview_claim(id, account, completed)` trả `(principal_out, reward)` (bỏ qua verify proof).

### Sửa sau review v0.2 (bắt buộc, thắng các mục ở trên nếu mâu thuẫn)
- **R1 (chống bóp gas để giữ streak):** Gọi badge trong `claim` với gas cố định `BADGE_GAS = 300_000`. Trước khi gọi, nếu `gasleft() < BADGE_GAS * 64 / 63 + 20_000` thì revert `InsufficientGas()`. Sau đó `try badge.record_result{gas: BADGE_GAS}(...)`. Mục đích: người gọi không thể cố tình cấp thiếu gas để lần cập nhật badge `completed=false` (reset streak) thất bại âm thầm. Badge lỗi vì lý do khác vẫn không chặn được việc rút tiền.
- **R2 (không đẩy tiền ra treasury trong finalize):** `finalize` không chuyển token nữa. Khi `completed_stake == 0`, ghi `treasury_due = yield` vào challenge. Hàm mới `collect_treasury(id)` (ai cũng gọi, nonReentrant) chuyển `treasury_due` cho treasury một lần, emit `TreasuryCollected(id, amount)`. Lý do: treasury bị blacklist USDC sẽ làm `finalize` revert, kéo theo gốc của mọi người bị kẹt.
- **R3 (khiếu nại không được thưởng cho việc guardian vắng mặt):** Khi status `Disputed` và `now >= disputed_at + DISPUTE_TIMEOUT` thì **`finalize` được phép** và dùng settlement hiện tại. `expire` **không** còn áp dụng cho Disputed, chỉ còn cho Open quá `end_time + settle_grace`. `phase_of`: Disputed quá timeout trả `Finalizable`. Lý do: tránh việc người không hoàn thành khiếu nại vô cớ để ép `expire` chia lãi cho cả mình. Oracle sai thì cũng chỉ ảnh hưởng thưởng, không ảnh hưởng gốc. `resolve_dispute` vẫn phải trước timeout.

### Errors (gợi ý)
`TokenNotAllowed, VaultNotAllowed, VaultAssetMismatch, InvalidParams, WrongStatus, TooEarly, TooLate, AlreadyJoined, StakeOutOfRange, NotParticipant, AlreadyClaimed, AlreadyDisputed, InvalidProof, InvalidSettlement, NothingToRefund, AlreadySwept, ZeroAddress, ZeroAmount`.

### Bất biến bắt buộc test (invariant test có handler)
1. Với mọi challenge chưa xong: `vault.convertToAssets(total_shares) + token còn giữ ≥ total_principal` khi vault không lỗ.
2. Tổng tiền đã trả ra của một challenge ≤ `total_principal + total_bonus + yield`.
3. Ngoài trường hợp vault lỗ, mỗi participant claim được ít nhất đúng `stake`.
4. `reward_paid <= reward_pot`.
5. Mỗi người claim 1 lần; claim/expire/finalize chạy được khi paused.
6. Số dư token của Manager ≥ tổng còn nợ (gốc chưa claim + thưởng chưa claim + bonus chưa refund) sau finalize/expire.

## Deploy (`script/Deploy.s.sol`)
- Đọc env: `PRIVATE_KEY` (deployer = admin), `ORACLE_ADDRESS`, `TREASURY_ADDRESS`, `USE_CIRCLE_USDC` (bool), `CIRCLE_USDC` (mặc định `0x5425890298aed601595a70AB815c96711a31Bc65`).
- Deploy TestUSDC (luôn có, để dự phòng), MockYieldVault cho tUSDC, nếu `USE_CIRCLE_USDC` thì thêm MockYieldVault cho USDC Circle. Deploy StudyBadge, StudyStakeManager. Grant `MANAGER_ROLE` cho manager, `ORACLE_ROLE` cho oracle, `CREATOR_ROLE` + `GUARDIAN_ROLE` cho deployer. Allow token/vault.
- Ghi địa chỉ ra `deployments/<chainid>.json` (dùng `vm.writeJson`), web/oracle đọc file này.
- Chạy được trên Anvil (`--rpc-url http://127.0.0.1:8545`) và Fuji (`https://api.avax-test.network/ext/bc/C/rpc`, chainid 43113).
