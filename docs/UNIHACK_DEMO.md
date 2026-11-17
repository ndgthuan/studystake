# StudyStake tại UniHack

## Kịch bản video 2 phút 45 giây

| Thời lượng | Người quay | Cảnh và lời dẫn |
|---|---|---|
| 0:00–0:20 | Quân | Mở trang chủ. “Nhiều sinh viên bỏ lỡ hạn Moodle. StudyStake cho phép cam kết bằng USDC. Khi vault bảo toàn vốn, sinh viên được nhận lại tiền gốc. Phần thưởng thuộc về người hoàn thành đúng hạn.” |
| 0:20–0:50 | Thuận | Mở một challenge đang nhận người, liên kết Demo LMS, chọn số stake, ký permit bằng ví thử nghiệm. Quay Circle USDC trên web Fuji nếu đã có challenge, tiền test và ví phù hợp. Khi dùng fork, ghi nhãn “Fuji fork”. |
| 0:50–1:24 | Thuận | Dùng challenge #1 đã chốt để mở bằng chứng, chỉ ra hash và Merkle root đều khớp on-chain. Mở giao dịch claim trên Snowtrace, nhắc rõ đây là vòng tUSDC. Người hoàn thành nhận 129.999999 tUSDC và badge, người còn lại nhận 50 tUSDC gốc. |
| 1:24–2:02 | Thuận | Chạy agent mua 3 credential. Quay dòng JSON đã ký và dán một dòng vào trang verify đang trỏ cùng deployment. Nêu giá 0.005 USDC mỗi lượt. Gắn nhãn “Fuji fork” nếu dùng facilitator local, hoặc mở Snowtrace khi đã có receipt trên Fuji công khai. |
| 2:02–2:30 | Quân | Chiếu sơ đồ bảo mật và kết quả test. Nêu Merkle proof, quyền giới hạn của oracle và opt-in có chữ ký. Ghi rõ yield trên Fuji là mô phỏng, Aave được kiểm tra trên fork và StudyNet là roadmap. |
| 2:30–2:45 | Quân | Chốt lời mời pilot với một lớp Moodle. Chèn số ví pilot và nhận xét từ form sau khi nhóm đã đối chiếu dữ liệu. |

Thuận xuất các cảnh kỹ thuật thành từng đoạn, kèm danh sách hash công khai và nhãn môi trường. Quân ghép mở đầu, cảnh kỹ thuật, phụ đề và link bản cuối. Khi quay, dùng Demo LMS và ví test. Tránh hiển thị token Moodle hoặc khóa ví.

## Nội dung slide chung

