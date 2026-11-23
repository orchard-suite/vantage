/** The banner over the stage that lists a document's errors, with a button to dismiss it; nothing when there are none. */
import type { Bundle } from './bundle.ts';
import { h, iconButton } from './dom.ts';
import { icon } from './icons.ts';

export function showDiagnostics(diagnostics: Bundle['diagnostics'], area: HTMLElement): void {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (!errors.length) return;
  const d = h('div', 'v-diag');
  d.setAttribute('role', 'alert');
  const list = h('ul');
  for (const x of errors) list.appendChild(h('li', undefined, `${x.line ? `Line ${x.line}: ` : ''}${x.message}`));
  const words = h('div', 'v-diag-words');
  words.append(h('b', undefined, errors.length === 1 ? 'This document has an error' : `This document has ${errors.length} errors`), list);
  d.append(icon('warn'), words, iconButton('close', 'Dismiss', () => d.remove(), 'v-btn v-icon-btn v-quiet'));
  area.appendChild(d);
}
