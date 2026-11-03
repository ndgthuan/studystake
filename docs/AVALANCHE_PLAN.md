# StudyStake: Kế hoạch tăng điểm Avalanche Integration

> Mục tiêu: tối đa 50 điểm vòng loại (Technical 25 + Avalanche Integration 25).
> Hôm nay 3/11. Hạn nộp: **23:59 21/11/2026**. Còn 18 ngày.

## Vấn đề hiện tại

Code hiện tại là EVM chung: deploy lên Ethereum hay Polygon cũng chạy y hệt. Những thứ đặc trưng của Avalanche (x402, L1 riêng, ICM) đều nằm trong "lộ trình". Ngoài ra dự án **chưa deploy lên Fuji** (`web/src/generated/deployments.json` vẫn là địa chỉ Anvil).

Giám khảo chấm 25 điểm này theo câu hỏi: *"Phần nào của sản phẩm chỉ có ý nghĩa khi chạy trên Avalanche, và nó có chạy thật trên chain không?"*

## Tổng quan 3 tầng

| Tầng | Nội dung | Mức ưu tiên | Hạn |
|---|---|---|---|
| **P0** | Chạy thật trên Fuji: deploy, verify, Circle USDC, Privy, Core wallet | Bắt buộc | **9/11** |
| **P1** | x402 "Study Credential API", doanh thu x402 nạp lại quỹ thưởng | Nên làm | **15/11** |
| **P2** | StudyNet L1 + ICM: hồ sơ học tập nằm trên L1 của trường | Stretch | **18/11** |
| | Đóng băng code, quay video, làm slide, nộp | | **19–21/11** |

Nguyên tắc: **P0 chưa xong thì không đụng tới P1. P1 chưa chạy trên Fuji thì không đụng tới P2.** Một tính năng chạy thật trên Fuji có giá trị hơn ba tính năng chỉ có trên Anvil.

---

## P0: Chạy thật trên Fuji (3/11 → 9/11)

### Việc cần làm
1. **Chuyển token chính sang Circle USDC Fuji** (`0x5425890298aed601595a70AB815c96711a31Bc65`).
   - Lý do: đây là USDC native của Circle, đúng với USDC trên C-Chain mainnet. Nó có cả EIP-2612 (permit) lẫn **EIP-3009** (`transferWithAuthorization`), và x402 ở P1 **bắt buộc** cần EIP-3009. `TestUSDC` hiện tại chỉ có permit.
   - Deploy với `USE_CIRCLE_USDC=true`. Giữ tUSDC làm phương án dự phòng (Circle faucet có captcha, người dùng phải tự xin).
   - Mặc định trên web (`/challenges`, `/admin`) dùng challenge Circle USDC.
2. **Deploy + verify cả 4 contract trên Snowtrace** (Manager, Badge, 2 vault). Dán link Snowtrace vào README.
   - Kiểm tra `evm_version = "cancun"` trong `foundry.toml` deploy ổn trên Fuji (chạy thử `forge script` với `--rpc-url` Fuji trước khi broadcast).
3. **Deploy oracle Worker** với địa chỉ thật (`MANAGER_ADDRESS`, `DEPLOY_BLOCK`, KV id, R2 bucket, secrets). Chỉnh `ALLOWED_ORIGINS` theo domain web.
4. **Deploy web** (Vercel hoặc Cloudflare Pages), chạy `sync_deployments` để lấy địa chỉ Fuji.
5. **Privy với App ID thật**: test đăng nhập Google → ví embedded → faucet AVAX → join → claim, chạy hết trên Fuji.
6. **Hỗ trợ Core wallet** (ví của Avalanche) ngoài MetaMask, theo starter "Connect a wallet" của BTC.
7. **Chạy một challenge thật trên Fuji** bằng Demo LMS, từ đầu đến cuối (join → settle → dispute window → finalize → claim). Lưu lại tx hash của từng bước để đưa vào README và video.

### Xong khi
- [ ] README có bảng địa chỉ Fuji kèm link Snowtrace đã verify
- [ ] Một người ngoài đội mở web, đăng nhập Google, join và claim được trên Fuji mà không cần hướng dẫn
- [ ] Playwright E2E chạy được trên Fuji (hoặc ít nhất một bản ghi màn hình đầy đủ)

---

## P1: x402 "Study Credential API" (9/11 → 15/11)