| Slide | Thông điệp | Hình hoặc bằng chứng |
|---|---|---|
| 1. Vấn đề | Hạn quiz và assignment dễ bị bỏ lỡ. Một công cụ cam kết cần có tín hiệu đủ rõ để sinh viên nhớ hành động. | Một tình huống cụ thể trong Moodle. |
| 2. Giải pháp | Link LMS, stake USDC, hoàn thành đúng hạn, claim tiền gốc và phần thưởng theo kết quả. | Ảnh trang challenge và trang claim. |
| 3. Kiến trúc | Next.js đọc hợp đồng C-Chain và bằng chứng Worker. Worker đọc LMS, ghi R2 và settle Merkle root. Manager giữ vị thế ERC-4626 và StudyBadge ghi streak. | [Sơ đồ kiến trúc trong repo](../assets/architecture-light.svg). |
| 4. Vì sao Avalanche | Có receipt C-Chain và USDC gốc cho EIP-3009. Join đã ghi nhận 283.023 gas ở vòng tUSDC, phí tại thời điểm đó là 43.868.565 wei test AVAX. | [Giao dịch Fuji](https://testnet.snowtrace.io/tx/0xbec2d81e11e5b39de4653a4a4320483102d3e5173f0acaee009b1cc2157c3476). |
| 5. x402 và quyền riêng tư | Agent trả 0.005 USDC cho credential đã opt-in. Trình duyệt kiểm tra chữ ký bằng `ORACLE_ROLE`. Doanh thu có thể tài trợ challenge Circle USDC tiếp theo. | Cảnh fork và trang `/credential/verify`. |
| 6. Bảo mật | Quyền Oracle bị giới hạn. Người tham gia tự đối chiếu bằng chứng, có cửa sổ dispute và có thể claim khi hệ thống bị pause. Vault có rủi ro lỗ và thanh khoản. | [Bằng chứng vòng #1](https://studystake-puce.vercel.app/verify/1) và [threat model](THREAT_MODEL.md). |
| 7. Tác động và roadmap | Báo số ví đã join và phản hồi sau khi form đóng. Đề xuất dùng grant để chạy pilot thực tế, đo tỷ lệ nộp bài đúng hạn và xác minh bước đăng nhập. Aave fork và StudyNet cần mốc xác minh riêng. | Bảng pilot do hai nhóm đối chiếu. Giữ số liệu trống đến khi có kết quả. |

## Q&A kỹ thuật để cả hai tập

**Ai có thể lấy tiền gốc?** Manager giữ shares theo challenge. Oracle chỉ công bố root, bằng chứng và số liệu hoàn thành. Claim và expire vẫn chạy khi pause. Khi vault lỗ, giá trị tài sản còn lại được chia tỷ lệ.

**Oracle nhập sai hoặc bỏ sót người hoàn thành thì sao?** Trình duyệt tái tính hash và Merkle root, và người stake có thể dispute trong thời gian cho phép. Guardian có thể thay root. Moodle vẫn là dữ liệu do oracle kiểm tra và phiên demo vẫn cần tin oracle về kết quả.

**Grader có thể kiểm tra giao dịch thật ở đâu?** Vòng #1 trên Fuji ghi create, join, sponsor, settle, finalize và claim trong [README](../README.md#real-transactions-challenge-1). Thanh toán x402 trong demo được xác minh trên fork, trừ khi có thêm receipt trên Fuji công khai.

**Tại sao người mua phải trả tiền khi badge đã công khai?** Họ nhận xác nhận có chữ ký rằng ví đã liên kết với một tài khoản LMS cụ thể theo site và subject hash. Badge tự nó chỉ chứa thống kê on-chain. Credential đòi hỏi chủ ví opt-in và có hạn bảy ngày.

**Tại sao người mua không cần AVAX?** Người mua ký ủy quyền EIP-3009. Facilitator gửi giao dịch chuyển USDC và trả gas. Phí stake và claim là giao dịch ví riêng.

**Dữ liệu sinh viên nằm ở đâu?** Bằng chứng công khai gồm ví, trạng thái và hash. Token Moodle được mã hóa trong KV. Credential không công bố tên hoặc mã sinh viên. Chỉ dùng tài khoản Moodle của người đã đồng ý khi test pilot.

**Điều gì xảy ra nếu RPC hay relayer dừng?** Các khoản đã settle vẫn đối chiếu được khi RPC hoạt động lại. Tại buổi demo dùng đường dự phòng bên dưới. L1 và relayer miễn phí tự tắt sau ba ngày, nên nhóm chọn Aave fork cho phần thử nghiệm nâng cao.

## Kiểm tra trước lúc quay và đường dự phòng

1. Kiểm tra [web](https://studystake-puce.vercel.app), [oracle health](https://studystake-oracle.qalert-7k3m9x.workers.dev/health) và `/verify/1`. Chạy thử Google → ví nhúng → faucet, Core và MetaMask. Kiểm tra số dư cả oracle lẫn faucet bằng địa chỉ công khai của hai ví.
2. Tạo challenge Circle USDC, ghi hash join, settle, finalize, claim và x402. Mỗi giao dịch ghi chain ID, contract, token và vai trò của ví vào form chung. Đối chiếu các hash với Snowtrace trước khi quay.
3. Chuẩn bị fork khi còn mạng. Chạy `npm --prefix web run e2e:fork:run` và làm theo [hướng dẫn agent](X402.md#demo-buyer). Fork cần RPC nguồn khi dựng và khi đọc state chưa có trong cache.
4. Khi mất mạng hoàn toàn, dùng `npm --prefix oracle run e2e:anvil` sau khi đã cài dependencies, Foundry và cache solc. Phần x402 và Snowtrace khi đó phát từ video hoặc ảnh đã lưu sẵn. Mở thử các tệp đã lưu khi offline trước lúc trình bày.

## Trường cần có trong form feedback chung

- Nhóm tuyển người, ví Fuji, challenge ID và link giao dịch join.
- Loại ví và kết quả từng bước link LMS, lấy gas, join và claim.
- Bước bị kẹt, mã lỗi và mô tả ngắn. Chỉ đính kèm ảnh đã che dữ liệu nhạy cảm.
- Mức dễ sử dụng từ 1 đến 5 và một điều muốn cải thiện.

Đếm ví khác nhau theo giao dịch join hợp lệ trên Fuji. Đánh dấu ví trùng giữa hai nhóm trước khi tính mục tiêu mỗi nhóm 10 người.
