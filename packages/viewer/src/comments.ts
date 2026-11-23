/**
 * The Comments panel: the open comments on the view, each with the boxes
 * it points at, the ones on the selected box first; a composer that
 * points a new comment at the selected box or at boxes picked on the
 * diagram; and the resolved ones folded away. When the hub revises from
 * comments, each open comment has a tick for whether the next revision
 * carries it out, and the revise section sits under the list. Typing `@`
 * in the composer mentions a person; reactions on the selected box and the
 * view's most flagged boxes sit under the composer.
 */
import type { ViewerContext } from './app.ts';
import { button, h } from './dom.ts';
import { ago, type HubComment, type HubPerson } from './hub.ts';
import type { Picker } from './pick.ts';
import { attachMentions, encodeMentions, mentionNodes } from './mention.ts';
import type { Reactions } from './reactions.ts';

export interface CommentsHost {
  readonly add: (view: string, targets: readonly string[], text: string) => Promise<void>;
  readonly resolve: (id: string, resolved: boolean) => Promise<void>;
  readonly picker: Picker;
  /** The people a comment may mention. */
  readonly people: () => Promise<readonly HubPerson[]>;
  readonly reactions: Reactions;
  /** Fires when the ticked comments change, so the revise section can count them. */
  readonly ticked: () => void;
}

export class CommentsPanel {
  readonly el = h('div', 'v-comments');
  private comments: readonly HubComment[] = [];
  private ctx: ViewerContext | undefined;
  /** Text being typed per view, so a refresh from a live save does not wipe it. */
  private readonly drafts = new Map<string, string>();
  /** People picked from the `@` list per view, name to id, so a redraw keeps who a draft mentions. */
  private readonly picked = new Map<string, Map<string, string>>();
  /** Open comments the reader unticked; the rest of the view's open comments go into a revision. */
  private readonly unticked = new Set<string>();
  /** Shown under the list when the hub revises from comments. */
  private revise: HTMLElement | undefined;

  constructor(private readonly host: CommentsHost) {}

  setComments(comments: readonly HubComment[]): void {
    this.comments = comments;
    if (this.ctx) this.render(this.ctx);
  }

  /** Puts the revise section under the list and the ticks beside each open comment. */
  attachRevise(el: HTMLElement): void {
    this.revise = el;
    if (this.ctx) this.render(this.ctx);
  }

  /** The open comments on the view the next revision carries out. */
  ticked(): string[] {
    return this.open().filter((c) => !this.unticked.has(c.id)).map((c) => c.id);
  }

  render(ctx: ViewerContext): void {
    this.ctx = ctx;
    this.el.replaceChildren();
    const view = ctx.view;
    if (!view) return;
    const node = ctx.node?.id;
    const open = this.open().sort((a, b) => Number(b.targets.includes(node ?? '')) - Number(a.targets.includes(node ?? '')));
    const done = this.comments.filter((c) => c.view === view.id && c.resolvedAt);
    this.el.appendChild(h('h3', undefined, 'On this view'));
    if (!open.length) this.el.appendChild(h('p', 'v-muted', 'No open comments on this view.'));
    for (const c of open) this.el.appendChild(this.comment(c));
    this.el.appendChild(this.composer(view.id));
    this.el.appendChild(this.host.reactions.section(ctx));
    if (done.length) {
      const fold = h('details', 'v-resolved');
      fold.appendChild(h('summary', undefined, `${done.length} resolved`));
      for (const c of done) fold.appendChild(this.comment(c));
      this.el.appendChild(fold);
    }
    if (this.revise) this.el.appendChild(this.revise);
  }

  private open(): HubComment[] {
    const view = this.ctx?.view?.id;
    return this.comments.filter((c) => c.view === view && !c.resolvedAt);
  }

  /** A box's name on the stage, or its id when this picture does not draw it. */
  private nameOf(id: string): string {
    return this.ctx?.drawn?.boxes.find((b) => b.id === id)?.name ?? id;
  }

