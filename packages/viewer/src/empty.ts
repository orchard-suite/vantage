/**
 * What an empty stage says. A version still drawing says so. A document
 * that defines a kind of item, and draws nothing, points at the board its
 * items are on; a reader who opened it was looking for them.
 */
import type { Bundle } from './bundle.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

/** Fills the empty stage for this bundle and answers the header's title. */
export function fillEmpty(empty: HTMLElement, bundle: Bundle): string {
  empty.classList.add('show');
  if (bundle.pending) {
    empty.append(icon('info', 28), h('p', undefined, 'Rendering this version. The picture appears here when it is ready.'));
    return 'Rendering';
  }
  const items = bundle.hub?.items;
  if (items) {
    const link = h('a', 'v-empty-link', `Open the ${items.name} board`);
    link.href = items.url;
    empty.append(icon('page', 28), h('p', undefined, `This document defines ${items.name}. Its items are on the Work board.`), link);
    return items.name;
  }
  empty.append(icon('page', 28), h('p', undefined, 'This document has no views yet.'));
  return 'No views';
}
