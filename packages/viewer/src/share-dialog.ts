/**
 * Share, in the hub: guest links (authors), the embed snippet for the
 * view on the stage, and who can already open the document. Everything it
 * shows comes from the hub when it opens; nothing is cached.
 */
import type { BundleView } from './bundle.ts';
import { HubError, type GuestLink, type HubClient, type ShareInfo } from './hub.ts';
import { Dialog, copyButton, segmented, switchRow } from './dialog.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

type Tab = 'link' | 'embed' | 'people';

const EXPIRY = [['24', '1 day'], ['168', '7 days'], ['720', '30 days']] as const;

export class ShareDialog {
  private readonly dialog: Dialog;
  private info: ShareInfo | undefined;
  private tab: Tab = 'link';
  private readonly tabs: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly footNote: HTMLElement;
  private onlyView = true;
  private hours = '168';
  private created: GuestLink | undefined;

  constructor(private readonly hub: HubClient, private readonly current: () => BundleView | undefined, private readonly views: () => readonly BundleView[], docTitle: string) {
    this.dialog = new Dialog(`Share ${docTitle}`, 'Send a link, put a view on another page, or see who can already open it.');
    this.tabs = h('div', 'tabs v-share-tabs');
    this.tabs.setAttribute('role', 'tablist');
    this.panel = h('div', 'v-share-panel');
    this.panel.setAttribute('role', 'tabpanel');
    this.dialog.body.append(this.tabs, this.panel);
    const done = h('button', 'btn', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => this.dialog.close());
    this.footNote = h('span', 'f-hint v-dlg-foot-note', 'Guest links are read only.');
    this.dialog.foot.append(this.footNote, done);
  }

  async open(): Promise<void> {
    this.created = undefined;
    this.panel.replaceChildren(h('p', 'f-hint', 'Loading'));
    this.dialog.open();
    try {
      this.info = await this.hub.share();
      this.tab = this.info.canShare && this.info.guestLinksAllowed ? 'link' : 'embed';
      this.footNote.hidden = !this.info.guestLinksOnHub;
    } catch (err) {
      this.info = undefined;
      this.panel.replaceChildren(this.banner('bad', err instanceof Error ? err.message : 'The hub did not answer.'));
      return;
    }
    this.render();
  }

