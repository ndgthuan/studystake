# Deploy StudyStake lên Avalanche Fuji

Hướng dẫn từng bước cho P0 (xem `AVALANCHE_PLAN.md`). Script deploy đã được chạy thử trên một bản fork của Fuji với Circle USDC thật (deploy thành công, join bằng permit thành công khoảng 291k gas). Các bước dưới đây là phần cần **khóa thật và tài khoản thật** của đội.

> **Quy tắc an toàn:** dùng ví **mới, chỉ dành cho testnet**. Không dán private key vào chat, Discord hay commit. Khóa chỉ nằm trong `contracts/.env` (đã gitignore) và trong `wrangler secret`.

## 0. Chuẩn bị (một lần)

- Foundry: `curl -L https://foundry.paradigm.xyz | bash` rồi `foundryup`. Trên Windows Git Bash, thêm `export PATH="$PATH:$HOME/.foundry/bin"` vào `~/.bashrc`.
- Submodule: `git submodule update --init --recursive`
- Kiểm tra: `cd contracts && forge test` (92 test pass)

## 1. Tạo 4 ví testnet

```bash
cast wallet new   # chạy 3 lần: DEPLOYER, ORACLE, FAUCET
```
| Ví | Vai trò | Cần AVAX Fuji |
|---|---|---|
| DEPLOYER | Admin, Creator, Guardian | khoảng 1 AVAX (deploy, tạo challenge) |
| ORACLE | Chỉ gọi `settle` / `finalize` | khoảng 0.5 AVAX |
| FAUCET | Gửi gas cho người dùng mới | càng nhiều càng tốt (xem mục 4) |
| TREASURY | Nhận lãi, thưởng không ai nhận | không cần, dùng địa chỉ ví Core của đội |

Xin AVAX Fuji: <https://core.app/tools/testnet-faucet/> hoặc faucet của BTC <https://team1vn.xyz/faucet.html>.
Xin USDC Fuji (để test join): <https://faucet.circle.com>, chọn **Avalanche Fuji**.

## 2. Deploy + verify contract

```bash
cd contracts
cp .env.example .env
# Điền vào .env: PRIVATE_KEY (deployer), ORACLE_ADDRESS, TREASURY_ADDRESS, USE_CIRCLE_USDC=true
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url fuji --broadcast --verify
```
- `--rpc-url fuji` và việc verify trên Snowtrace (qua Routescan) đã được cấu hình sẵn trong `foundry.toml`, không cần API key.
- Địa chỉ được ghi vào `contracts/deployments/43113.json`. **Hãy commit file này.**
- Ghi lại **số block lúc deploy** (xem trong `broadcast/Deploy.s.sol/43113/run-latest.json` hoặc trên Snowtrace), vì oracle và web sẽ cần đến.
- Nếu bước verify lỗi giữa chừng, chạy lại cho từng contract:
  `forge verify-contract <địa_chỉ> src/StudyStakeManager.sol:StudyStakeManager --chain 43113 --verifier-url https://api.routescan.io/v2/network/testnet/evm/43113/etherscan --etherscan-api-key verifyContract --constructor-args $(cast abi-encode "constructor(address,address,address)" <deployer> <treasury> <badge>)`

## 3. Privy

1. Tạo app ở <https://dashboard.privy.io>, bật login **Google**, **Email** và **Wallet**.
2. Mục *Allowed origins*: thêm domain của web (và `http://localhost:3000` để dev).
3. Ghi lại **App ID** (dùng cho cả web lẫn oracle).

## 4. Oracle (Cloudflare Worker)

```bash
cd oracle
npx wrangler login
npx wrangler kv namespace create STATE      # dán id vào wrangler.toml
npx wrangler r2 bucket create studystake-evidence
```
> R2 có thể yêu cầu thêm phương thức thanh toán vào tài khoản Cloudflare, dù vẫn trong hạn mức miễn phí.

Sửa `wrangler.toml`: `MANAGER_ADDRESS`, `DEPLOY_BLOCK`, `ALLOWED_ORIGINS` (domain web). Faucet mặc định gửi 0.05 AVAX, tối đa 20 lần mỗi ngày (khoảng 1 AVAX/ngày). Nếu ví FAUCET ít AVAX thì giảm `FAUCET_AMOUNT_WEI` (ví dụ `10000000000000000` = 0.01 AVAX, vẫn đủ cho vài lần join và claim).

```bash
npx wrangler secret put ORACLE_PRIVATE_KEY
npx wrangler secret put FAUCET_PRIVATE_KEY
npx wrangler secret put TOKEN_ENC_KEY       # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put PRIVY_APP_ID
npm run deploy
curl https://<worker>.workers.dev/health    # phải thấy chain_id 43113 và đúng manager
```

## 5. Web

```bash
cd web
NEXT_PUBLIC_CHAIN_ID=43113 node scripts/sync_deployments.mjs   # cần contracts/out (forge build)
```
Commit `web/src/generated/*`, vì môi trường build (Vercel, Pages) không có Foundry.

Biến môi trường khi deploy (Vercel: Root Directory = `web`):
```
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_ORACLE_URL=https://<worker>.workers.dev
NEXT_PUBLIC_PRIVY_APP_ID=<app id>
NEXT_PUBLIC_DEPLOY_BLOCK=<block deploy>
```

## 6. Chạy thử một vòng đầy đủ trên Fuji (bắt buộc trước khi quay video)

1. Mở `/admin` bằng ví DEPLOYER, tạo challenge với token **USDC (Circle)**, thời gian ngắn (join 10 phút, hạn 1 giờ).
2. Một người **ngoài đội**: đăng nhập Google, kiểm tra tự nhận 0.05 AVAX gas, xin USDC ở faucet Circle, liên kết Demo LMS, join, rồi làm bài demo.
3. Sponsor vài USDC từ `/admin` (form tự approve).
4. Chờ cron settle (5 phút một lần) → cửa sổ khiếu nại → finalize → claim. Mở `/verify/<id>`.
5. Ghi tx hash của **join, sponsor, settle, finalize, claim** vào README (bảng "Tx thật trên Fuji").

## Checklist P0
- [ ] `contracts/deployments/43113.json` đã commit, 4 contract đã verify trên Snowtrace
- [ ] Oracle `/health` trả về chain 43113
- [ ] Web chạy trên domain public, đăng nhập Google được
- [ ] Ví mới tự nhận AVAX gas
- [ ] Join bằng Circle USDC trong 1 giao dịch (permit)
- [ ] Một vòng đầy đủ đến claim, có tx hash trong README
- [ ] Đã thử bằng ví Core (extension) và MetaMask (tự thêm mạng Fuji)
