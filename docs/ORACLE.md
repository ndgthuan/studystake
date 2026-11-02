# StudyStake — Oracle spec (Phase 2)

Nguồn chuẩn cho `oracle/`. Mâu thuẫn với SPEC.md §5 thì file này thắng.

## Stack
- Cloudflare Worker, TypeScript strict, `wrangler` v4. Bindings: KV `STATE`, R2 `EVIDENCE`, cron `*/5 * * * *`.
- Thư viện tối thiểu: `viem`, `@openzeppelin/merkle-tree`, `jose` (verify Privy JWT), `zod` (validate input). Test: `vitest` (unit, mock `fetch`), cộng script E2E chạy trên Anvil bằng Node.
- Secrets (`wrangler secret put`, không bao giờ nằm trong file): `ORACLE_PRIVATE_KEY`, `FAUCET_PRIVATE_KEY`, `TOKEN_ENC_KEY` (32 byte base64, dùng cho AES-GCM), `PRIVY_APP_ID`, `TURNSTILE_SECRET` (tùy chọn).
- Vars: `CHAIN_ID`, `RPC_URL`, `MANAGER_ADDRESS`, `DEPLOY_BLOCK`, `ALLOWED_ORIGINS`, `MOODLE_SITES` (allowlist, mặc định `https://courses.ctda.hcmus.edu.vn`), `FAUCET_AMOUNT_WEI` (0.05 AVAX), `FAUCET_DAILY_CAP`.
- Đặt tên: hàm, biến, field JSON tự định nghĩa dùng `snake_case`.

## Cấu trúc
```
oracle/src/
  index.ts            router (fetch) + scheduled (cron)
  config.ts           đọc env, chain viem
  chain.ts            ABI StudyStakeManager (sinh từ contracts/out), client đọc/ghi, quét log Joined
  metadata.ts         schema metadata challenge + hash
  lms/types.ts        interface LmsAdapter
  lms/moodle.ts       adapter Moodle REST
  lms/demo.ts         adapter Demo LMS (KV)
  evaluate.ts         quyết định completed cho từng participant (hàm thuần, không I/O)
  merkle.ts           build tree, proof, evidence JSON
  settle.ts           job settle (idempotent, có lock)
  link.ts             liên kết ví ↔ LMS (xác minh chữ ký ví)
  faucet.ts
  crypto.ts           AES-GCM mã hóa/giải mã token
  auth.ts             verify Privy JWT (JWKS)
  http.ts             CORS, lỗi JSON, rate limit KV
```

## Metadata challenge
```json
{
  "version": 1,
  "title": "CSC10002 – Quiz tuần 10–12",
  "lms": "moodle" | "demo",
  "site": "https://courses.ctda.hcmus.edu.vn",
  "course_id": 1234,
  "activities": [ { "kind": "quiz" | "assign", "instance_id": 567, "name": "Quiz 10", "due": 1763650800 } ],
  "min_grade": null
}
```
- `metadata_hash = keccak256(utf8(canonical_json))`. Canonical JSON nghĩa là key sắp theo thứ tự, không có khoảng trắng. Viết hàm `canonical_json` riêng và test nó.
- `POST /metadata` (chỉ CREATOR: kiểm chữ ký ví của một địa chỉ có `CREATOR_ROLE` on-chain) lưu vào R2 `metadata/<hash>.json`. `GET /metadata/:hash` trả lại file đó. `metadata_uri` = URL này.
- Oracle **luôn** kiểm `keccak(canonical(doc)) == challenge.metadata_hash` on-chain trước khi dùng. Sai thì bỏ qua challenge đó và ghi log.

## Liên kết ví ↔ LMS (`POST /link`)
Body: `{ wallet, lms, site, moodle_token?, signature, issued_at }`.
1. Ví ký message (EIP-191): `StudyStake link\nwallet: <addr>\nlms: <lms>\nsite: <site>\nissued_at: <unix>`. `issued_at` phải lệch không quá 10 phút so với hiện tại. Verify bằng `viem.verifyMessage`. Nonce lưu KV để chống replay.
2. Moodle: `site` phải nằm trong allowlist. Gọi `core_webservice_get_site_info` để lấy `userid`.
3. Ràng buộc 1-1: KV `subject:<keccak(site|userid)> → wallet` và `link:<wallet> → {lms, site, userid, subject_hash, token_enc}`. Nếu subject đã gắn với ví khác thì trả `409`. Ví đổi sang subject khác thì chỉ được làm khi ví đó không còn challenge nào đang Open.
4. Token mã hóa AES-GCM (IV ngẫu nhiên 12 byte), **không bao giờ log** và không trả lại cho client.
- `DELETE /link` (có chữ ký): người dùng tự xóa token.
- `GET /link/:wallet`: trả `{lms, site, linked: true}` và không có thêm gì khác.

