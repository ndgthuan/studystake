# StudyStake — Spec v0.1 (Phase 0, chờ duyệt)

> **Cam kết học, không mất gốc.** Sinh viên đặt cọc USDC để cam kết nộp bài Moodle đúng hạn. Cọc được gửi vào vault sinh lãi. Người giữ cam kết nhận lại gốc, cộng thêm lãi của cả nhóm và quỹ thưởng tài trợ. Người trễ hạn vẫn nhận lại **100% gốc**, chỉ mất phần thưởng.

Hackathon: Team1 Vietnam UniHack. Hạn nộp: **23:59 21/11/2026**. Mạng: **Avalanche Fuji** (C-Chain testnet).

---

## 1. Vấn đề và giải pháp

| | |
|---|---|
| **Vấn đề** | Sinh viên trễ quiz/bài nộp trên Moodle vì thiếu động lực ngắn hạn. Các app nhắc lịch thì dễ bị lờ đi. Các mô hình "cược tiền" (StickK, Beeminder) gây cảm giác cờ bạc, và mất tiền thật làm người dùng ngại thử. |
| **Giải pháp** | Đặt cọc **no-loss** (không mất gốc). Động lực đến từ 3 nguồn: (1) lãi của cả pool chỉ chia cho người hoàn thành, (2) quỹ thưởng do trường/CLB/nhà tài trợ góp, (3) huy hiệu soulbound và chuỗi ngày (streak) công khai on-chain. |
| **Vì sao cần blockchain** | Tiền cọc không nằm trong tay ai: không có thủ quỹ hay công ty nào giữ hộ. Luật chia thưởng công khai và không sửa được. Kết quả xác minh có bằng chứng, ai cũng kiểm tra được. Huy hiệu là hồ sơ học tập mà sinh viên tự sở hữu. |

## 2. Luồng người dùng

1. **Đăng nhập** bằng Google qua **Privy**. Người dùng tự có ví embedded mà không cần cài MetaMask hay biết seed phrase. Ví ngoài (Core/MetaMask) vẫn dùng được.
2. **Nhận gas lần đầu:** Worker faucet tự gửi 0.05 AVAX Fuji cho tài khoản mới, có giới hạn tần suất.
3. **Liên kết Moodle:** dán Moodle mobile token. Oracle gọi `core_webservice_get_site_info` để xác định `userid`, sau đó ràng buộc `(site, userid) ↔ ví` một-một.
4. **Chọn challenge**, ví dụ "CSC10002 – Quiz tuần 10–12". Challenge ghi rõ khóa học, các hoạt động (quiz/assign) và hạn chót.
5. **Đặt cọc** 1–100 USDC bằng **một giao dịch** (EIP-2612 `permit` + join).
6. **Theo dõi tiến độ:** dashboard hiển thị từng hoạt động đã nộp hay chưa và đếm ngược thời gian.
7. **Kết thúc:** oracle tổng hợp kết quả thành Merkle root và đưa lên contract kèm hash bằng chứng. Sau đó có **cửa sổ khiếu nại** (24h, bản demo là 10 phút).
8. **Nhận tiền:** người hoàn thành nhận gốc + phần thưởng + huy hiệu SBT, streak +1. Người không hoàn thành nhận lại gốc.

## 3. Kiến trúc

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
Bằng chứng (JSON, chỉ chứa hash, không có tên): Cloudflare R2, keccak lưu on-chain
```

**Repo** (monorepo `unihack/`):
- `contracts/`: Foundry, Solidity 0.8.28, OpenZeppelin v5
- `oracle/`: Cloudflare Worker, TypeScript, viem, KV + R2
- `web/`: Next.js App Router, Privy, wagmi/viem, Tailwind, giao diện tiếng Việt/Anh, dark mode nền đen tuyền
- `docs/`: SPEC, THREAT_MODEL, DEMO_SCRIPT, PITCH

**Quy ước code:** tên hàm, biến, method dùng `snake_case` (theo quy ước của đội), kể cả trong Solidity và TS. Tên bắt buộc theo chuẩn như ERC (`transferFrom`, `permit`, `supportsInterface`...) và hook của React/Next (`useXxx`, component PascalCase) thì giữ nguyên.

## 4. Smart contract

### 4.1 `StudyStakeManager`
Vai trò (OpenZeppelin `AccessControl`):

| Role | Quyền | Không được làm |
|---|---|---|
| `DEFAULT_ADMIN` | cấp/thu hồi role, đặt treasury, allowlist token/vault | **Không** rút được gốc của bất kỳ ai |
| `CREATOR_ROLE` | tạo challenge | |
| `ORACLE_ROLE` | `settle` (đưa root), chỉ 1 lần mỗi challenge | Không động được vào tiền |
| `GUARDIAN_ROLE` | xử lý khiếu nại (thay root), `pause` việc join/settle | Không pause được `claim` hay `expire` |

**Trạng thái challenge:** `Open → Active → Settling → (Disputed →) Finalized`, hoặc `Expired` nếu oracle không settle kịp.

```
create_challenge(token, vault, min_stake, max_stake, join_deadline, end_time,
                 settle_grace, dispute_window, metadata_uri, metadata_hash)
