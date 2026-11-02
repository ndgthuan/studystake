'use client';
// Badge: reads badge_of + tokenURI on chain and renders the on-chain SVG through an <img data:> tag.
// The SVG is produced by the contract, never by page code, and is shown as an image, not as markup.
import { useQuery } from '@tanstack/react-query';
import { use_ui } from '@/hooks/use_ui';
import { t } from '@/lib/i18n';
import { addresses, abis, public_client } from '@/lib/contracts';

interface BadgeData {
  token_id: bigint;
  image: string | null;
  streak: number;
  best_streak: number;
  total_completed: number;
  tier: string;
}

export function BadgeCard({ wallet }: { wallet: `0x${string}` }) {
  const { lang } = use_ui();
  const q = useQuery<BadgeData | null>({
    queryKey: ['badge', wallet],
    queryFn: async () => {
      const badge_id = (await public_client.readContract({
        address: addresses.badge,
        abi: abis.badge,
        functionName: 'badge_of',
        args: [wallet],
      })) as bigint;
      if (badge_id === 0n) return null;
      const uri = (await public_client.readContract({
        address: addresses.badge,
        abi: abis.badge,
        functionName: 'tokenURI',
        args: [badge_id],
      })) as string;
      const json = JSON.parse(decode_data_uri(uri)) as {
        image: string;
        attributes: { trait_type: string; value: string | number }[];
      };
      const attr = (name: string) => json.attributes.find((a) => a.trait_type === name)?.value;
      return {
        token_id: badge_id,
        image: json.image,
        streak: Number(attr('streak') ?? 0),
        best_streak: Number(attr('best_streak') ?? 0),
        total_completed: Number(attr('total_completed') ?? 0),
        tier: String(attr('tier') ?? 'Bronze'),
      };
    },
  });

  if (q.isLoading) return null;
  if (!q.data) {
    return (
      <section className="card p-4 text-sm text-[var(--muted)]">
        {t(lang, 'badge_title')}: —
      </section>
    );
  }
  const b = q.data;
  return (
    <section className="card flex flex-col gap-3 p-4 sm:flex-row">
      {b.image ? <img src={b.image} alt={`${b.tier} badge`} width={160} height={160} className="h-40 w-40 rounded-lg" /> : null}
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{t(lang, 'badge_title')} · {b.tier}</h2>
        <div className="num text-sm">{t(lang, 'streak')}: {b.streak}</div>
        <div className="num text-sm text-[var(--muted)]">best {b.best_streak} · total {b.total_completed}</div>
      </div>
    </section>
  );
}

/** Decodes a data:application/json;base64,... URI. Throws on other schemes. */
export function decode_data_uri(uri: string): string {
  const prefix = 'data:application/json;base64,';
  if (!uri.startsWith(prefix)) throw new Error('unexpected tokenURI scheme');
  const b64 = uri.slice(prefix.length);
  return typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
}
