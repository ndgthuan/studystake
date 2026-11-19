'use client';

import { useEffect, useRef } from 'react';
import { use_ui } from '@/hooks/use_ui';
import type { ChainMarkScene } from './chain_mark_scene';

export function ChainMark({ signal }: { signal?: string }) {
  const { theme } = use_ui();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ChainMarkScene | null>(null);
  const current = useRef(signal);

  useEffect(() => {
    current.current = signal;
    if (signal !== undefined) scene.current?.pulse();
  }, [signal, theme]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let alive = true;
    let visible = false;
    let loading = false;

    async function load() {
      if (!visible || reduced.matches || scene.current || loading || !surface) return;
      loading = true;
      try {
        const { createChainMark } = await import('./chain_mark_scene');
        if (!alive || reduced.matches || !visible) return;
        scene.current = createChainMark(surface);
        if (current.current !== undefined) scene.current?.pulse();
      } catch {
        // The decorative canvas is optional.
      } finally {
        loading = false;
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) void load();
    });
    const syncPreference = () => {
      if (reduced.matches) {
        scene.current?.dispose();
        scene.current = null;
      } else {
        void load();
      }
    };
    observer.observe(surface);
    reduced.addEventListener('change', syncPreference);
    return () => {
      alive = false;
      observer.disconnect();
      reduced.removeEventListener('change', syncPreference);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  return <canvas aria-hidden="true" className="chain-mark" ref={canvas} />;
}
