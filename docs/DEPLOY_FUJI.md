# Deploying StudyStake to Avalanche Fuji

Step-by-step guide for P0 (see `AVALANCHE_PLAN.md`). The deploy script has been dry-run on a Fuji fork with real Circle USDC (deploy succeeded, permit join succeeded at about 291k gas). The steps below are the part that needs the team's **real keys and accounts**.

> **Safety rule:** use **new, testnet-only** wallets. Do not paste private keys into chat, Discord or commits. Keys live only in `contracts/.env` (gitignored) and in `wrangler secret`.

## 0. Prerequisites (once)

- Foundry: `curl -L https://foundry.paradigm.xyz | bash` then `foundryup`. On Windows Git Bash, add `export PATH="$PATH:$HOME/.foundry/bin"` to `~/.bashrc`.
- Submodules: `git submodule update --init --recursive`
- Check: `cd contracts && forge test` (92 tests pass)

## 1. Create 4 testnet wallets

```bash
cast wallet new   # run 3 times: DEPLOYER, ORACLE, FAUCET
```
| Wallet | Role | Fuji AVAX needed |
|---|---|---|
| DEPLOYER | Admin, Creator, Guardian | about 1 AVAX (deploy, create challenges) |
| ORACLE | Only calls `settle` / `finalize` | about 0.5 AVAX |
| FAUCET | Sends gas to new users | as much as possible (see section 4) |
| TREASURY | Receives yield and unclaimed rewards | none, use the team's Core wallet address |

Get Fuji AVAX: <https://core.app/tools/testnet-faucet/> or the organizers' faucet <https://team1vn.xyz/faucet.html>.
Get Fuji USDC (to test joining): <https://faucet.circle.com>, choose **Avalanche Fuji**.

## 2. Deploy + verify contracts

```bash
cd contracts
cp .env.example .env
# Fill in .env: PRIVATE_KEY (deployer), ORACLE_ADDRESS, TREASURY_ADDRESS, USE_CIRCLE_USDC=true
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url fuji --broadcast --verify
```
- `--rpc-url fuji` and Snowtrace verification (through Routescan) are already configured in `foundry.toml`, no API key needed.
- Addresses are written to `contracts/deployments/43113.json`. **Commit this file.**
- Record the **block number at deploy time** (in `broadcast/Deploy.s.sol/43113/run-latest.json` or on Snowtrace), since the oracle and web need it.
- If verification fails midway, rerun it per contract:
  `forge verify-contract <address> src/StudyStakeManager.sol:StudyStakeManager --chain 43113 --verifier-url https://api.routescan.io/v2/network/testnet/evm/43113/etherscan --etherscan-api-key verifyContract --constructor-args $(cast abi-encode "constructor(address,address,address)" <deployer> <treasury> <badge>)`

## 3. Privy

1. Create an app at <https://dashboard.privy.io>, enable **Google**, **Email** and **Wallet** login.
2. Under *Allowed origins*: add the web domain (and `http://localhost:3000` for dev).
3. Record the **App ID** (used by both web and oracle).

## 4. Oracle (Cloudflare Worker)

```bash
cd oracle
npx wrangler login
npx wrangler kv namespace create STATE      # paste the id into wrangler.toml
npx wrangler r2 bucket create studystake-evidence
```
> R2 may ask you to add a payment method to the Cloudflare account, even within the free tier.

Edit `wrangler.toml`: `MANAGER_ADDRESS`, `DEPLOY_BLOCK`, `ALLOWED_ORIGINS` (web domain). The faucet sends 0.05 AVAX by default, at most 20 times per day (about 1 AVAX/day). If the FAUCET wallet has little AVAX, lower `FAUCET_AMOUNT_WEI` (for example `10000000000000000` = 0.01 AVAX, still enough for a few joins and claims).

```bash
npx wrangler secret put ORACLE_PRIVATE_KEY
npx wrangler secret put FAUCET_PRIVATE_KEY
npx wrangler secret put TOKEN_ENC_KEY       # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put PRIVY_APP_ID
npm run deploy
curl https://<worker>.workers.dev/health    # must show chain_id 43113 and the right manager
```

## 5. Web

```bash
cd web
NEXT_PUBLIC_CHAIN_ID=43113 node scripts/sync_deployments.mjs   # needs contracts/out (forge build)
```
Commit `web/src/generated/*`, because build environments (Vercel, Pages) do not have Foundry.

Environment variables at deploy time (Vercel: Root Directory = `web`):
```
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_ORACLE_URL=https://<worker>.workers.dev
NEXT_PUBLIC_PRIVY_APP_ID=<app id>
NEXT_PUBLIC_DEPLOY_BLOCK=<deploy block>
```

## 6. Run one full round on Fuji (mandatory before recording the video)

1. Open `/admin` with the DEPLOYER wallet, create a challenge with the **USDC (Circle)** token and short durations (10-minute join, 1-hour deadline).
2. Someone **outside the team**: log in with Google, check the automatic 0.05 AVAX gas, get USDC from Circle's faucet, link the Demo LMS, join, then do the demo work.
3. Sponsor a few USDC from `/admin` (the form approves by itself).
4. Wait for cron settle (every 5 minutes) → dispute window → finalize → claim. Open `/verify/<id>`.
5. Record the tx hashes of **join, sponsor, settle, finalize, claim** in the README ("Real txs on Fuji" table).

## P0 checklist
- [ ] `contracts/deployments/43113.json` committed, 4 contracts verified on Snowtrace
- [ ] Oracle `/health` returns chain 43113
- [ ] Web runs on a public domain, Google login works
- [ ] A new wallet automatically receives AVAX gas
- [ ] Join with Circle USDC in 1 transaction (permit)
- [ ] One full round up to claim, with tx hashes in the README
- [ ] Tried with the Core wallet (extension) and MetaMask (adds the Fuji network by itself)
