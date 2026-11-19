# Deploying StudyStake to Avalanche Fuji

Step-by-step guide for P0 (see `AVALANCHE_PLAN.md`). The deploy script has been dry-run on a Fuji fork with real Circle USDC (deploy succeeded, permit join succeeded at about 291k gas). The steps below are the part that needs the team's **real keys and accounts**.

For an update to the existing Fuji deployment, use the committed addresses and reuse the current Worker, KV namespace and R2 bucket. Redeploy the Worker and web from the release commit.

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

Set `MANAGER_ADDRESS`, `DEPLOY_BLOCK` and `ALLOWED_ORIGINS` in `wrangler.toml` for the target deployment. The committed Fuji configuration sends 0.001 AVAX per eligible new wallet, with a daily cap of 20. Budget 0.02 Fuji AVAX per day plus transaction fees for full capacity.

```bash
npx wrangler secret put ORACLE_PRIVATE_KEY
npx wrangler secret put FAUCET_PRIVATE_KEY
npx wrangler secret put TOKEN_ENC_KEY       # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put PRIVY_APP_ID
npm run deploy
curl https://<worker>.workers.dev/health
```

Confirm `chain_id` is `43113`, `manager` matches `contracts/deployments/43113.json`, and `faucet` reports `enabled: true`, `amount_wei: "1000000000000000"` and `daily_cap: 20`. The web displays the amount returned by the Worker once the transaction succeeds, with its Snowtrace link.

### Team-hosted x402 facilitator

Run a Node service rooted at `oracle/` behind the team's HTTPS endpoint. Use the same Node version as the repo's E2E environment. The build command is `npm ci --include=dev` and the start command is `npm run x402:facilitator`. The x402 SDK is installed for the facilitator and E2E client. The Worker stays independent of it.

Configure these environment variables on the host.

| Variable | Value |
|---|---|
| `FACILITATOR_HOST` | `0.0.0.0` behind the host's HTTPS ingress |
| `PORT` | Assigned by the host, or `4022` behind a reverse proxy |
| `FACILITATOR_RPC_URL` | Fuji C-Chain RPC |
| `FACILITATOR_PRIVATE_KEY` | Dedicated testnet-only key with Fuji AVAX for gas |
| `FACILITATOR_TREASURY` | Current manager treasury address from the Worker's `/x402/stats` |
| `FACILITATOR_AUTH_TOKEN` | Random bearer secret shared with the Worker |

Confirm `GET /health` reports chain `43113` and positive `balance_wei`. `GET /supported` should advertise `exact`, x402 version `2` and `eip155:43113`. An unauthenticated `POST /verify` or `POST /settle` should return `401`.

Set `X402_FACILITATOR_URL` to the team's HTTPS endpoint in `wrangler.toml`. Create a temporary JSON secret file outside the repo with `X402_FACILITATOR_TOKEN` set to the same shared secret. From `oracle/`, deploy with `npm run deploy -- --secrets-file <path-to-secret-file>` so the URL and token take effect together. Existing Worker secrets are preserved. The committed URL keeps the existing public facilitator until the team endpoint is ready. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## 5. Web

```bash
cd web
NEXT_PUBLIC_CHAIN_ID=43113 node scripts/sync_deployments.mjs   # needs contracts/out (forge build)
```
Commit `web/src/generated/*`, because build environments (Vercel, Pages) do not have Foundry.

Environment variables at deploy time (Vercel: Root Directory = `web`):
```
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_URL=https://avalanche-fuji-c-chain-rpc.publicnode.com
NEXT_PUBLIC_ORACLE_URL=https://<worker>.workers.dev
NEXT_PUBLIC_PRIVY_APP_ID=<app id>
NEXT_PUBLIC_DEPLOY_BLOCK=<deploy block>
```

## 6. Run one full round on Fuji (mandatory before recording the video)

1. Open `/admin` with the DEPLOYER wallet, create a challenge with the **USDC (Circle)** token and short durations (10-minute join, 1-hour deadline).
2. Ask someone **outside the team** to log in with Google using a fresh embedded wallet. Open the faucet receipt in Snowtrace and confirm a 0.001 AVAX transfer to that wallet. Get Circle USDC, link Demo LMS and join. Record the `join_with_permit` receipt and check the wallet history for a separate USDC approval before the join. Then complete the demo work.
3. Sponsor a few USDC from `/admin` (the form approves by itself).
4. Wait for cron settle (every 5 minutes) → dispute window → finalize → claim. Open `/verify/<id>`.
5. Record the tx hashes of **faucet, join, sponsor, settle, finalize and claim** in the README ("Real txs on Fuji" table). Tick the faucet and permit items after verifying the corresponding public Fuji receipts.

### Confirm one public x402 payment

Link a test student wallet to Demo LMS and enable credential sharing from `/link`. Use a distinct Fuji-only buyer key funded with at least 0.005 Circle USDC. Set `X402_BUYER_PRIVATE_KEY` locally and run from `oracle/`:

```powershell
npm run --silent x402:live-check -- $studentWallet
```

The command makes one purchase, checks the credential signer against the Manager's `ORACLE_ROLE`, and verifies the exact Circle USDC `Transfer` from the buyer to the on-chain treasury. It prints the Snowtrace link and the JSON credential. Paste the JSON into `/credential/verify`. If the outcome is uncertain, check the buyer's balance and receipts before running the command again.

### HCMUS pilot handoff

Use one StudyStake wallet throughout. For an embedded email wallet, copy the address from **My stakes → Avalanche Fuji wallet** and paste it into the [Team1 faucet](https://team1vn.xyz/faucet.html). An extension wallet can use the [Builder Console faucet](https://build.avax.network/console/primary-network/faucet). Fuji AVAX pays gas. A stake also needs the test USDC shown on the challenge.

1. Connect the Creator wallet at `/admin`. Select **Moodle** under **Activity source**, keep the HCMUS site, and enter the course ID and at least one quiz or assignment **instance ID**. The `id` in a Moodle activity URL can be a course module ID. Use the activity instance ID from Moodle's course module data. Set the challenge end time to match the deadline you want to test.
2. In the participant's own browser session, open `/link`, choose Moodle, and link the HCMUS account. Keep the Moodle token in the StudyStake form.
3. From the challenge, sign in to the private Moodle check. Confirm it can read the required activities before signing the stake transaction. Check the progress panel before and after submitting and compare it with Moodle. Record the challenge ID, transaction hash and status.
4. Use a course and activity approved for the pilot. Public evidence for new Moodle rounds shows the on-chain account and completion result. Submission timestamps are visible only in the participant's authenticated progress view. Previously committed evidence retains its original fields.
5. Release the web and Worker updates together. Moodle progress and the pre-stake check need the Worker session API. Verify the checks on the target preview before sharing the submission link.

## P0 checklist
- [ ] `contracts/deployments/43113.json` committed, 4 contracts verified on Snowtrace
- [ ] Oracle `/health` returns chain 43113
- [ ] Web runs on a public domain, Google login works
- [ ] A new wallet automatically receives AVAX gas
- [ ] Join with Circle USDC in 1 transaction (permit)
- [ ] One full round up to claim, with tx hashes in the README
- [ ] Tried with the Core wallet (extension) and MetaMask (adds the Fuji network by itself)
