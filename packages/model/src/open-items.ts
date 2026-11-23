/**
 * Open item kinds and severities, without the schema library, so the
 * renderer and the viewer read them in a browser.
 */
export const OPEN_ITEM_KINDS = ['issue', 'alert', 'pr', 'incident'] as const;
/** Worst first. */
export const ITEM_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export type OpenItemKind = (typeof OPEN_ITEM_KINDS)[number];
export type ItemSeverity = (typeof ITEM_SEVERITIES)[number];

/** The worst severity of a list; items without one count as info. Undefined for an empty list. */
export function worstSeverity(items: readonly { readonly severity?: ItemSeverity | undefined }[]): ItemSeverity | undefined {
  if (!items.length) return undefined;
  let worst = ITEM_SEVERITIES.length - 1;
  for (const i of items) worst = Math.min(worst, ITEM_SEVERITIES.indexOf(i.severity ?? 'info'));
  return ITEM_SEVERITIES[worst];
}
