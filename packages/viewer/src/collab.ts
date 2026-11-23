/**
 * Hub mode: the dock with the Steer, Comments, and History panels, the hub
 * client behind them, the box picker comments point with, the revise
 * section when the hub has a model API, reactions on boxes with their
 * badges on the stage, the decision records that govern boxes (a badge,
 * a panel section, and links on doc pages), and the live refresh that keeps the stage, the
 * selection, and the panels in step with saves and reactions from anywhere.
 */
import type { App, ViewerContext } from './app.ts';
import type { Bundle, BundleHub } from './bundle.ts';
import { button, h } from './dom.ts';
import { HubClient, HubError, type HubPerson, type ReactionKind } from './hub.ts';
import { Reactions } from './reactions.ts';
import { Decisions } from './decisions.ts';
import { Plan } from './plan.ts';
import { formatRoute } from './router.ts';
import { SteerPanel } from './steer.ts';
import { CommentsPanel } from './comments.ts';
import { HistoryPanel } from './history.ts';
import { Picker } from './pick.ts';
import { RevisePanel } from './revise.ts';
import type { SteerAction } from './steer-actions.ts';

const POLL_MS = 800;
const POLL_TRIES = 25;

export class Collab {
  private readonly client: HubClient;
  private readonly steer: SteerPanel;
  private readonly comments: CommentsPanel;
  private readonly history: HistoryPanel;
  private readonly picker: Picker;
  private readonly revise: RevisePanel;
  private readonly reactions: Reactions;
  private readonly decisions: Decisions;
  private readonly plan: Plan;
  private people: Promise<readonly HubPerson[]> | undefined;
  private readonly status: HTMLElement;
  private readonly bodies = new Map<string, HTMLElement>();
  private readonly tabs = new Map<string, HTMLButtonElement>();
  /** Versions this browser saved; a refresh to one of them is ours, any other is someone else's. */
  private readonly own = new Set<string>();

