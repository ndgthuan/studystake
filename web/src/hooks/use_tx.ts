// Shared transaction state machine: idle -> signing -> pending -> confirmed | error.
// Simulates the call first so contract errors surface before the wallet prompt.
'use client';
import { useCallback, useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { explorer_tx } from '@/lib/config';
import { explain_error, type Lang } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useActionNotice } from '@/components/action_notices';

export type TxStatus = 'idle' | 'signing' | 'pending' | 'confirmed' | 'error';

export interface TxState {
  status: TxStatus;
  hash: `0x${string}` | null;
  error: string | null;
  explorer: string | null;
}

export interface TxRequest {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
}

const INITIAL: TxState = { status: 'idle', hash: null, error: null, explorer: null };

/** Runs a contract write through the state machine. `on_confirmed` runs after the receipt succeeds. */
export function use_tx(lang: Lang, on_confirmed?: () => void | Promise<void>) {
  const [state, set_state] = useState<TxState>(INITIAL);
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient();
  const notify = useActionNotice();

  const reset = useCallback(() => set_state(INITIAL), []);

  const run = useCallback(
    async (req: TxRequest): Promise<`0x${string}` | null> => {
      function fail(error: string, hash: `0x${string}` | null = null) {
        set_state({ status: 'error', hash, error, explorer: hash ? explorer_tx(hash) : null });
        notify({ tone: 'error', title: t(lang, 'tx_error'), detail: error });
        return null;
      }

      if (!wallet || !publicClient || !address) {
        return fail(explain_error(new Error('no wallet'), lang));
      }
      let hash: `0x${string}` | null = null;
      try {
        set_state({ status: 'signing', hash: null, error: null, explorer: null });
        await publicClient.simulateContract({
          account: address,
          address: req.address,
          abi: req.abi as readonly unknown[],
          functionName: req.functionName,
          args: req.args as readonly unknown[],
          value: req.value,
        } as Parameters<typeof publicClient.simulateContract>[0]);
        hash = await wallet.writeContract({
          address: req.address,
          abi: req.abi as readonly unknown[],
          functionName: req.functionName,
          args: req.args as readonly unknown[],
          value: req.value,
          gas: req.gas,
          account: address,
          chain: wallet.chain,
        } as Parameters<typeof wallet.writeContract>[0]);
        set_state({ status: 'pending', hash, error: null, explorer: explorer_tx(hash) });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          return fail(explain_error(new Error('reverted'), lang), hash);
        }
      } catch (err) {
        return fail(hash ? t(lang, 'tx_receipt_unknown') : explain_error(err, lang), hash);
      }
      set_state({ status: 'confirmed', hash, error: null, explorer: explorer_tx(hash) });
      if (req.functionName !== 'approve') notify({ tone: 'success', title: t(lang, 'tx_confirmed') });
      try {
        await on_confirmed?.();
      } catch {
        // A query refresh failure does not change the confirmed receipt.
      }
      return hash;
    },
    [wallet, publicClient, address, lang, on_confirmed, notify],
  );

  return { state, run, reset };
}
