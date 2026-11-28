/** The Mentions list on the home page: every comment that names the reader, newest first, each opening its view and box. */
import type { MentionItem } from '../mentions.ts';
import { escapeHtml } from './html.ts';
import { plural, when } from './library.ts';
import { clockOf } from '../day.ts';

export function mentionsSection(items: readonly MentionItem[], now: number): string {
  const head = `<div class="lib-head"><h2 id="mentions">Mentions</h2><span>${items.length ? plural(items.length, 'comment') : ''}</span></div>`;
  if (!items.length) return `<section class="lib" aria-labelledby="mentions">${head}<p class="none-here"><b>Nobody has mentioned you yet.</b> When a comment names you with @, it shows up here and you get an email if the workspace sends mail.</p></section>`;
  const rows = items
    .map((m) => {
      const by = `${m.authorLabel ?? 'Someone'}, ${when(m.createdAt, now)}${m.resolved ? ', resolved' : ''}`;
      return `<li><a href="${escapeHtml(m.link)}"><span class="name">${escapeHtml(m.documentName)}</span><span class="where" title="${escapeHtml(clockOf(m.createdAt))}">${escapeHtml(by)}</span><span class="snip">${escapeHtml(m.text)}</span></a></li>`;
    })
    .join('');
  return `<section class="lib" aria-labelledby="mentions">${head}<ul class="results">${rows}</ul></section>`;
}
