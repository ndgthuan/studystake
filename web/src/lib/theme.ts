// Browser UI color per theme. Must match --bg in globals.css. Lives here because both the server layout and the
// client providers need it, and a server component cannot read a value exported from a 'use client' module.
export const THEME_COLORS = { dark: '#19202f', light: '#f7f5ed' } as const;
