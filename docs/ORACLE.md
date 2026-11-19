# StudyStake — Oracle spec (Phase 2)

Source of truth for `oracle/`. When in conflict with SPEC.md §5, this file wins.

## Stack
- Cloudflare Worker, strict TypeScript, `wrangler` v4. Bindings: KV `STATE`, R2 `EVIDENCE`, cron `*/5 * * * *`.
- Minimal libraries: `viem`, `@openzeppelin/merkle-tree`, `jose` (verifies the Privy JWT), `zod` (validates input). Tests: `vitest` (unit, mocked `fetch`), plus an E2E script run on Anvil with Node.
- Secrets (`wrangler secret put`, never in files): `ORACLE_PRIVATE_KEY`, `FAUCET_PRIVATE_KEY`, `TOKEN_ENC_KEY` (32 bytes base64, for AES-GCM), `PRIVY_APP_ID`, `TURNSTILE_SECRET` (optional).
- Vars: `CHAIN_ID`, `RPC_URL`, `MANAGER_ADDRESS`, `DEPLOY_BLOCK`, `ALLOWED_ORIGINS`, `MOODLE_SITES` (allowlist, defaults to `https://courses.ctda.hcmus.edu.vn`), `FAUCET_AMOUNT_WEI` (0.001 AVAX on Fuji), `FAUCET_DAILY_CAP`.
- Naming: self-defined functions, variables and JSON fields use `snake_case`.

## Structure
```
oracle/src/
  index.ts            router (fetch) + scheduled (cron)
  config.ts           reads env, viem chain
  chain.ts            StudyStakeManager ABI (generated from contracts/out), read/write clients, Joined log scan
  metadata.ts         challenge metadata schema + hash
  lms/types.ts        LmsAdapter interface
  lms/moodle.ts       Moodle REST adapter
  lms/demo.ts         Demo LMS adapter (KV)
  evaluate.ts         decides completed for each participant (pure function, no I/O)
  merkle.ts           builds the tree, proofs, evidence JSON
  settle.ts           settle job (idempotent, with a lock)
  link.ts             wallet ↔ LMS link (verifies wallet signatures)
  faucet.ts
  crypto.ts           AES-GCM token encryption/decryption
  auth.ts             verifies the Privy JWT (JWKS)
  http.ts             CORS, JSON errors, KV rate limit
```

## Challenge metadata
```json
{
  "version": 1,
  "title": "CSC10002 – Quiz weeks 10–12",
  "lms": "moodle" | "demo",
  "site": "https://courses.ctda.hcmus.edu.vn",
  "course_id": 1234,
  "activities": [ { "kind": "quiz" | "assign", "instance_id": 567, "name": "Quiz 10", "due": 1763650800 } ],
  "min_grade": null
}
```
- `metadata_hash = keccak256(utf8(canonical_json))`. Canonical JSON means sorted keys and no whitespace. Write a dedicated `canonical_json` function and test it.
- `POST /metadata` (CREATOR only: checks the wallet signature of an address with `CREATOR_ROLE` on-chain) stores it in R2 at `metadata/<hash>.json`. `GET /metadata/:hash` returns that file. `metadata_uri` = this URL.
- The oracle **always** checks `keccak(canonical(doc)) == challenge.metadata_hash` on-chain before use. If wrong, it skips the challenge and logs it.

## Wallet ↔ LMS link (`POST /link`)
Body: `{ wallet, lms, site, moodle_token?, signature, issued_at }`.
1. The wallet signs a message (EIP-191): `StudyStake link\nwallet: <addr>\nlms: <lms>\nsite: <site>\nissued_at: <unix>`. `issued_at` must be within 10 minutes of now. Verified with `viem.verifyMessage`. A nonce stored in KV prevents replay.
2. Moodle: `site` must be in the allowlist. Calls `core_webservice_get_site_info` to get `userid`.
3. 1-1 binding: KV `subject:<keccak(site|userid)> → wallet` and `link:<wallet> → {lms, site, userid, subject_hash, token_enc}`. If the subject is already bound to another wallet, return `409`. A wallet can switch to another subject only when it has no Open challenges left.
4. The token is AES-GCM encrypted (random 12-byte IV), **never logged** and never returned to the client.
- `DELETE /link` (signed): users delete their own token.
- `GET /link/:wallet`: returns `{lms, site, linked: true}` for an active link, or `{linked: false}`. The browser reads this again after reload.

