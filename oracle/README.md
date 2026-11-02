# StudyStake oracle

Cloudflare Worker that links wallets to LMS accounts, checks course activity (Moodle or the Demo LMS),
builds the Merkle tree of completers, uploads public evidence to R2, and settles challenges on
StudyStakeManager. Spec: `docs/ORACLE.md`.

## Setup

```bash
cd oracle
npm install
```

Generate the contract ABI after building contracts (the ABI script does not build by itself, so it never writes into `contracts/`):

```bash
cd ../contracts && forge build && cd ../oracle
npm run abi        # writes src/abi/manager.ts
```

## Secrets

Set with `wrangler secret put <NAME>` in production. Never put them in `wrangler.toml` or commit them.

| Name | Purpose |
|---|---|
| `ORACLE_PRIVATE_KEY` | Oracle wallet (holds ORACLE_ROLE). Signs settle, finalize, expire, collect_treasury |
| `FAUCET_PRIVATE_KEY` | Faucet wallet. Keep it holding little AVAX |
| `TOKEN_ENC_KEY` | 32 random bytes, base64. AES-GCM key for stored Moodle tokens |
| `PRIVY_APP_ID` | Privy app id for JWT verification |
| `TURNSTILE_SECRET` | Optional. Turnstile check on `/faucet` |

Generate `TOKEN_ENC_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Config (vars in `wrangler.toml`)

`CHAIN_ID`, `RPC_URL`, `MANAGER_ADDRESS`, `DEPLOY_BLOCK`, `ALLOWED_ORIGINS`, `MOODLE_SITES`,
`FAUCET_AMOUNT_WEI`, `FAUCET_DAILY_CAP`. Fuji defaults are set. `MANAGER_ADDRESS` and the KV namespace
id are placeholders (`REPLACE_*`). Replace them after deploying the contracts and creating the KV namespace.
Create the R2 bucket `studystake-evidence` first.

## Local development

```bash
cp .dev.vars.example .dev.vars   # then fill in real values (local only)
npm run dev                      # wrangler dev
```

`.dev.vars` is git-ignored. `.dev.vars.example` contains placeholders only.

## Tests

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest unit tests (Moodle fixtures, evaluate, merkle, crypto, link, rate limit)
npm run e2e:anvil   # starts anvil, runs forge script Deploy, full challenge lifecycle, exact balance checks
```

`e2e:anvil` needs `anvil` and `forge` in `~/.foundry/bin` or on PATH. It uses anvil's public default keys
only, on a local chain.

## Deploy

```bash
npx wrangler secret put ORACLE_PRIVATE_KEY   # repeat for each secret above
npm run dry-run                              # wrangler deploy --dry-run --outdir dist
npm run deploy                               # only after placeholders are replaced
```

## Endpoints

`GET /health`, `POST /metadata`, `GET /metadata/:hash`, `POST /link`, `DELETE /link`, `GET /link/:wallet`,
`POST /demo/submit`, `GET /demo/activities/:id`, `GET /progress/:id/:wallet`, `GET /evidence/:id`,
`PUT /evidence/:id`, `GET /proof/:id/:account`, `POST /faucet`. Cron `*/5 * * * *` runs the settle job.

Evidence is stored content-addressed at `evidence/<chain_id>/<id>/<evidence_hash>.json` and is never overwritten.
`GET /evidence/:id` and `GET /proof/:id/:account` read the challenge's on-chain `evidence_hash` (status Settled,
Disputed or Finalized), load that object, and verify its hash before serving it (500 on mismatch).

## Guardian: evidence after resolve_dispute

When a challenge is disputed, the on-chain `evidence_hash` is the one the settle job committed to. If the
settle transaction was replaced or reverted, the stored object may not match it. The guardian re-creates the
exact evidence document, checks its hash, and uploads it:

```bash
# 1. Get the committed hash from the chain (Manager.get_challenge(id).evidence_hash).
# 2. Build the document from the same inputs the settle job used (metadata, joins, LMS results).
#    Use build_evidence() from src/settle.ts with the evaluated results. No standalone script exists yet,
#    because evaluation needs live KV and LMS state. Run it inside the Worker, or from a script that
#    reads the same KV and LMS data.
# 3. Check keccak256(canonical_json(doc)) == evidence_hash. Mismatch means the inputs differ: stop.
# 4. Upload. The worker accepts it only if the hash, chain_id, manager, challenge_id and root all match.
curl -X PUT "$ORACLE_URL/evidence/$CHALLENGE_ID" \
  -H 'content-type: application/json' \
  --data-binary @evidence_$CHALLENGE_ID.json
```

The upload route is permissionless. Its authority comes from the hash check, not from who sends it. The body
limit for this route is 1 MB. Every other route keeps 16 KB.
