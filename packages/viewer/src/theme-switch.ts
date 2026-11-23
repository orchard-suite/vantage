/**
 * The reader's light or dark choice. On the hub it lives on their account,
 * so every hub page and every diagram they open wears it, on any device.
 * Elsewhere this browser keeps it, and the address carries it so a reload
 * and a shared link keep it.
 */
import type { Bundle } from './bundle.ts';
import { recall, remember } from './storage.ts';

export const THEME_KEY = 'vantage:theme';

/** The theme the viewer opens in: one the address names, else the reader's pick on the hub (system follows the system setting), else this browser's memory, else the document's own. */
export function initialTheme(bundle: Bundle): string {
  const asked = new URLSearchParams(location.search).get('theme');
  if (asked === 'dark' || asked === 'light') return asked;
  const pick = bundle.hub?.theme;
  if (pick === 'light' || pick === 'dark') return pick;
  if (pick === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const kept = recall(THEME_KEY);
  return kept === 'dark' || kept === 'light' ? kept : bundle.theme;
}

/** Flips the theme and answers the one now on. */
export function toggleTheme(bundle: Bundle): 'dark' | 'light' {
  const next = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset['theme'] = next;
  const url = new URL(location.href);
  if (bundle.hub) {
    // The account keeps it; an address that named a theme would undo the pick on the next reload.
    void saveTheme(bundle.hub.apiBase, bundle.hub.csrf, next);
    if (url.searchParams.has('theme')) {
      url.searchParams.delete('theme');
      history.replaceState(history.state, '', url);
    }
    return next;
  }
  remember(THEME_KEY, next);
  url.searchParams.set('theme', next);
  // The dev server renders the picture in the asked theme.
  if (bundle.live) location.href = url.toString();
  return next;
}

async function saveTheme(apiBase: string, csrf: string | undefined, theme: 'dark' | 'light'): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf !== undefined) headers['x-csrf-token'] = csrf;
  try {
    const res = await fetch(`${apiBase}/me/theme`, { method: 'PUT', headers, credentials: 'same-origin', body: JSON.stringify({ theme }) });
    if (!res.ok) console.warn(`vantage: the hub did not keep the theme (${res.status})`);
  } catch {
    // Offline: the page keeps the theme until it reloads.
  }
}
