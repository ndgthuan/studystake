# StudyStake — Threat model v0.1

Mục tiêu: liệt kê **mọi cách** có thể phá hoặc gian lận hệ thống, kèm cách chặn. Phần nào chưa chặn được thì ghi thẳng ra, vì giám khảo hỏi thì đội phải trả lời được.

**Bảo đảm cốt lõi:** *Dù oracle, creator, guardian hay admin bị hack, gốc của người dùng vẫn rút được*, trừ trường hợp chính vault sinh lãi bị lỗ.

## A. Tấn công vào tiền (smart contract)

| # | Mối đe dọa | Cách chặn | Còn lại |
|---|---|---|---|
| A1 | Reentrancy khi claim/finalize | `nonReentrant` + CEI; đánh dấu đã claim trước khi chuyển tiền | — |
| A2 | Claim 2 lần | `claimed[id][account]` | — |
| A3 | Proof giả / dùng lại proof của challenge, chain hay contract khác | Leaf băm 2 lần, chứa `chain_id, manager, id, account, stake`; stake trong leaf phải khớp stake on-chain | — |
| A4 | Oracle khai sai `completed_stake` để chia thưởng lệch | Thưởng bị cap bởi `R − paid`, nên không lấn vào gốc; có cửa sổ khiếu nại + bằng chứng công khai | Người claim sau có thể nhận ít thưởng hơn nếu oracle sai và không ai khiếu nại |
| A5 | Inflation/donation attack vào vault ERC-4626 | OpenZeppelin `_decimalsOffset`; Manager tự giữ share của từng challenge, không dùng `balanceOf` để tính | — |
| A6 | Token độc (fee-on-transfer, rebasing, có hook) | Allowlist token/vault do admin quản lý | — |
| A7 | Admin rút tiền | Không có hàm nào rút gốc. `sweep_rewards` chỉ lấy phần thưởng chưa nhận sau 180 ngày | Admin có thể allowlist một vault độc cho challenge **mới** → UI hiển thị địa chỉ vault, chỉ creator tin cậy được tạo challenge |
| A8 | Pause để giam tiền | Pause chỉ chặn `join`/`settle`; `claim`/`expire` luôn chạy được | — |
| A9 | Oracle không bao giờ settle (chết hoặc bị kiểm duyệt) | Quá `end_time + settle_grace` thì ai cũng gọi `expire` được → mọi người nhận gốc + lãi | — |
| A10 | Front-run `settle`/`finalize` | Chỉ ORACLE gọi được `settle`; `finalize` ai gọi cũng cho cùng kết quả | — |
| A11 | Làm tròn số tạo bụi hoặc làm hỏng bất biến | Làm tròn xuống có lợi cho contract; bụi về treasury khi sweep; fuzz kiểm bất biến | — |
| A12 | DoS do vòng lặp không giới hạn | Không lặp qua danh sách participant on-chain; claim là kéo (pull) từng người | — |
| A13 | Vault lỗ hoặc bị hack | Chia lỗ đều theo tỉ lệ cọc; ghi rõ trong UI/README | **Rủi ro thật**, no-loss phụ thuộc nguồn lãi |
| A14 | Sponsor nạp sau khi đã biết kết quả | `sponsor` chỉ được trước `end_time` | — |
| A16 | Người không hoàn thành bóp gas để lần cập nhật badge (reset streak) thất bại âm thầm, giữ streak giả | Gọi badge với gas cố định + kiểm `gasleft()` trước, thiếu gas thì revert cả claim (R1) | — |
| A17 | Treasury bị blacklist USDC làm `finalize` revert, gốc kẹt | `finalize` không đẩy tiền; lãi treasury rút riêng qua `collect_treasury` (R2) | — |
| A18 | Khiếu nại vô cớ, guardian vắng mặt, `expire` chia lãi cho cả người không hoàn thành | Hết timeout khiếu nại thì `finalize` với settlement cũ, không expire (R3) | Oracle sai mà guardian vắng thì thưởng theo oracle; gốc vẫn an toàn |
| A15 | Join sát hạn khi đã biết mình sẽ hoàn thành | `join_deadline` nằm trước giai đoạn làm bài; thưởng chia theo cọc nên vào muộn không có lợi thêm | Người đã nộp bài trước khi join → chỉ tính bài nộp **sau** khi join (`timefinish ≥ joined_at`) |

## B. Gian lận việc học (oracle / Moodle)

| # | Mối đe dọa | Cách chặn | Còn lại |
|---|---|---|---|
| B1 | Dùng Moodle của bạn chăm học để "hoàn thành" thay | Ràng buộc `(site,userid) ↔ ví` 1-1, chỉ hiển thị liên kết đầu tiên | **Không chặn được** nếu 2 người thông đồng đưa token cho nhau, nhưng làm vậy chỉ được lãi nhỏ, không có lợi về kinh tế |
| B2 | Nộp bài rỗng cho đủ | Có thể đặt `min_grade` cho từng challenge | Moodle không đo được chất lượng học |
| B3 | Một người tạo nhiều ví (sybil) | Thưởng chia theo cọc, nên chia nhỏ ra không có lợi; 1 Moodle chỉ gắn 1 ví | — |
| B4 | Oracle bị hack hoặc khai sai | Bằng chứng công khai (R2 + hash on-chain), trang `/verify` tự kiểm, có khiếu nại + guardian. Oracle không động được vào gốc | Thưởng phụ thuộc oracle trung thực. Lộ trình: zkTLS / plugin Moodle do trường chạy |
| B5 | Lộ Moodle token (token có toàn quyền tài khoản) | Mã hóa AES-GCM khi lưu, khóa nằm trong secret của Worker; chỉ gọi các API đọc; xóa sau khi settle; người dùng có thể thu hồi token trên Moodle | **Rủi ro lớn nhất về quyền riêng tư** → ghi rõ ở màn hình đồng ý; lộ trình zkTLS |
| B6 | Thay đổi giờ hoặc deadline trên Moodle | Dùng `min(duedate, end_time)` chốt sẵn trong metadata (hash on-chain) | Giáo viên gia hạn thì sinh viên không được hưởng |
| B7 | Moodle sập lúc settle | Cron thử lại; `settle_grace` 3 ngày; cuối cùng vẫn có `expire` | — |

## C. Web, tài khoản và vận hành

| # | Mối đe dọa | Cách chặn |
|---|---|---|
| C1 | Rút cạn faucet gas | Giới hạn theo Privy user + địa chỉ + IP, có Turnstile, hạn mức mỗi ngày, ví nóng chỉ giữ ít AVAX |
| C2 | Giả JWT khi gọi oracle | Kiểm JWT của Privy bằng JWKS, kiểm `aud`/`iss`/`exp` |
| C3 | Lộ khóa oracle | Lưu trong secret của Worker, ví riêng chỉ có role ORACLE; admin thu hồi role được ngay |
| C4 | Phishing hoặc giao dịch lạ | UI decode và hiển thị số tiền, contract; chỉ dùng địa chỉ cứng đã verify |
| C5 | XSS, injection vào metadata | Metadata hiển thị dạng text, CSP chặt, không render HTML từ người dùng |
| C6 | Bằng chứng làm lộ danh tính | JSON chỉ chứa ví + hash(site,userid) + trạng thái, không có tên hay MSSV |
| C7 | Khóa admin là EOA | Demo dùng EOA; lộ trình là multisig (Safe trên C-Chain) + timelock |
