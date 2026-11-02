# StudyStake — Web spec (Phase 3)

Nguồn chuẩn cho `web/`. Khi mâu thuẫn với SPEC.md §6 thì file này thắng.

## Stack
- Next.js 15 App Router, TypeScript strict, Tailwind v4. Không cần backend riêng: web gọi thẳng contract (viem/wagmi) và oracle Worker (REST).
- `@privy-io/react-auth` (login Google/email, có embedded wallet) + `@privy-io/wagmi` + `wagmi` v2 + `viem` + `@tanstack/react-query`. Người dùng vẫn dùng được ví ngoài (Core, MetaMask).
- Chain: Fuji (43113) và Anvil (31337), chọn qua env `NEXT_PUBLIC_CHAIN_ID`. Địa chỉ contract đọc từ `contracts/deployments/<chain_id>.json`: script `scripts/sync_deployments.mjs` copy file này sang `web/src/generated/deployments.json` và sinh ABI vào `web/src/generated/abi.ts`.
- Env: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_ORACLE_URL`, `NEXT_PUBLIC_EXPLORER_URL` (mặc định `https://testnet.snowtrace.io`). Nếu không có Privy App ID thì **tự chuyển sang chế độ chỉ dùng ví ngoài** (wagmi injected), để chạy local và test E2E không cần Privy.
- Đặt tên: hàm, biến, field tự định nghĩa dùng `snake_case`. Component dùng PascalCase; hook giữ dạng `useXxx` theo quy ước React.

## Thiết kế
- Dark mode mặc định, **nền đen tuyền `#000`** (không dùng xám đậm), card `#0a0a0a`, viền `#1f1f1f`. Màu nhấn đỏ Avalanche `#E84142`, màu xanh lá `#22c55e` cho trạng thái "hoàn thành". Có light mode qua toggle.
- Font Be Vietnam Pro (Google Fonts) cho chữ tiếng Việt, số dùng `tabular-nums`.
- Song ngữ vi/en (mặc định vi), dùng một file dictionary đơn giản, không cần thư viện i18n nặng.
- Mobile-first, không có thanh cuộn ngang ở 375px, vùng chạm tối thiểu 44px.
- Logo Google/Core/MetaMask dùng **SVG logo chính thức**, không dùng icon thay thế.

## Trang
1. `/`: landing. Hero ("Cam kết học, không mất gốc"), 3 bước hoạt động, số liệu on-chain thật (tổng USDC đang cọc, số challenge, số người hoàn thành) đọc từ contract/events, nút "Bắt đầu".
2. `/challenges`: danh sách challenge (đọc `challenge_count` + `get_challenge` + metadata từ oracle). Có lọc theo phase, mỗi card hiện tên, môn, tổng cọc, số người, đếm ngược, phase badge.
3. `/challenges/[id]`:
   - Thông tin: hoạt động và hạn, khoảng cọc, tổng cọc, quỹ thưởng (bonus + lãi ước tính từ `vault.convertToAssets`), địa chỉ vault/token có link explorer.
   - **Join:** nhập số tiền (min/max), hiện số dư USDC. Nếu token hỗ trợ permit thì ký permit rồi gửi `join_with_permit` (1 giao dịch), không thì `approve` + `join`. Có nút xin tUSDC (`faucet()`) khi dùng tUSDC.
   - **Tiến độ:** `GET /progress/:id/:wallet`, mỗi hoạt động có trạng thái ✓/✗ và thời gian nộp. Challenge demo có nút "Làm bài demo" (ký message rồi gọi `POST /demo/submit`).
   - **Sau kết thúc:** phase badge, link bằng chứng (`/verify/[id]`). Trong dispute window có nút khiếu nại (nhập lý do, gửi `keccak` lên `dispute`).
   - **Claim:** `preview_claim` hiển thị gốc và thưởng. Lấy proof từ `GET /proof/:id/:account`, gửi `claim(id, completed, proof)` với `gas` ước lượng cộng biên (lưu ý `InsufficientGas`). Nút finalize/expire hiện khi phase là `Finalizable`/`Expirable` (ai cũng bấm được).
4. `/me`: các khoản cọc (quét event `Joined` của ví), trạng thái từng khoản, claim nhanh, badge (đọc `tokenURI`, render SVG on-chain), streak, liên kết LMS hiện tại.
5. `/link`: liên kết Moodle (hướng dẫn lấy token, màn hình **đồng ý** giải thích rủi ro token và cách thu hồi), ký message `link_message` y hệt oracle. Có tùy chọn Demo LMS. Có nút hủy liên kết.
6. `/verify/[id]`: tải evidence, tự tính lại `keccak(canonical_json)` ngay trong browser và so với `evidence_hash` on-chain, tự dựng lại root từ `tree` và so với `root` on-chain, hiện bảng participant (ví rút gọn, completed, reason). Ai cũng tự kiểm được mà không cần tin oracle.
7. `/admin` (chỉ hiện khi ví có `CREATOR_ROLE`/`GUARDIAN_ROLE`): form tạo challenge (metadata → `POST /metadata` có ký → `create_challenge`), sponsor, pause/unpause, resolve dispute.

## UX giao dịch (bắt buộc)
- Một hook `use_tx` chung, đi qua các trạng thái: `idle → signing → pending (hash + link explorer) → confirmed | error`. Dùng `simulateContract` trước khi gửi để bắt lỗi sớm.
- Map custom error của contract (decode bằng ABI) sang câu tiếng Việt dễ hiểu, ví dụ `TooLate` → "Đã quá hạn tham gia".
- Kiểm tra trước: sai mạng thì có nút chuyển mạng; thiếu AVAX gas thì có nút xin gas (oracle `/faucet` với Privy JWT, hoặc link faucet); thiếu USDC thì có link faucet.
- Sau khi giao dịch confirmed, invalidate các query liên quan.
- Mọi chuỗi từ metadata/evidence hiển thị dạng text thuần (không dùng `dangerouslySetInnerHTML`). Riêng SVG của badge render qua `<img src="data:...">`.

## Kiểm thử (Definition of Done)
- `npx tsc --noEmit`, `npm run lint`, `npm run build` đều qua.
- Unit test bằng vitest: map lỗi, `canonical_json` (phải cho kết quả giống hệt bản của oracle, test bằng cùng fixture), verify evidence, format số USDC.
- **E2E bằng Playwright trên Anvil** (`npm run e2e`): khởi động anvil, deploy, chạy oracle bằng `wrangler dev --local` (hoặc gọi module oracle thông qua một server Node nhỏ), web `next start`. Dùng ví inject (EIP-1193 provider giả, ký bằng private key Anvil) để join, nộp demo, tua thời gian, cron settle (gọi endpoint test của oracle hoặc chạy job), finalize, claim. Kiểm tra số dư hiển thị và badge.
- Chụp screenshot từng trang ở 375px và 1280px, cả dark và light, lưu vào `web/screenshots/`.