### Ý tưởng
Badge và streak đã công khai on-chain, nên **không bán dữ liệu đó**. Giám khảo sẽ hỏi: "Ai cũng đọc được on-chain miễn phí, sao phải trả tiền?"

Thứ chỉ oracle mới biết là: *ví này đã được liên kết với một tài khoản Moodle thật của trường X, và đã hoàn thành N challenge đúng hạn*. Oracle có thể **ký chứng nhận** (EIP-712) cho thông tin đó. Đây chính là thứ đáng trả tiền.

- **Người mua:** app học bổng, nhà tuyển dụng thực tập, CLB, hoặc **AI agent** cần xác minh "sinh viên chăm chỉ thật" mà không phải tin vào ảnh chụp màn hình.
- **Giá:** 0.001–0.01 USDC mỗi lần gọi, trả qua x402, **người mua không cần AVAX** (facilitator trả gas).
- **Vòng lặp kinh tế (điểm sáng tạo):** doanh thu x402 chảy về treasury, rồi treasury gọi `sponsor()` để **nạp lại quỹ thưởng** cho challenge kỳ sau. Nhờ đó giải được điểm yếu "lãi testnet quá ít, không đủ tạo động lực" với một nguồn thưởng có thật và lặp lại được.

### Thiết kế
```
GET /x402/credential/:wallet          (oracle Worker)
  → 402 Payment Required: 0.005 USDC, Avalanche Fuji, pay_to = TREASURY
  → client ký EIP-3009 authorization, gửi lại header PAYMENT-SIGNATURE
  → Worker gọi facilitator /verify → đọc badge on-chain + link KV
  → ký EIP-712 Credential → facilitator /settle → trả 200 + tx hash
```
`Credential` (EIP-712, ký bằng khóa oracle):
```
{ wallet, subject_hash, site_hash, streak, best_streak, total_completed, total_failed, issued_at, expires_at }
```
- Không chứa tên, MSSV hay userid thô (giống quy tắc của evidence).
- Chỉ trả credential khi chủ ví đã **đồng ý công khai** (thêm cờ `share_credential` khi link, ký bằng ví). Người dùng kiểm soát dữ liệu của mình, đúng tinh thần threat model.
- Thêm trang `/credential/verify` trên web: dán credential vào, web khôi phục người ký (`recoverTypedData`), so với địa chỉ oracle on-chain (`ORACLE_ROLE`), rồi đọc badge để đối chiếu.

### Ghi chú kỹ thuật
- Lấy code từ starter của BTC: <https://team1vn.xyz/demos.html#x402-pay-per-request> (Express, `@x402` pin ở bản 2.28).
- Oracle là **Cloudflare Worker, không phải Express**, nên không dùng được middleware Express. Có 2 cách:
  1. Dùng gói `@x402` phần core/fetch nếu chạy được trên Workers (cần kiểm tra trước, mất khoảng nửa ngày).
  2. Tự viết luồng 402 (khoảng 150 dòng): trả header `PAYMENT-REQUIRED`, nhận `PAYMENT-SIGNATURE`, gọi HTTP `/verify` và `/settle` của facilitator. Starter có sẵn `src/facilitator.mjs` để đọc định dạng.
- Starter ghi rõ: thư viện x402 **không biết USDC trên Fuji**, phải khai báo đầy đủ địa chỉ token, `name` và `version` (xem `src/networks.mjs` của starter).
- **Tự chạy facilitator riêng cho Demo Day** (starter có sẵn), để không phụ thuộc facilitator công cộng.
- Viết thêm `scripts/agent_buyer.mjs`: một "agent học bổng" tự trả tiền và lấy credential của 3 ví. Đây là cảnh demo cho video.
- Test: vitest cho luồng 402 (thiếu header → 402, chữ ký sai → 402, đúng → 200 + credential hợp lệ), kèm một lần trả tiền thật trên Fuji có tx hash.

### Xong khi
- [ ] Gọi API trên Fuji: tiền USDC chuyển thật vào treasury, có tx Snowtrace
- [ ] Credential verify được trên `/credential/verify`
- [ ] Có script hoặc nút admin cho treasury `sponsor()` challenge mới bằng doanh thu x402

---

## P2 (stretch): StudyNet L1 + ICM (15/11 → 18/11)