  private chips(ids: readonly string[], remove?: (id: string) => void): HTMLElement {
    const row = h('div', 'v-chips');
    for (const id of ids) {
      const chip = h('span', 'v-chip', this.nameOf(id));
      if (remove) chip.appendChild(button('×', () => remove(id), `Stop pointing at ${this.nameOf(id)}`, 'v-chip-x'));
      row.appendChild(chip);
    }
    return row;
  }

  private composer(view: string): HTMLElement {
    const picker = this.host.picker;
    const targets = picker.ids.length ? picker.ids : this.ctx?.node ? [this.ctx.node.id] : [];
    const form = h('div', 'v-field v-compose');
    const about = h('div', 'v-about');
    about.appendChild(h('span', 'v-muted', targets.length ? 'About' : 'About the whole view'));
    if (targets.length) about.appendChild(this.chips(targets, picker.ids.length ? (id) => picker.remove(id) : undefined));
    const pick = button(picker.active ? 'Done picking' : 'Pick boxes', () => picker.toggle(), picker.active ? 'Stop picking boxes on the diagram' : 'Click boxes on the diagram to point this comment at them', `v-btn${picker.active ? ' v-btn-primary' : ''}`);
    pick.setAttribute('aria-pressed', String(picker.active));
    about.appendChild(pick);
    if (picker.active) form.appendChild(h('p', 'v-muted', 'Click boxes on the diagram to add or remove them. A click in empty space adds the nearest box.'));
    const text = h('textarea', 'v-text');
    text.rows = 2;
    text.placeholder = `${targets.length ? 'Comment on these boxes' : 'Comment on this view'}; @ mentions someone`;
    text.setAttribute('aria-label', text.placeholder);
    text.value = this.drafts.get(view) ?? '';
    text.addEventListener('input', () => this.drafts.set(view, text.value));
    let picked = this.picked.get(view);
    if (!picked) this.picked.set(view, (picked = new Map()));
    const field = attachMentions(text, this.host.people, picked);
    const send = button('Comment', () => {
      const t = encodeMentions(text.value.trim(), picked);
      if (!t) return;
      send.disabled = true;
      this.drafts.delete(view);
      this.picked.delete(view);
      void this.host.add(view, targets, t).finally(() => {
        send.disabled = false;
        picker.clear();
      });
    }, 'Add this comment', 'v-btn v-btn-primary');
    form.append(about, field, send);
    return form;
  }

  private comment(c: HubComment): HTMLElement {
    const resolved = Boolean(c.resolvedAt);
    const row = h('div', 'v-comment' + (resolved ? ' done' : ''));
    const who = c.authorLabel ?? 'Someone';
    const avatar = h('span', 'v-avatar', who.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 2).map((w) => w[0]).join('') || '?');
    avatar.setAttribute('aria-hidden', 'true');
    const meta = h('div', 'meta');
    if (this.revise && !resolved) {
      const tick = h('input');
      tick.type = 'checkbox';
      tick.checked = !this.unticked.has(c.id);
      tick.setAttribute('aria-label', 'Carry this comment out in the next revision');
      tick.title = 'Carry this comment out in the next revision';
      tick.addEventListener('change', () => {
        if (tick.checked) this.unticked.delete(c.id);
        else this.unticked.add(c.id);
        this.host.ticked();
      });
      meta.appendChild(tick);
    }
    meta.appendChild(h('span', 'who', who));
    meta.appendChild(h('span', undefined, ago(c.createdAt)));
    meta.appendChild(button(resolved ? 'Reopen' : 'Resolve', () => void this.host.resolve(c.id, !resolved), resolved ? 'Reopen this comment' : 'Mark this comment resolved', 'v-link'));
    const body = h('div', 'v-comment-body');
    if (c.targets.length) body.appendChild(this.chips(c.targets));
    const words = h('p');
    words.append(...mentionNodes(c.text, c.mentionLabels ?? {}));
    body.appendChild(words);
    row.append(avatar, meta, body);
    if (c.targets.length) {
      row.addEventListener('mouseenter', () => this.host.picker.peek(c.targets));
      row.addEventListener('mouseleave', () => this.host.picker.peek(undefined));
    }
    return row;
  }
}