  private render(): void {
    const tabs: [Tab, string][] = [...(this.info?.guestLinksOnHub === false ? [] : [['link', 'Guest link'] as [Tab, string]]), ['embed', 'Embed'], ['people', 'People']];
    this.tabs.replaceChildren(
      ...tabs.map(([id, label]) => {
        const b = h('button', undefined, label);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(this.tab === id));
        b.addEventListener('click', () => {
          this.tab = id;
          this.render();
        });
        return b;
      }),
    );
    this.panel.replaceChildren(...(this.tab === 'link' ? this.linkTab() : this.tab === 'embed' ? this.embedTab() : this.peopleTab()));
  }

  private banner(tone: 'ok' | 'warn' | 'bad', text: string): HTMLElement {
    const b = h('div', `banner ${tone}`);
    b.append(icon(tone === 'ok' ? 'check' : 'warn'), h('span', undefined, text));
    return b;
  }

  private linkTab(): HTMLElement[] {
    const info = this.info!;
    const out: HTMLElement[] = [h('p', 'v-share-lede', 'Your link works for anyone you send it to, with no account. They can look and walk through, not edit.')];
    if (!info.guestLinksAllowed) return [...out, this.banner('warn', 'Guest links are turned off for this workspace.')];
    if (!info.canShare) return [...out, this.banner('warn', `Only authors of ${info.workspace.name} can make guest links.`)];
    if (this.created?.url) {
      const box = h('div', 'v-share-url');
      box.append(icon('share'), h('code', undefined, this.created.url), copyButton(() => this.created?.url ?? '', 'Copy link'));
      out.push(this.banner('ok', 'Link ready. Copy it now: the hub keeps only a fingerprint of it.'), box);
    }
    const view = this.current();
    const pass = h('input', 'field');
    pass.type = 'text';
    pass.placeholder = 'Optional, 4 characters or more';
    pass.autocomplete = 'off';
    pass.id = 'v-share-pass';
    const passRow = h('div', 'v-dlg-field');
    const passLabel = h('label', 'caps', 'Passcode');
    passLabel.htmlFor = pass.id;
    passRow.append(passLabel, pass, h('span', 'f-hint', 'Send it separately from the link.'));
    const expiry = segmented('Expires', EXPIRY, this.hours as (typeof EXPIRY)[number][0], (v) => (this.hours = v));
    const expiryRow = h('div', 'v-dlg-field');
    expiryRow.append(h('span', 'caps', 'Expires'), expiry.el);
    const error = h('div');
    const create = h('button', 'btn primary', 'Create link');
    create.type = 'button';
    create.addEventListener('click', async () => {
      const code = pass.value.trim();
      if (code && code.length < 4) {
        pass.setAttribute('aria-invalid', 'true');
        error.replaceChildren(this.banner('bad', 'A passcode needs at least 4 characters.'));
        return;
      }
      create.disabled = true;
      try {
        this.created = await this.hub.createGuestLink({ expiresInHours: Number(this.hours), ...(code ? { passcode: code } : {}), ...(this.onlyView && view ? { view: view.id } : {}) });
        this.info = await this.hub.share();
        this.render();
      } catch (err) {
        error.replaceChildren(this.banner('bad', err instanceof HubError || err instanceof Error ? err.message : 'That did not work.'));
        create.disabled = false;
      }
    });
    const form = h('div', 'v-share-form');
    form.append(switchRow(view ? `Only ${view.title}` : 'Only this view', 'Leave off to share every view', this.onlyView, (on) => (this.onlyView = on)), passRow, expiryRow, error, create);
    out.push(form);
    if (info.guestLinks.length) {
      const list = h('div', 'v-share-links');
      list.appendChild(h('div', 'caps', 'Active links'));
      for (const l of info.guestLinks) list.appendChild(this.linkRow(l));
      out.push(list);
    }
    return out;
  }

  private linkRow(l: GuestLink): HTMLElement {
    const row = h('div', 'v-share-link');
    const words = h('span', 'v-share-link-words');
    const what = l.viewId ? `Only ${this.views().find((v) => v.id === l.viewId)?.title ?? l.viewId}` : 'Every view';
    const ends = new Date(l.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    words.append(h('b', undefined, `${what}${l.passcode ? ', with passcode' : ''}`), h('span', undefined, `${l.opens} ${l.opens === 1 ? 'open' : 'opens'}, ends ${ends}`));
    const revoke = h('button', 'btn sm ghost v-revoke', 'Revoke');
    revoke.type = 'button';
    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      try {
        await this.hub.revokeGuestLink(l.id);
        this.info = await this.hub.share();
        this.render();
      } catch {
        revoke.disabled = false;
      }
    });
    row.append(words, revoke);
    return row;
  }

  private embedTab(): HTMLElement[] {
    const view = this.current();
    if (!view) return [h('p', 'f-hint', 'Open a view to embed it.')];
    const snippet = `<iframe src="${this.info!.embedBase}/${encodeURIComponent(view.id)}" width="100%" height="520" loading="lazy" title="${view.title.replace(/"/g, '&quot;')}"></iframe>`;
    const pre = h('pre', 'v-share-code', snippet);
    const row = h('div', 'v-share-acts');
    row.append(copyButton(() => snippet, 'Copy code'));
    return [h('p', 'v-share-lede', `Put ${view.title} on a wiki page, a README or a dashboard. It follows the latest version.`), pre, row, this.banner('warn', this.info!.guestLinksOnHub ? 'Readers need access to this workspace. For anyone else, send a guest link.' : 'Readers need access to this workspace. To show it to anyone else, export a copy.')];
  }

  private peopleTab(): HTMLElement[] {
    const ws = this.info!.workspace;
    const a = h('a', 'btn', 'See who has access');
    a.href = ws.url;
    const lede = ws.kind === 'personal' ? `This lives in ${ws.name}, a personal workspace. Move it to a team workspace to edit it together.` : `Everyone with a role in ${ws.name} can open this. Authors there can change it.`;
    const row = h('div', 'v-share-acts');
    row.appendChild(a);
    return [h('p', 'v-share-lede', lede), row];
  }
}