### Ý tưởng
Mỗi trường chạy một **Avalanche L1 riêng** ("StudyNet"). Hồ sơ học tập (badge, streak) nằm trên chain do trường kiểm soát, sinh viên không phải trả gas. Tiền (USDC, vault) vẫn ở **C-Chain**, nơi có thanh khoản thật. Hai chain nói chuyện với nhau qua **ICM (Teleporter)**.

```
C-Chain Fuji: StudyStakeManager.claim()
   → StudyBadge.record_result()   (giữ như cũ)
   → BadgeICMSender.send(account, stats) ──ICM──▶ StudyNet L1: BadgeRegistry.receive()
```
- Làm theo chiều C-Chain → L1, thêm **một contract gửi** riêng, **không sửa `StudyStakeManager`**. Nhờ vậy 92 test hiện tại vẫn xanh và không mở thêm rủi ro cho tiền gốc.
- Tạo L1 bằng Builder Console: <https://build.avax.network/console/create-l1?ref=HVHXK&utm_source=team1>

### Rủi ro (đọc kỹ trước khi bắt đầu)
- **Cần kiểm tra:** L1 testnet tạo qua Builder Console có tự hết hạn hay không, và có sẵn ICM relayer không. Nếu L1 tắt trước khi giám khảo chấm (21–23/11) thì phần này sẽ vỡ. Khi đó chỉ trình bày trong video (có tx hash), **không** để nó nằm trong luồng chính của web.
- Nếu đến 15/11 mà P1 chưa xong thì **bỏ P2**. Chỉ trình bày L1 + ICM trong slide như lộ trình, kèm sơ đồ kiến trúc.

### Xong khi
- [ ] Có ít nhất một message ICM thành công C-Chain → L1, kèm tx hash cả hai phía
- [ ] Video có cảnh claim trên C-Chain rồi badge xuất hiện trên L1

---

## Những việc nhỏ nhưng đáng làm (làm xen kẽ)
- README và slide có mục **"Vì sao Avalanche"**, mỗi ý đi kèm bằng chứng:
  - Finality dưới 1 giây → claim xong là thấy tiền ngay (quay màn hình)
  - Phí thấp → cọc 1 USDC vẫn hợp lý (ghi phí gas thực tế của `join_with_permit` trên Fuji)
  - Circle USDC native + EIP-3009 → x402 không cần gas
  - L1 cho từng trường → dữ liệu học tập thuộc về trường và sinh viên
- Bảng "Tx thật trên Fuji" trong README: join, settle, finalize, claim, x402 payment, mỗi dòng một link Snowtrace.
- Cập nhật bảng "Tích hợp Avalanche" trong README cho đúng thực tế. **Không ghi ✓ cho thứ chưa chạy trên Fuji**, giám khảo sẽ bấm thử.
- Làm Builder Pass (5 nhiệm vụ) cho cả đội.

## Phân công gợi ý (đội ≤ 3 người)
| Người | P0 | P1 | P2 |
|---|---|---|---|
| A (Solidity) | Deploy + verify Fuji, Circle USDC | EIP-712 Credential, ký và verify | ICM sender/receiver |
| B (Backend) | Deploy Worker, R2/KV, secrets | Luồng x402 trong Worker, facilitator riêng, agent buyer | Relayer/L1 setup |
| C (Frontend/Pitch) | Privy thật, Core wallet, test mobile | `/credential/verify`, bảng doanh thu treasury | Slide, video, kịch bản Demo Day |

## Câu hỏi giám khảo cần chuẩn bị sẵn
1. *"Sao không làm trên Ethereum/Base?"* → trả lời bằng 4 ý ở mục "Vì sao Avalanche", kèm số liệu thật.
2. *"Dữ liệu badge công khai, sao phải trả x402?"* → thứ được bán là chứng nhận do oracle ký (đã xác minh tài khoản Moodle thật), có sự đồng ý của sinh viên.
3. *"Lãi testnet là giả?"* → đúng, và đã nói rõ. Trên mainnet dùng adapter Aave v3; còn nguồn thưởng chính là sponsor cộng doanh thu x402.
4. *"Oracle gian lận thì sao?"* → oracle không chạm được vào tiền gốc, thưởng bị giới hạn, có cửa sổ khiếu nại, bằng chứng công khai ở `/verify`; lộ trình zkTLS.
