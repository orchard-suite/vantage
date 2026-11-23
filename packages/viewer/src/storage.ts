/**
 * Remembered choices (theme, sidebar, folds). Storage can be missing or
 * throw in private windows, sandboxed previews, and file viewers on phones,
 * so every read and write is guarded and the viewer works without it.
 */
export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // No storage; the choice lasts for the page.
  }
}

export function recall(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