## LmsAdapter
```ts
interface LmsAdapter {
  get_activity_status(link, activity): Promise<{ submitted: boolean; time_finished: number | null; grade: number | null; raw_status: string }>
}
```
**Moodle** (`/webservice/rest/server.php?wstoken=…&moodlewsrestformat=json&wsfunction=…`, gửi bằng POST form):
- quiz: `mod_quiz_get_user_attempts(quizid=instance_id, userid, status='finished', includepreviews=0)`. Lấy attempt `state=='finished'` có `timefinish` **sớm nhất** trong khoảng hợp lệ. `grade` lấy từ `sumgrades`, chỉ khi `min_grade` khác null.
- assign: `mod_assign_get_submission_status(assignid=instance_id, userid)`. Hợp lệ khi `lastattempt.submission.status == 'submitted'`, thời điểm là `timemodified`.
- Moodle trả lỗi `{exception, errorcode}` ngay cả khi HTTP 200 → phải ném lỗi rõ ràng. `invalidtoken` → trạng thái `link_broken` (participant đó tính là không hoàn thành, ghi lý do vào evidence).
- Timeout 10 giây. Retry 2 lần cho lỗi mạng/5xx, **không** retry lỗi 4xx hoặc exception.

**Demo LMS** (cho giám khảo/video, gắn nhãn DEMO):
- `POST /demo/submit` body `{wallet, challenge_id, instance_id, signature, issued_at}` (ký message `StudyStake demo submit ...`). Lưu KV `demo:<wallet>:<instance_id> → time`.
- Adapter đọc KV đó. Link demo không cần token: subject = `keccak("demo"|wallet)`.
- `GET /demo/activities/:challenge_id` trả danh sách hoạt động cho trang web demo.

## Evaluate (hàm thuần, phải unit test kỹ)
Participant `completed` khi **tất cả** hoạt động thỏa:
`submitted && time_finished != null && joined_at <= time_finished <= min(activity.due, end_time)` và (`min_grade == null || grade >= min_grade`).
Kết quả cho từng participant: `{account, stake, completed, reason: 'ok'|'not_linked'|'link_broken'|'missing'|'late'|'before_join'|'low_grade'|'lms_error', activities: [...]}`.
**Lỗi LMS:** nếu một participant gặp `lms_error` (mạng/5xx) sau khi đã retry thì **không settle** challenge trong lần cron này và thử lại lần sau. Còn dưới 2 giờ là hết `settle_grace` thì settle luôn, và các participant `lms_error` tính là không hoàn thành, có ghi lý do (họ vẫn có quyền khiếu nại).

## Merkle và evidence
- `StandardMerkleTree.of(values, ['uint256','address','uint256','address','uint256'])`, mỗi value = `[chain_id, manager, id, account, stake]`, chỉ gồm người completed. Leaf khớp `_leaf` trong contract (băm 2 lần abi.encode). **Bắt buộc có test tương thích:** sinh proof bằng TS rồi verify on-chain trên Anvil.
- Không ai completed: root = `0x00…0`, count = 0, stake = 0.
- Evidence JSON (R2 `evidence/<chain_id>/<id>.json`): `{version, chain_id, manager, challenge_id, metadata_hash, generated_at, root, completed_count, completed_stake, entries:[{account, stake, completed, reason, subject_hash, activities:[{instance_id, submitted, time_finished}]}], tree: tree.dump()}`. **Không** chứa tên, MSSV, token hay userid thô.
- `evidence_hash = keccak256(utf8(canonical_json(evidence)))`.
- `GET /evidence/:id` trả nguyên JSON. `GET /proof/:id/:account` trả `{completed, stake, proof}` (lấy từ tree trong evidence).