## Moodle access and progress

- `POST /session` exchanges a fresh, origin-bound wallet signature for a short-lived bearer token. The web app keeps the token in memory and requests a new signature when the session expires.
- `POST /join/preflight` checks that the signed-in wallet can read the required activities through its linked Moodle account. The web join form requires a successful check. On-chain settlement still evaluates each participant independently.
- `GET /progress/:id/:wallet` requires the matching wallet's bearer token for a real Moodle challenge. It distinguishes a submission Moodle has recorded from one that meets the time and grade rules for settlement. Demo LMS progress remains available for the demo flow.

## LmsAdapter
```ts
interface LmsAdapter {
  get_activity_status(link, activity): Promise<{ submitted: boolean; time_finished: number | null; grade: number | null; raw_status: string }>
}
```
**Moodle** (`/webservice/rest/server.php?wstoken=…&moodlewsrestformat=json&wsfunction=…`, sent as a POST form):
- quiz: `mod_quiz_get_user_attempts(quizid=instance_id, userid, status='finished', includepreviews=0)`. Takes the attempt with `state=='finished'` and the **earliest** `timefinish` in the valid range. `grade` comes from `sumgrades`, only when `min_grade` is not null.
- assign: `mod_assign_get_submission_status(assignid=instance_id, userid)`. Valid when `lastattempt.submission.status == 'submitted'`, the time is `timemodified`.
- Moodle returns `{exception, errorcode}` errors even with HTTP 200 → must throw a clear error. `invalidtoken` → state `link_broken` (that participant counts as not completed, reason recorded in evidence).
- 10-second timeout. 2 retries for network/5xx errors, **no** retries for 4xx or exceptions.

**Demo LMS** (for judges/video, labeled DEMO):
- `POST /demo/submit` body `{wallet, challenge_id, instance_id, signature, issued_at}` (signs the message `StudyStake demo submit ...`). Stores KV `demo:<wallet>:<instance_id> → time`.
- The adapter reads that KV. A demo link needs no token: subject = `keccak("demo"|wallet)`.
- `GET /demo/activities/:challenge_id` returns the activity list for the demo web page.

## Evaluate (pure function, must be unit tested thoroughly)
A participant is `completed` when **all** activities satisfy:
`submitted && time_finished != null && joined_at <= time_finished <= min(activity.due, end_time)` and (`min_grade == null || grade >= min_grade`).
Result per participant: `{account, stake, completed, reason: 'ok'|'not_linked'|'link_broken'|'missing'|'late'|'before_join'|'low_grade'|'lms_error', activities: [...]}`.
**LMS errors:** if a participant hits `lms_error` after the adapter's retries, defer settlement and try again on the next cron run. If Moodle stays unavailable until `settle_grace` ends, the round expires and participants can claim their share of the vault. A temporary service failure does not count as a missed submission.

## Merkle and evidence
- `StandardMerkleTree.of(values, ['uint256','address','uint256','address','uint256'])`, each value = `[chain_id, manager, id, account, stake]`, completers only. The leaf matches `_leaf` in the contract (double-hashed abi.encode). **A compatibility test is mandatory:** generate a proof in TS and verify it on-chain on Anvil.
- Nobody completed: root = `0x00…0`, count = 0, stake = 0.
- Evidence JSON (R2 `evidence/<chain_id>/<id>.json`): `{version, chain_id, manager, challenge_id, metadata_hash, generated_at, root, completed_count, completed_stake, entries:[{account, stake, completed, reason, subject_hash, activities:[{instance_id, submitted, time_finished}]}], tree: tree.dump()}`. Does **not** contain names, student IDs, tokens or raw userids.
- `evidence_hash = keccak256(utf8(canonical_json(evidence)))`.
- `GET /evidence/:id` returns the JSON as is. `GET /proof/:id/:account` returns `{completed, stake, proof}` (from the tree in the evidence).
- New Moodle evidence excludes per-student submission timestamps and Moodle subject hashes. Previously committed evidence is served as committed so its hash can still be verified.

