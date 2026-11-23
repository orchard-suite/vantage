/**
 * The History panel: versions newest first with author, message, time, and
 * the layout score of the current view. Picking a version compares it with
 * the head; picking another compares the two. The visual diff is drawn over
 * the stage with its narrative; an older version can be restored as a new one.
 */
import type { ViewerContext } from './app.ts';
import { button, h } from './dom.ts';
import { ago, type DiffChange, type HubVersion } from './hub.ts';

export interface HistoryHost {
  readonly canEdit: boolean;
  readonly restore: (version: string) => Promise<void>;
  readonly diffSvgUrl: (a: string, b: string, view: string, theme: 'light' | 'dark') => string;
  readonly diffChanges: (a: string, b: string, view: string) => Promise<readonly DiffChange[]>;
}

export class HistoryPanel {
  readonly el = h('div', 'v-history');
  /** The diff picture, drawn over the stage while two versions are picked. */
  readonly overlay = h('div', 'v-diffview');
  /** The change list under the version list while a diff is shown; the picture carries the same story. */
  private readonly story = h('ul', 'v-story-list');
  private versions: readonly HubVersion[] = [];
  private head: string | undefined;
  private picked: string[] = [];
  private ctx: ViewerContext | undefined;

  constructor(private readonly host: HistoryHost) {
    this.overlay.setAttribute('role', 'region');
    this.overlay.setAttribute('aria-label', 'Visual diff');
  }

  setVersions(head: string, versions: readonly HubVersion[]): void {
    this.head = head;
    this.versions = versions;
    this.picked = this.picked.filter((id) => versions.some((v) => v.id === id));
    if (this.ctx) this.render(this.ctx);
  }

  render(ctx: ViewerContext): void {
    const viewChanged = this.ctx?.view?.id !== ctx.view?.id;
    this.ctx = ctx;
    this.el.replaceChildren();
    const view = ctx.view;
    if (!view) return;
    this.el.appendChild(h('p', 'v-muted', this.picked.length === 2 ? 'Showing what changed in this view. Pick a version again to drop it.' : 'Pick a version to see what changed in this view since then.'));
    const list = h('ol', 'v-versions');
    for (const v of this.versions) {
      const li = h('li', this.picked.includes(v.id) ? 'picked' : undefined);
      const top = h('div', 'top');
      const pick = button(v.message || '(no message)', () => this.toggle(v.id), `Pick version from ${ago(v.createdAt)}`, 'v-link msg');
      top.appendChild(pick);
      const side = this.side(v.id);
      if (side) top.appendChild(h('span', 'k side', side));
      if (v.id === this.head) top.appendChild(h('span', 'k', 'Current'));
      const score = v.scores[view.id];
      if (score !== undefined) top.appendChild(h('span', 'score', `layout ${score}`));
      const meta = h('div', 'meta');
      meta.appendChild(h('span', undefined, `${v.authorLabel ?? 'someone'}, ${ago(v.createdAt)}`));
      if (this.host.canEdit && v.id !== this.head) meta.appendChild(button('Restore', () => void this.host.restore(v.id), 'Save this version as the new head', 'v-link'));
      li.append(top, meta);
      list.appendChild(li);
    }
    if (!this.versions.length) list.appendChild(h('li', 'v-muted', 'No versions yet.'));
    this.el.append(list, this.story);
    if (viewChanged || this.picked.length !== 2) void this.showDiff();
  }

  /** "From" or "To" for a picked version in the shown diff. */
  private side(id: string): string | undefined {
    if (this.picked.length !== 2 || !this.picked.includes(id)) return undefined;
    const [a] = this.versions.filter((v) => this.picked.includes(v.id)).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    return a?.id === id ? 'From' : 'To';
  }

  private toggle(id: string): void {
    if (this.picked.includes(id)) this.picked = this.picked.filter((x) => x !== id);
    else if (!this.picked.length && this.head && id !== this.head) this.picked = [this.head, id];
    else this.picked = [...this.picked.slice(-1), id];
    if (this.ctx) this.render(this.ctx);
    void this.showDiff();
  }

  private async showDiff(): Promise<void> {
    const view = this.ctx?.view;
    if (this.picked.length !== 2 || !view) {
      this.overlay.classList.remove('show');
      this.overlay.replaceChildren();
      this.story.replaceChildren();
      return;
    }
    const byTime = this.versions.filter((v) => this.picked.includes(v.id)).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    const [a, b] = byTime;
    if (!a || !b) return;
    const theme = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
    this.overlay.replaceChildren();
    const bar = h('div', 'bar');
    const said = (v: HubVersion): string => v.message || `the version from ${ago(v.createdAt)}`;
    bar.appendChild(h('span', undefined, `Comparing ${said(a)} with ${said(b)}`));
    bar.appendChild(button('Close', () => {
      this.picked = [];
      if (this.ctx) this.render(this.ctx);
      void this.showDiff();
    }, 'Close the diff', 'v-btn'));
    const img = h('img');
    img.alt = `Visual diff of ${view.title}`;
    img.src = this.host.diffSvgUrl(a.id, b.id, view.id, theme);
    this.overlay.append(bar, img);
    this.overlay.classList.add('show');
    this.story.replaceChildren(h('li', 'v-muted', 'Reading the changes.'));
    try {
      const changes = await this.host.diffChanges(a.id, b.id, view.id);
      this.story.replaceChildren();
      if (!changes.length) this.story.appendChild(h('li', 'v-muted', 'No changes in this view.'));
      for (const c of changes) this.story.appendChild(h('li', c.kind, c.text));
    } catch (err) {
      this.story.replaceChildren(h('li', 'v-muted', `The diff could not be read: ${(err as Error).message}`));
    }
  }
}