  constructor(
    private readonly app: App,
    bundle: Bundle & { readonly hub: BundleHub },
    /** Fetches the bundle and applies it when it is newer; resolves to what the hub returned. */
    private readonly refresh: () => Promise<Bundle>,
  ) {
    const hub = bundle.hub;
    const dock = app.dock!;
    this.client = new HubClient(hub);
    this.steer = new SteerPanel({ canEdit: hub.canEdit, send: (a) => this.send(a) });
    this.picker = new Picker({ stage: () => ({ svg: app.main.querySelector<SVGSVGElement>('.v-stage > svg') ?? undefined, view: app.context.drawn }), highlight: (ids) => app.highlight(ids), changed: () => this.comments.render(app.context) });
    app.picker = this.picker;
    this.reactions = new Reactions({ toggle: (v, b, k, on, text) => this.react(v, b, k, on, text), select: (box) => this.select(box) });
    this.decisions = new Decisions({ select: (box) => this.select(box) });
    this.plan = new Plan({ select: (box) => this.select(box) });
    // A page is drawn after the context changes; its item links are filled in as they appear.
    new MutationObserver(() => {
      if (!app.root.querySelector('a.v-work-ref[data-item]:not([data-linked])')) return;
      this.plan.link(app.root);
      void this.itemStates();
    }).observe(app.root, { childList: true, subtree: true });
    this.comments = new CommentsPanel({
      add: (v, t, text) => this.addComment(v, t, text),
      resolve: (id, r) => this.resolveComment(id, r),
      picker: this.picker,
      people: () => (this.people ??= this.client.people().then((r) => r.people)),
      reactions: this.reactions,
      ticked: () => this.revise.render(),
    });
    this.revise = new RevisePanel({
      client: this.client,
      ticked: () => this.comments.ticked(),
      view: () => app.context.view,
      saved: async (v) => {
        this.own.add(v);
        this.say('Saved the revision. Rendering.');
        await this.refreshComments();
        await this.awaitVersion(v);
      },
      say: (text, tone) => this.say(text, tone),
    });
    this.history = new HistoryPanel({
      canEdit: hub.canEdit,
      restore: (v) => this.restore(v),
      diffSvgUrl: (a, b, view, theme) => this.client.diffSvgUrl(a, b, view, theme),
      diffChanges: async (a, b, view) => (await this.client.diffChanges(a, b, view)).changes,
    });
    const tabs = h('div', 'v-tabs');
    tabs.setAttribute('role', 'tablist');
    const panels: [string, HTMLElement][] = hub.canEdit ? [['Comments', this.comments.el], ['Steer', this.steer.el], ['History', this.history.el]] : [['Comments', this.comments.el], ['History', this.history.el]];
    for (const [name, el] of panels) {
      const tab = button(name, () => this.show(name), undefined, 'v-tab');
      tab.setAttribute('role', 'tab');
      tab.id = `v-tab-${name.toLowerCase()}`;
      el.id = `v-pane-${name.toLowerCase()}`;
      tab.setAttribute('aria-controls', el.id);
      el.setAttribute('aria-labelledby', tab.id);
      tabs.appendChild(tab);
      this.tabs.set(name, tab);
      el.classList.add('v-dock-body');
      el.setAttribute('role', 'tabpanel');
      this.bodies.set(name, el);
    }
    this.status = h('div', 'v-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    tabs.setAttribute('aria-label', 'Collaborate');
    const bar = h('div', 'v-tabs-bar');
    bar.append(tabs, app.dockClose);
    dock.append(bar, ...panels.map(([, el]) => el), this.status);
    app.main.append(this.history.overlay, this.revise.overlay);
    this.show(panels[0]![0]);
    app.onContext = (ctx) => this.onContext(ctx);
    this.onContext(app.context);
    void this.refreshComments();
    void this.refreshHistory();
    void this.refreshReactions();
    void this.refreshDecisions(bundle);
    void this.refreshPlan();
    if (hub.canEdit) void this.loadRevise();
    // A new picture replaces the stage's children; the badges go back on it.
    const stage = this.stage();
    // Only a new picture counts: the badge layer is the stage's child too, and painting it must not paint again.
    if (stage) new MutationObserver((records) => records.some((r) => [...r.addedNodes].some((n) => n instanceof SVGSVGElement)) && this.paint()).observe(stage, { childList: true });
  }

  /** Takes a live message about reactions; answers false for one the bundle refresh handles. */
  live(data: string): boolean {
    let msg: { reactions?: unknown };
    try {
      msg = JSON.parse(data) as { reactions?: unknown };
    } catch {
      return false;
    }
    if (msg.reactions !== true) return false;
    void this.refreshReactions();
    void this.refreshComments();
    return true;
  }

  private select(box: string): void {
    const view = this.app.context.view?.id;
    if (view) location.hash = formatRoute({ view, node: box });
  }

  private stage(): HTMLElement | null {
    return this.app.main.querySelector<HTMLElement>('.v-stage');
  }

  private paint(): void {
    const stage = this.stage();
    if (stage?.querySelector(':scope > svg')) {
      this.reactions.paint(stage, this.app.context.view, this.app.context.drawn);
      this.decisions.paint(stage, this.app.context.view, this.app.context.drawn);
      this.plan.paint(stage, this.app.context.view, this.app.context.drawn);
    }
  }

  /** The items that plan changes to this document's boxes, and the state of every item its pages name. A reader the hub refuses simply sees none. */
  private async refreshPlan(): Promise<void> {
    try {
      const r = await this.client.plan();
      this.plan.set(r.items, r.lifecycle);
      this.asked.clear();
      this.paint();
      this.fillPanel(this.app.context);
    } catch {
      this.plan.set([]);
    }
  }

  /** The item keys a shown page names that the viewer has not asked about yet. */
  private readonly asked = new Set<string>();

  /** Asks the hub, as the reader, for the state of each item a shown page names, then links them. */
  private async itemStates(): Promise<void> {
    const keys = [...new Set([...this.app.root.querySelectorAll<HTMLElement>('a.v-work-ref[data-item]')].map((a) => a.dataset['item'] ?? ''))].filter((k) => k && !this.asked.has(k));
    if (!keys.length) return;
    for (const k of keys) this.asked.add(k);
    try {
      const r = await this.client.items(keys);
      // An item's page is found from any workspace's path: the hub sends the reader on to the one that holds it.
      for (const x of r.items) if ('card' in x) this.plan.addState(x.card.key, { state: x.card.stateText, class: x.card.class, title: x.card.title, url: this.client.itemUrl('~', x.card.key) });
      this.plan.link(this.app.root);
    void this.itemStates();
    } catch {
      // A reader the hub refuses sees plain keys.
    }
  }

  /** The records that govern the document's boxes, and the ones its boxes and pages cite. A reader the hub refuses (a guest) simply sees none. */
  private async refreshDecisions(bundle: Bundle): Promise<void> {
    const cite = new Set<string>();
    for (const v of bundle.views) {
      for (const b of v.boxes) for (const d of b.decisions ?? []) cite.add(d);
      for (const d of v.doc?.decisions ?? []) cite.add(d);
    }
    try {
      const r = await this.client.decisions([...cite]);
      this.decisions.set(r.decisions, r.cited);
      this.paint();
      this.fillPanel(this.app.context);
    } catch {
      this.decisions.set([], {});
    }
  }

  /** Puts the hub's part of the box panel in its slot, and links the citations on a doc page. */
  private fillPanel(ctx: ViewerContext): void {
    const slot = this.app.root.querySelector<HTMLElement>('.v-panel .v-panel-hub');
    if (slot && ctx.node) {
      slot.replaceChildren();
      this.decisions.section(slot, ctx.node);
      this.plan.section(slot, ctx.node, (item) => this.client.itemUrl(item.workspace, item.key));
    }
    this.decisions.link(this.app.root);
    this.plan.link(this.app.root);
  }

  private async refreshReactions(): Promise<void> {
    try {
      this.reactions.set((await this.client.reactions()).reactions);
      this.paint();
      this.comments.render(this.app.context);
    } catch (err) {
      this.say(`Reactions could not be loaded: ${(err as Error).message}`, 'error');
    }
  }

  private async react(view: string, box: string, kind: ReactionKind, on: boolean, text?: string): Promise<void> {
    try {
      if (on) await this.client.addReaction(view, box, kind, text);
      else await this.client.removeReaction(view, box, kind);
      await this.refreshReactions();
      if (on && kind === 'wrong') await this.refreshComments();
    } catch (err) {
      this.say((err as Error).message, 'error');
      this.comments.render(this.app.context);
    }
  }

  /** Puts the revise section under the comments when this hub revises for this reader. */
  private async loadRevise(): Promise<void> {
    try {
      if (await this.revise.load()) this.comments.attachRevise(this.revise.el);
    } catch (err) {
      this.say(`Revisions could not be loaded: ${(err as Error).message}`, 'error');
    }
  }

  /** Called after any bundle refresh; notices a head that moved and says whose save it was. */
  onBundle(bundle: Bundle): void {
    const v = bundle.hub?.version;
    if (!v || v === this.client.version) return;
    this.client.version = v;
    if (this.own.has(v)) this.say('Saved and rendered.');
    else this.say('Updated by someone else. The view refreshed; your selection is kept.', 'warn');
    void this.refreshHistory();
    void this.refreshDecisions(bundle);
    void this.refreshPlan();
  }

  private onContext(ctx: ViewerContext): void {
    this.picker.refresh();
    this.steer.render(ctx);
    this.comments.render(ctx);
    this.paint();
    this.fillPanel(ctx);
    this.history.render(ctx);
    this.revise.render();
  }

  private show(name: string): void {
    for (const [n, el] of this.bodies) el.classList.toggle('show', n === name);
    for (const [n, tab] of this.tabs) {
      tab.classList.toggle('active', n === name);
      tab.setAttribute('aria-selected', String(n === name));
    }
  }

  private say(text: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
    this.status.textContent = text;
    this.status.className = `v-status ${tone}`;
  }

  private async send(action: SteerAction): Promise<void> {
    try {
      const r = await this.client.steer(action);
      if (r.status === 'unchanged') return this.say('Nothing to change.');
      this.own.add(r.version.id);
      this.say(`Saved: ${r.message ?? r.version.message}. Rendering.`);
      await this.awaitVersion(r.version.id);
    } catch (err) {
      await this.failed(err);
    }
  }

  private async restore(version: string): Promise<void> {
    try {
      const r = await this.client.restore(version);
      if (r.status === 'unchanged') return this.say('That version is already the head.');
      this.own.add(r.version.id);
      this.say('Restored. Rendering.');
      await this.awaitVersion(r.version.id);
    } catch (err) {
      await this.failed(err);
    }
  }

  private async failed(err: unknown): Promise<void> {
    if (err instanceof HubError && err.status === 409) {
      this.say('The document changed since this view loaded. Reloading.', 'warn');
      await this.refresh();
      return;
    }
    this.say(err instanceof Error ? err.message : 'The save failed.', 'error');
  }

  /** Polls the bundle until the render of `id` is served; the SSE reload usually wins the race. */
  private async awaitVersion(id: string): Promise<void> {
    for (let i = 0; i < POLL_TRIES && this.client.version !== id; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (this.client.version === id) break;
      await this.refresh();
    }
    if (this.client.version !== id) this.say('Saved. The picture is still rendering; it will appear when ready.', 'warn');
  }

  private async refreshComments(): Promise<void> {
    try {
      const { comments, counts } = await this.client.comments();
      this.comments.setComments(comments);
      this.revise.render();
      this.app.setBadges(counts.byView, counts.total);
    } catch (err) {
      this.say(`Comments could not be loaded: ${(err as Error).message}`, 'error');
    }
  }

  private async refreshHistory(): Promise<void> {
    try {
      const { head, versions } = await this.client.versions();
      this.history.setVersions(head, versions);
    } catch (err) {
      this.say(`History could not be loaded: ${(err as Error).message}`, 'error');
    }
  }

  private async addComment(view: string, targets: readonly string[], text: string): Promise<void> {
    try {
      await this.client.addComment(view, targets, text);
      await this.refreshComments();
    } catch (err) {
      this.say((err as Error).message, 'error');
    }
  }

  private async resolveComment(id: string, resolved: boolean): Promise<void> {
    try {
      await this.client.resolveComment(id, resolved);
      await this.refreshComments();
    } catch (err) {
      this.say((err as Error).message, 'error');
    }
  }
}
