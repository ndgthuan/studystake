'use client';
import { useState } from 'react';
import { useWalletClient } from 'wagmi';
import { ORACLE_URL } from '@/lib/config';
import { oracle, type MoodleSession } from '@/lib/oracle';

export function use_moodle_session(wallet: `0x${string}` | undefined, now: number) {
  const { data: client } = useWalletClient();
  const [session, set_session] = useState<(MoodleSession & { wallet: string; generation: string }) | null>(null);
  const active = session && session.wallet === wallet && session.expires_at > now ? session : null;

  async function authorize(force = false) {
    const issued_at = Math.floor(Date.now() / 1000);
    if (active && !force && active.expires_at > issued_at) return active.token;
    if (!wallet || !client) throw new Error('Wallet unavailable');
    const message = `StudyStake Moodle session\nwallet: ${wallet.toLowerCase()}\norigin: ${new URL(ORACLE_URL).origin}\nissued_at: ${issued_at}`;
    const signature = await client.signMessage({ account: wallet, message });
    const next = await oracle.post_session({ wallet, issued_at, signature });
    set_session({ ...next, wallet, generation: crypto.randomUUID() });
    return next.token;
  }

  return { token: active?.token, generation: active?.generation, authorize, clear: () => set_session(null), ready: !!client };
}

export type MoodleAccess = ReturnType<typeof use_moodle_session>;