## Settle job (cron, idempotent)
1. Lock KV `lock:settle:<id>` với TTL 4 phút. Đang có lock thì bỏ qua.
2. Duyệt `1..challenge_count`, đọc `get_challenge`. Chỉ xử lý challenge có `status == Open` và `end_time <= now < end_time + settle_grace`.
3. Lấy participant từ log `Joined(id, …)`, quét từ `DEPLOY_BLOCK` theo từng đoạn 2.000 block (RPC Fuji public giới hạn range). Cache con trỏ block đã quét trong KV. Đối chiếu `stake_of` on-chain cho từng participant.
4. Evaluate, build tree, upload evidence, **rồi mới** gửi `settle`. Đợi receipt. Thành công thì ghi `settled:<id>` vào KV.
5. Trước khi gửi, simulate (`simulateContract`). Revert `WrongStatus` nghĩa là đã settle rồi → đánh dấu xong.
6. Sau khi Finalized/Expired: xóa `token_enc` của các ví không còn challenge Open nào (dọn dẹp ở cron).
7. Cron cũng tự gọi `finalize(id)` khi đã đến hạn (và `collect_treasury` nếu có `treasury_due`). Ai gọi cũng được, oracle chỉ gọi giúp.

## Faucet (`POST /faucet`)
Header Privy JWT (verify JWKS `https://auth.privy.io/api/v1/apps/<app_id>/jwks.json`, kiểm `iss=privy.io`, `aud=<app_id>`, `exp`). Body `{wallet}`. Mỗi Privy user một lần, mỗi ví một lần, giới hạn tổng theo ngày. Ví đã có ≥ 0.02 AVAX thì từ chối. Kiểm Turnstile nếu có secret. Gửi `FAUCET_AMOUNT_WEI` và trả tx hash.

## HTTP chung
- CORS chỉ cho `ALLOWED_ORIGINS`. Lỗi trả dạng `{error: {code, message}}`. Validate mọi body bằng zod, giới hạn kích thước body 16KB.
- Rate limit KV theo IP cho `/link`, `/demo/submit`, `/faucet`.
- `GET /health` trả `{ok, chain_id, manager, oracle_address, block}`.

## Definition of Done
- `vitest` qua: canonical_json, metadata hash, evaluate (mọi `reason`), adapter Moodle với fixture (attempt finished/inprogress, assign submitted/new, exception, invalidtoken, timeout), crypto round-trip, verify chữ ký link (đúng/sai/hết hạn/replay), rate limit.
- `npm run e2e:anvil`: anvil, `forge script Deploy`, tạo challenge demo với thời gian ngắn, 3 ví join, 2 ví nộp qua Demo LMS, chạy settle job (gọi thẳng module với `wrangler dev` hoặc Node), dispute window trôi qua, finalize, cả 3 ví claim bằng proof từ `/proof`, kiểm số dư đúng như mong đợi.
- `wrangler deploy --dry-run` thành công.

## Cập nhật sau review v0.2 (thắng các mục ở trên nếu mâu thuẫn)
- **Quiz nhiều lần làm:** adapter trả toàn bộ `finished_times`/`finished_grades`. Evaluate chọn lần làm sớm nhất nằm trong `[joined_at, min(due, end_time)]` và đạt `min_grade` nếu có. Không có lần nào đạt thì reason ưu tiên theo thứ tự: `low_grade` (có lần trong khung giờ nhưng điểm thấp), `late`, `before_join`.
- **Đủ người tham gia:** trước khi settle, số participant có `stake_of > 0` trong KV phải bằng `participant_count` on-chain. Lệch thì reset con trỏ quét về `DEPLOY_BLOCK` và hoãn settle.
- **Evidence theo hash:** lưu ở `evidence/<chain_id>/<id>/<evidence_hash>.json`, không bao giờ ghi đè. `GET /evidence/:id` và `GET /proof/:id/:account` đọc `evidence_hash` on-chain rồi kiểm lại `keccak(canonical)` trước khi trả. `PUT /evidence/:id` (ai cũng gọi được, tối đa 1 MB) chỉ nhận file khớp hash, chain_id, manager, challenge_id và root on-chain, dùng cho guardian sau `resolve_dispute`.
- **Chống lạm dụng:** `/progress` giới hạn 20 lần/phút/IP và cache 60 giây. Key Demo LMS là `demo:<wallet>:<challenge_id>:<instance_id>`. `/demo/submit` chỉ nhận challenge có metadata `lms=demo` và đúng mã hoạt động.
- **Faucet:** giữ chỗ (`pending`, TTL 300 giây) trước khi gửi, gửi lỗi thì nhả chỗ. KV không atomic nên vẫn là best-effort, nhưng bị chặn thêm bởi giới hạn ngày.
