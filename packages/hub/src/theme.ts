/**
 * The look a person picked, kept on their account so every hub page and
 * every diagram they open wears it, on any device: light, dark, or their
 * system's setting. It comes with the person's row when the request signs
 * in, so reading it costs nothing.
 */
import type { Db } from './db/db.ts';
import type { Principal } from './auth/principal.ts';

export const READER_THEMES = ['system', 'light', 'dark'] as const;
export type ReaderTheme = (typeof READER_THEMES)[number];

export function readerTheme(p: Pick<Principal, 'theme'>): ReaderTheme {
  return p.theme ?? 'system';
}

export async function setReaderTheme(db: Db, userId: string, theme: ReaderTheme): Promise<void> {
  await db.query('update users set theme = $2 where id = $1', [userId, theme === 'system' ? null : theme]);
}