## Settle job (cron, idempotent)
1. KV lock `lock:settle:<id>` with a 4-minute TTL. Skip if locked.
2. Walk `1..challenge_count`, read `get_challenge`. Only process challenges with `status == Open` and `end_time <= now < end_time + settle_grace`.
3. Get participants from `Joined(id, …)` logs, scanning from `DEPLOY_BLOCK` in 2,000-block chunks (the public Fuji RPC limits ranges). Cache the scanned block pointer in KV. Cross-check `stake_of` on-chain for each participant.
4. Evaluate, build the tree, upload the evidence, **then** send `settle`. Wait for the receipt. On success write `settled:<id>` to KV.
5. Simulate before sending (`simulateContract`). A `WrongStatus` revert means it is already settled → mark as done.
6. After Finalized/Expired: clear `token_enc` only after a matching Moodle round closes and the wallet has no unsettled challenges. A token linked after that round's closure remains available for the next round.
7. Cron also calls `finalize(id)` when due (and `collect_treasury` if there is a `treasury_due`). Anyone can call these; the oracle just helps.

## Faucet (`POST /faucet`)
Privy JWT header (verified with JWKS `https://auth.privy.io/api/v1/apps/<app_id>/jwks.json`, checks `iss=privy.io`, `aud=<app_id>`, `exp`). Body `{wallet}`. Once per Privy user, once per wallet, with a total daily limit. Wallets already holding ≥ 0.02 AVAX are refused. Checks Turnstile if a secret is set. Sends `FAUCET_AMOUNT_WEI` and returns the tx hash.

## General HTTP
- CORS only for `ALLOWED_ORIGINS`. Errors as `{error: {code, message}}`. Every body validated with zod, 16KB body limit.
- KV rate limit per IP for `/link`, `/demo/submit`, `/faucet`.
- `GET /health` returns `{ok, chain_id, manager, oracle_address, block}`.

## Definition of Done
- `vitest` passes: canonical_json, metadata hash, evaluate (every `reason`), Moodle adapter with fixtures (attempt finished/inprogress, assign submitted/new, exception, invalidtoken, timeout), crypto round-trip, link signature verification (valid/invalid/expired/replay), rate limit.
- `npm run e2e:anvil`: anvil, `forge script Deploy`, create a demo challenge with short durations, 3 wallets join, 2 wallets submit through the Demo LMS, run the settle job (call the module directly with `wrangler dev` or Node), the dispute window passes, finalize, all 3 wallets claim with proofs from `/proof`, check balances are as expected.
- `wrangler deploy --dry-run` succeeds.

## Post-review updates v0.2 (win over the sections above when in conflict)
- **Multiple quiz attempts:** the adapter returns all `finished_times`/`finished_grades`. Evaluate picks the earliest attempt within `[joined_at, min(due, end_time)]` that meets `min_grade` if set. If no attempt qualifies, the reason priority is: `low_grade` (an attempt in the window but with a low grade), `late`, `before_join`.
- **All participants present:** before settling, the number of participants with `stake_of > 0` in KV must equal `participant_count` on-chain. If they differ, reset the scan pointer to `DEPLOY_BLOCK` and postpone settling.
- **Evidence by hash:** stored at `evidence/<chain_id>/<id>/<evidence_hash>.json`, never overwritten. `GET /evidence/:id` and `GET /proof/:id/:account` read `evidence_hash` on-chain and recheck `keccak(canonical)` before returning. `PUT /evidence/:id` (anyone, 1 MB max) only accepts files matching the on-chain hash, chain_id, manager, challenge_id and root, used by the guardian after `resolve_dispute`.
- **Abuse protection:** `/progress` limited to 20 requests/minute/IP with a 60-second cache. The Demo LMS key is `demo:<wallet>:<challenge_id>:<instance_id>`. `/demo/submit` only accepts challenges with metadata `lms=demo` and a matching activity id.
- **Faucet:** reserves a slot (`pending`, 300-second TTL) before sending, releases it if sending fails. KV is not atomic so this remains best-effort, but it is further bounded by the daily limit.
