// Maps contract custom errors (and wallet/RPC failures) to short Vietnamese and English messages.
export type Lang = 'vi' | 'en';

const MESSAGES: Record<string, { vi: string; en: string }> = {
  TokenNotAllowed: { vi: 'Token chưa được cho phép', en: 'Token is not allowed' },
  VaultNotAllowed: { vi: 'Vault chưa được cho phép', en: 'Vault is not allowed' },
  VaultAssetMismatch: { vi: 'Vault không khớp với token', en: 'Vault asset does not match token' },
  InvalidParams: { vi: 'Tham số không hợp lệ', en: 'Invalid parameters' },
  WrongStatus: { vi: 'Challenge không ở trạng thái cho phép thao tác này', en: 'Challenge is not in the right state' },
  TooEarly: { vi: 'Chưa đến thời điểm cho phép', en: 'Too early' },
  TooLate: { vi: 'Đã quá hạn tham gia', en: 'Join deadline has passed' },
  AlreadyJoined: { vi: 'Ví này đã tham gia challenge', en: 'This wallet already joined' },
  StakeOutOfRange: { vi: 'Số tiền cọc nằm ngoài khoảng cho phép', en: 'Stake is outside the allowed range' },
  NotParticipant: { vi: 'Ví này không phải người tham gia', en: 'This wallet is not a participant' },
  AlreadyClaimed: { vi: 'Bạn đã nhận tiền rồi', en: 'Already claimed' },
  AlreadyDisputed: { vi: 'Bạn đã khiếu nại challenge này', en: 'Already disputed' },
  InvalidProof: { vi: 'Bằng chứng Merkle không hợp lệ', en: 'Invalid Merkle proof' },
  InvalidSettlement: { vi: 'Kết quả settle không hợp lệ', en: 'Invalid settlement' },
  NothingToRefund: { vi: 'Không có gì để hoàn lại', en: 'Nothing to refund' },
  AlreadySwept: { vi: 'Phần thưởng đã được thu hồi', en: 'Rewards already swept' },
  ZeroAddress: { vi: 'Địa chỉ không hợp lệ', en: 'Zero address' },
  ZeroAmount: { vi: 'Số tiền phải lớn hơn 0', en: 'Amount must be greater than 0' },
  InsufficientGas: {
    vi: 'Gas không đủ để cập nhật huy hiệu. Hãy tăng gas rồi thử lại',
    en: 'Not enough gas for the badge update. Increase gas and retry',
  },
  NothingToCollect: { vi: 'Không có phí treasury để thu', en: 'Nothing to collect' },
  EnforcedPause: { vi: 'Hệ thống đang tạm dừng', en: 'System is paused' },
  ExpectedPause: { vi: 'Hệ thống chưa tạm dừng', en: 'System is not paused' },
  SafeERC20FailedOperation: {
    vi: 'Chuyển token thất bại (kiểm tra số dư và allowance)',
    en: 'Token transfer failed (check balance and allowance)',
  },
  ERC20InsufficientBalance: { vi: 'Không đủ USDC', en: 'Insufficient USDC balance' },
  ERC20InsufficientAllowance: { vi: 'Chưa cấp quyền chi USDC', en: 'Insufficient USDC allowance' },
  FaucetCooldown: { vi: 'Bạn đã nhận tUSDC hôm nay, thử lại sau', en: 'Faucet cooldown, try again later' },
  Soulbound: { vi: 'Huy hiệu không thể chuyển nhượng', en: 'Badge is soulbound' },
};

const WALLET_MESSAGES: { match: RegExp; vi: string; en: string }[] = [
  { match: /user rejected|user denied|rejected the request/i, vi: 'Bạn đã từ chối giao dịch', en: 'You rejected the request' },
  { match: /insufficient funds/i, vi: 'Không đủ AVAX để trả phí gas', en: 'Not enough AVAX for gas' },
];

const KNOWN_NAMES = Object.keys(MESSAGES);

/** Returns the user-facing message for an error object. Uses custom error names when present. */
export function explain_error(err: unknown, lang: Lang): string {
  const name = error_name(err);
  if (name && MESSAGES[name]) return MESSAGES[name]![lang];
  const text = err instanceof Error ? err.message : String(err);
  for (const w of WALLET_MESSAGES) {
    if (w.match.test(text)) return w[lang];
  }
  return lang === 'vi' ? 'Giao dịch thất bại. Thử lại sau.' : 'Transaction failed. Please try again.';
}

/** Pulls a custom error name out of viem-style errors (errorName, nested cause, or the message text). */
export function error_name(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { errorName?: unknown; cause?: unknown; message?: unknown };
  if (typeof e.errorName === 'string') return e.errorName;
  if (e.cause && typeof e.cause === 'object') {
    const inner = (e.cause as { errorName?: unknown }).errorName;
    if (typeof inner === 'string') return inner;
  }
  if (typeof e.message === 'string') {
    for (const name of KNOWN_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(e.message)) return name;
    }
  }
  return null;
}