sponsor(id, amount)                      // ai cũng góp quỹ thưởng được, trước end_time
join(id, amount) / join_with_permit(...) // trước join_deadline; 1 ví 1 lần
settle(id, root, completed_count, completed_stake, evidence_hash) // ORACLE, sau end_time, trước end_time+settle_grace
dispute(id, reason_hash)                 // participant, trong dispute_window
resolve_dispute(id, new_root, completed_count, completed_stake, evidence_hash) // GUARDIAN
finalize(id)                             // bất kỳ ai, sau dispute_window; redeem vault, chốt pot
expire(id)                               // bất kỳ ai, nếu quá end_time+settle_grace mà chưa settle
claim(id, completed, proof)              // gốc + (nếu completed và proof hợp lệ) thưởng; mint/cập nhật badge
sweep_rewards(id)                        // sau claim_period 180 ngày: chỉ phần THƯỞNG chưa nhận → treasury
```

**Leaf Merkle:** `keccak256(bytes.concat(keccak256(abi.encode(chain_id, manager, id, account, stake))))`. Leaf được băm 2 lần theo chuẩn OpenZeppelin `StandardMerkleTree` để chống tấn công second-preimage. Leaf có `chain_id` và địa chỉ contract nên không dùng lại được ở chain hay contract khác. Cây chỉ chứa người hoàn thành.

**Kế toán khi `finalize`:**
- `assets = vault.redeem(all_shares)`, `P` = tổng gốc.
- Nếu `assets ≥ P`: lãi `Y = assets − P`, pot thưởng `R = Y + bonus`.
- Nếu `assets < P` (vault lỗ): mọi người nhận `stake × assets / P` và `R = bonus`. Phần README ghi rõ: no-loss chỉ an toàn bằng nguồn sinh lãi.
- Phần thưởng của người i: `min(R × stake_i / completed_stake, R − paid)`. Nếu oracle khai sai `completed_stake` thì phần thưởng bị giới hạn, **không bao giờ lấn vào gốc**.
- Nếu `completed_stake == 0`: lãi về treasury, bonus hoàn lại cho từng sponsor theo tỉ lệ.
- `expire`: mọi người nhận gốc + lãi chia theo tỉ lệ cọc, bonus hoàn lại sponsor.

**Bất biến (invariant), kiểm bằng fuzz/invariant test:**
1. `token.balanceOf(manager) + giá trị share trong vault ≥ tổng gốc chưa claim + thưởng chưa claim` (trừ khi vault lỗ).
2. Tổng tiền trả ra của một challenge ≤ tiền vào + lãi.
3. Không role nào làm giảm được số gốc mà một participant claim được (trừ khi vault lỗ).
4. Mỗi `(id, account)` chỉ claim được 1 lần. Mỗi challenge chỉ settle 1 lần (trừ khi resolve dispute).
5. `claim` và `expire` không bao giờ bị pause.

**An toàn kỹ thuật:** `ReentrancyGuard`, `SafeERC20`, checks-effects-interactions. Chỉ cho phép token/vault trong allowlist, không nhận token fee-on-transfer hay rebasing. Mọi tham số thời gian được kiểm tra hợp lệ. Emit event đầy đủ cho indexer và UI.

### 4.2 `MockYieldVault` (ERC-4626, chỉ dùng trên Fuji)
- Fuji không có Aave/Benqi hoạt động, nên lãi trên testnet là **mô phỏng**. Bản demo nói thẳng điều này.
- Owner nạp "quỹ lãi", vault nhả dần theo APR cấu hình (ví dụ 8%/năm) bằng cách tăng `totalAssets` tuyến tính. Dùng OpenZeppelin ERC-4626 có `_decimalsOffset` để chống inflation attack.
- Cho mainnet: interface `IYieldSource` và `AaveV3Adapter` qua static aToken ERC-4626 (lộ trình, có thể có kèm test fork nếu kịp).

### 4.3 `StudyBadge` (ERC-721 soulbound, ERC-5192)
- Mint khi claim lần đầu ở trạng thái completed. Mỗi ví có 1 badge, mỗi lần hoàn thành thì `streak` và `total_completed` tăng.
- `tokenURI` sinh SVG on-chain (cấp độ Đồng/Bạc/Vàng theo streak). Không chuyển nhượng được, `locked() = true`.
- Chỉ Manager có quyền mint/update.

### 4.4 Token
- Mặc định dùng **USDC Fuji của Circle** (`0x5425890298aed601595a70AB815c96711a31Bc65`, có `permit`). Người dùng lấy USDC ở faucet.circle.com.
- Dự phòng `tUSDC` (mock, 6 decimals, có faucet trong app) nếu faucet của Circle bị giới hạn khi demo.

## 5. Oracle (Cloudflare Worker)

| Endpoint | Chức năng |
|---|---|
| `POST /link/moodle` | Xác thực Privy JWT. Nhận Moodle token, gọi site_info, ràng buộc `(site,userid)↔wallet` (1-1, lưu trong KV). Token mã hóa AES-GCM bằng secret, **xóa sau khi challenge settle** |
| `POST /link/demo` | Liên kết với **Demo LMS** để giám khảo và người xem tự thử mà không cần Moodle của HCMUS |
| `GET /progress/:id/:wallet` | Tiến độ từng hoạt động |
| `POST /faucet` | Gửi 0.05 AVAX cho người dùng mới. Giới hạn theo Privy user id và địa chỉ, có Turnstile |
| `cron */5` | Tìm challenge đã quá `end_time` → kiểm tra từng participant → dựng `StandardMerkleTree` → upload bằng chứng JSON lên R2 → `settle()` |
| `GET /evidence/:id` | Tải JSON bằng chứng và file tree để tự kiểm tra |

**Thế nào là "hoàn thành":** mọi hoạt động trong challenge đều có submission/attempt trạng thái `finished`/`submitted` với `timefinish ≤ min(duedate, end_time)`. Có thể đặt thêm điểm tối thiểu.
- Quiz: `mod_quiz_get_user_attempts`
- Assign: `mod_assign_get_submission_status`

**Demo LMS:** một mini-LMS nằm trong cùng Worker, có trang "Làm quiz demo" và nút "Nộp bài". Dùng cho video, Demo Day và giám khảo, được gắn nhãn DEMO rõ ràng.

## 6. Web (Next.js)
Các trang: `/` landing · `/challenges` · `/challenges/[id]` (join, tiến độ, đếm ngược, bằng chứng) · `/me` (khoản cọc, badge, streak, claim) · `/link` (Moodle/Demo) · `/admin` (tạo challenge, sponsor, theo dõi settle/khiếu nại) · `/verify/[id]` (ai cũng tự kiểm Merkle được).

UX: mọi giao dịch có trạng thái rõ ràng (đang ký → đang xác nhận → xong) và link Snowtrace. Lỗi được dịch sang tiếng người. Kiểm tra mạng sai, thiếu gas, thiếu USDC kèm hướng dẫn xin faucet.

## 7. Điểm cộng Avalanche Integration
1. Contract **verified trên Snowtrace**, cả 3 contract.
2. **Privy embedded wallet + faucet gas tự động** cho người dùng không biết crypto.
3. **USDC Fuji của Circle + EIP-2612 permit**: một giao dịch là xong.
4. **ERC-4626 yield + adapter Aave v3 cho C-Chain mainnet**: kiến trúc sẵn sàng chạy thật.
5. **SBT với SVG on-chain**: hồ sơ học tập mà sinh viên tự sở hữu.
6. *(Stretch)* **x402 "Study Reputation API"**: app khác trả 0.001 USDC để truy vấn streak của một ví.
7. *(Stretch/lộ trình)* **StudyNet L1** riêng cho trường qua Builder Console, kèm ICM để mang badge sang C-Chain.

## 8. Những gì nằm ngoài phạm vi MVP (ghi rõ trong pitch)
- Lãi thật: chỉ có trên mainnet qua Aave adapter.
- Oracle phi tập trung: lộ trình là zkTLS (Reclaim/TLSNotary) để chứng minh dữ liệu Moodle mà không cần đưa token, hoặc plugin Moodle do trường chạy làm oracle.
- Kháng nghị không cần guardian: lộ trình là đa oracle hoặc bỏ phiếu.

## 9. Kế hoạch và tiêu chí xong (Definition of Done)

| Phase | Nội dung | Xong khi | Hạn |
|---|---|---|---|
| 0 | Spec + threat model | Đội duyệt | 3/11 |
| 1 | Contracts | Unit test + fuzz + invariant xanh; Slither không còn lỗi high/medium; coverage ≥ 95% | 7/11 |
| 2 | Oracle | Test adapter Moodle với dữ liệu thật (token của Thuận); Demo LMS chạy; settle trên Anvil | 9/11 |
| 3 | Web | Toàn bộ luồng chạy được trên Anvil local; dùng tốt ở mobile 375px | 13/11 |
| 4 | Fuji | Deploy + verify; chạy E2E bằng Playwright trên Fuji; review toàn bộ lần cuối | 16/11 |
| 5 | Người dùng + nộp bài | ≥ 20 người dùng thật; slide; video 2–3 phút; repo public/README | 21/11 |

Các agent Haiku làm phần code. Lead (Opus) viết spec, review từng PR theo threat model và tự chạy lại test để kiểm tra.
