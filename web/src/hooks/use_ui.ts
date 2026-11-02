'use client';
// UI context (language, theme, Privy flag). Lives in hooks/ so the snake_case hook name is allowed by lint.
import { createContext, useContext } from 'react';
import type { Lang } from '@/lib/i18n';

export type Theme = 'dark' | 'light';

export interface UiContext {
  lang: Lang;
  set_lang: (l: Lang) => void;
  theme: Theme;
  set_theme: (t: Theme) => void;
  privy_enabled: boolean;
}

export const UiCtx = createContext<UiContext | null>(null);

export function use_ui(): UiContext {
  const ctx = useContext(UiCtx);
  if (!ctx) throw new Error('use_ui must be used inside Providers');
  return ctx;
}
