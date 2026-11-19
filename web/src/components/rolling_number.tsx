'use client';

import { useEffect, useRef } from 'react';
import { format_usdc } from '@/lib/usdc';

export function RollingNumber({ value, usdc = false }: { value?: bigint; usdc?: boolean }) {
  const text = useRef<HTMLSpanElement>(null);
  const shown = useRef<bigint | undefined>(undefined);
  const format = usdc ? format_usdc : format_count;

  useEffect(() => {
    if (!text.current) return;
    const node = text.current;
    const from = shown.current ?? 0n;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    function finish() {
      cancelAnimationFrame(frame);
      shown.current = value;
      node.textContent = value === undefined ? '—' : format(value);
      delete node.dataset.counting;
    }

    if (value === undefined || reduced.matches || from === value) {
      finish();
      return;
    }

    const destination = value;
    const duration = shown.current === undefined ? 980 : 690;
    const start = performance.now();
    node.dataset.counting = '';

    function tick(now: number) {
      if (reduced.matches || now - start >= duration) {
        finish();
        return;
      }
      const eased = 1 - (1 - (now - start) / duration) ** 3;
      const step = (destination - from) * BigInt(Math.floor(eased * 10_000));
      const amount = from + (step + (step < 0n ? -5_000n : 5_000n)) / 10_000n;
      if (amount !== shown.current) node.textContent = format(amount);
      shown.current = amount;
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      delete node.dataset.counting;
    };
  }, [value, format]);

  return <>
    <span ref={text} className="ledger-value" aria-hidden="true">—</span>
    <span className="sr-only">{value === undefined ? '—' : format(value)}</span>
  </>;
}

function format_count(value: bigint) {
  return value.toLocaleString('en-US');
}
