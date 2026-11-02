// Pure display helpers for the challenge detail page. No I/O, so they are unit-testable.
import type { PhaseName } from './contracts';

export interface DeadlineInput {
  phase: PhaseName;
  join_deadline: number;
  end_time: number;
  settle_grace: number;
  settled_at: number;
  dispute_window: number;
}

/**
 * The next deadline for the current phase, in unix seconds, or null when no countdown applies.
 * Joining counts down to join_deadline, Running to end_time, AwaitingSettle to the end of the settle grace,
 * DisputeWindow to the end of the dispute window. Finalized, Expired, Expirable and Finalizable show no countdown.
 */
export function countdown_target(input: DeadlineInput): number | null {
  switch (input.phase) {
    case 'Joining':
      return input.join_deadline;
    case 'Running':
      return input.end_time;
    case 'AwaitingSettle':
      return input.end_time + input.settle_grace;
    case 'DisputeWindow':
      return input.settled_at + input.dispute_window;
    default:
      return null;
  }
}

/**
 * The USDC amount shown as the reward fund.
 * Finalized (or Expired): the real reward pot from chain (yield plus bonus), since yield is settled.
 * Before that: bonus plus an estimate of yield, floored at zero. The estimate is labelled as such in the UI.
 */
export function pot_display(args: {
  phase: PhaseName;
  reward_pot: bigint;
  total_bonus: bigint;
  total_shares_assets: bigint;
  total_principal: bigint;
}): { amount: bigint; estimated: boolean } {
  if (args.phase === 'Finalized' || args.phase === 'Expired') {
    return { amount: args.reward_pot, estimated: false };
  }
  const estimated_yield = args.total_shares_assets > args.total_principal ? args.total_shares_assets - args.total_principal : 0n;
  return { amount: args.total_bonus + estimated_yield, estimated: true };
}
