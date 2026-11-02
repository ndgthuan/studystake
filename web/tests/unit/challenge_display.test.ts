import { describe, expect, it } from 'vitest';
import { countdown_target, pot_display } from '@/lib/challenge_display';

const base = { join_deadline: 1000, end_time: 2000, settle_grace: 600, settled_at: 3000, dispute_window: 300 };

describe('countdown_target', () => {
  it('targets join_deadline while joining', () => {
    expect(countdown_target({ ...base, phase: 'Joining' })).toBe(1000);
  });
  it('targets end_time while running', () => {
    expect(countdown_target({ ...base, phase: 'Running' })).toBe(2000);
  });
  it('targets the end of the settle grace while awaiting settle', () => {
    expect(countdown_target({ ...base, phase: 'AwaitingSettle' })).toBe(2600);
  });
  it('targets the end of the dispute window in the dispute window', () => {
    expect(countdown_target({ ...base, phase: 'DisputeWindow' })).toBe(3300);
  });
  it('has no countdown once finalized or expired, or when actionable', () => {
    for (const phase of ['Finalized', 'Expired', 'Expirable', 'Finalizable', 'Disputed'] as const) {
      expect(countdown_target({ ...base, phase })).toBeNull();
    }
  });
});

describe('pot_display', () => {
  it('shows the real reward pot after finalize (yield plus bonus)', () => {
    const r = pot_display({
      phase: 'Finalized',
      reward_pot: 89_999_999n,
      total_bonus: 30_000_000n,
      total_shares_assets: 690_000_000n,
      total_principal: 600_000_000n,
    });
    expect(r).toEqual({ amount: 89_999_999n, estimated: false });
  });

  it('shows bonus plus estimated yield before finalize, marked as estimated', () => {
    const r = pot_display({
      phase: 'Running',
      reward_pot: 0n,
      total_bonus: 30_000_000n,
      total_shares_assets: 660_000_000n,
      total_principal: 600_000_000n,
    });
    expect(r).toEqual({ amount: 90_000_000n, estimated: true });
  });

  it('floors the estimated yield at zero when the vault is below principal', () => {
    const r = pot_display({
      phase: 'AwaitingSettle',
      reward_pot: 0n,
      total_bonus: 30_000_000n,
      total_shares_assets: 500_000_000n,
      total_principal: 600_000_000n,
    });
    expect(r).toEqual({ amount: 30_000_000n, estimated: true });
  });
});
