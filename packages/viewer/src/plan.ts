/**
 * The plan on the picture (docs/decisions/3009): the boxes a roadmap item
 * adds, changes, or retires, drawn as planned on the real view with no hand
 * styling. A switch shows the system today or after a horizon: today, a box
 * still to be added is a dashed ghost and a box still to be retired stands;
 * after a horizon, every item due by then has landed. A box is real again
 * the moment its item's proof ships it. A page that names an item
 * (`[[item:VAN-12]]`) shows its live state to a reader who may see it.
 */
import type { BundleBox, BundleView } from './bundle.ts';
import { button, h } from './dom.ts';
import type { HubPlanItem } from './hub.ts';

export const HORIZONS = ['today', 'now', 'next', 'later'] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface PlanHost {
  readonly select: (box: string) => void;
}

const rank = (h: string | null): number => (h === 'now' ? 1 : h === 'next' ? 2 : h === 'later' ? 3 : 4);

export class Plan {
  private items: readonly HubPlanItem[] = [];
  private states = new Map<string, { readonly state: string; readonly class: string; readonly title: string; readonly url: string }>();
  private horizon: Horizon = 'today';

  constructor(private readonly host: PlanHost) {}

  private lifecycle: { readonly view: string; readonly prefix: string; readonly counts: Readonly<Record<string, number>> } | undefined;

  set(items: readonly HubPlanItem[], lifecycle?: { view: string; prefix: string; counts: Record<string, number> }): void {
    this.items = items;
    this.lifecycle = lifecycle;
  }

  /** On a kind's lifecycle view, a live count on each state of the items the reader may see there. */
  private counts(layer: HTMLElement, view: BundleView, drawn: BundleView): boolean {
    const l = this.lifecycle;
    if (!l || view.id !== l.view) return false;
    for (const b of drawn.boxes) {
      const n = l.counts[b.id] ?? 0;
      const badge = h('span', `v-plan-count${n ? '' : ' none'}`, String(n));
      badge.title = `${n} ${l.prefix} item${n === 1 ? '' : 's'} in ${b.name}`;
      badge.style.left = `${b.x + b.w}px`;
      badge.style.top = `${b.y}px`;
      layer.appendChild(badge);
    }
    return true;
  }

  /** The live state of an item a page names, for the reader. */
  addState(key: string, s: { state: string; class: string; title: string; url: string }): void {
    this.states.set(key, s);
  }

  /** What the plan does to one box: the items that touch it, each with its effect. */
  forBox(id: string): { item: HubPlanItem; rel: 'adds' | 'changes' | 'retires' }[] {
    return this.items.flatMap((item) => item.effects.filter((e) => e.id === id).map((e) => ({ item, rel: e.rel })));
  }

  /** Whether an item has landed by the chosen horizon: shipped, or due by it. */
  private landed(item: HubPlanItem): boolean {
    if (item.class === 'done') return true;
    if (this.horizon === 'today') return false;
    return item.class !== 'parked' && rank(item.horizon) <= rank(this.horizon);
  }

  paint(stage: HTMLElement | null, view: BundleView | undefined, drawn: BundleView | undefined): void {
    if (!stage) return;
    stage.querySelector(':scope > .v-plan-layer')?.remove();
    // The switch belongs to the view, not the picture: it sits on the area around the canvas, so zooming never moves it over a box.
    const area = stage.parentElement?.parentElement ?? stage;
    area.querySelector(':scope > .v-plan-switch')?.remove();
    for (const g of stage.querySelectorAll<SVGGElement>('svg g.v-box.v-planned')) g.classList.remove('v-planned', 'v-ghost');
    if (!view || !drawn || view.kind === 'doc') return;
    const layer = h('div', 'v-plan-layer');
    if (this.counts(layer, view, drawn)) stage.appendChild(layer);
    if (!this.items.length) return;
    let any = false;
    for (const b of drawn.boxes) {
      const touches = this.forBox(b.id);
      if (!touches.length) continue;
      any = true;
      const g = stage.querySelector<SVGGElement>(`svg g.v-box[data-id="${CSS.escape(b.id)}"]`);
      // A box an item adds is a ghost until the item lands; one it retires is a ghost once it has.
      const ghost = touches.some((t) => (t.rel === 'adds' && !this.landed(t.item)) || (t.rel === 'retires' && this.landed(t.item)));
      g?.classList.add('v-planned');
      if (ghost) g?.classList.toggle('v-ghost', true);
      const frame = h('div', `v-plan-frame${touches.some((t) => t.rel === 'adds' && !this.landed(t.item)) ? ' add' : ''}${touches.some((t) => t.rel === 'retires') ? ' retire' : ''}`);
      frame.style.left = `${b.x}px`;
      frame.style.top = `${b.y}px`;
      frame.style.width = `${b.w}px`;
      frame.style.height = `${b.h}px`;
      layer.appendChild(frame);
      const badge = button('', () => this.host.select(b.id), undefined, 'v-plan-badge');
      const t = touches[0]!;
      const verb = t.rel === 'adds' ? (t.item.class === 'done' ? 'added by' : 'planned') : t.rel === 'retires' ? (t.item.class === 'done' ? 'retired by' : 'retiring') : t.item.class === 'done' ? 'changed by' : 'changing';
      badge.textContent = `${verb} ${t.item.key}${t.item.horizon && t.item.class !== 'done' ? ` · ${t.item.horizon}` : ''}${touches.length > 1 ? ` +${touches.length - 1}` : ''}`;
      badge.title = touches.map((x) => `${x.rel} · ${x.item.key} ${x.item.title} (${x.item.stateText})`).join('\n');
      badge.style.left = `${b.x + b.w}px`;
      badge.style.top = `${b.y}px`;
      layer.appendChild(badge);
    }
    if (!any) return;
    if (!layer.isConnected) stage.appendChild(layer);
    const sw = h('div', 'v-plan-switch');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Show the system');
    for (const hz of HORIZONS) {
      const b = button(hz === 'today' ? 'Today' : `After ${hz}`, () => {
        this.horizon = hz;
        this.paint(stage, view, drawn);
      });
      b.setAttribute('aria-pressed', String(this.horizon === hz));
      sw.appendChild(b);
    }
    area.appendChild(sw);
  }

  /** The panel's Plan section for a box: the items that add, change, or retire it. */
  section(host: HTMLElement, b: BundleBox, itemUrl: (item: HubPlanItem) => string): void {
    const touches = this.forBox(b.id);
    if (!touches.length) return;
    const s = h('section', 'v-sec');
    const head = h('h4', 'v-sec-h', 'Plan');
    head.appendChild(h('span', 'n', String(touches.length)));
    s.appendChild(head);
    const ul = h('ul', 'v-decs');
    for (const t of touches) {
      const a = h('a', 'v-dec');
      a.href = itemUrl(t.item);
      a.target = '_blank';
      a.rel = 'noopener';
      a.append(h('span', 'v-dec-ref', t.item.key), h('span', 'v-dec-title', `${t.rel} · ${t.item.title}`), h('span', 'v-dec-status', `${t.item.stateText}${t.item.horizon ? ` · ${t.item.horizon}` : ''}`));
      const li = h('li');
      li.appendChild(a);
      ul.appendChild(li);
    }
    s.appendChild(ul);
    host.appendChild(s);
  }

  /** Fills in the state of each item a page names, for a reader who may see it; the rest stay plain keys. */
  link(root: ParentNode): void {
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a.v-work-ref[data-item]')) {
      const key = a.dataset['item'] ?? '';
      const s = this.states.get(key);
      if (!a.textContent) a.textContent = key;
      if (!s || a.dataset['linked'] === '1') continue;
      a.dataset['linked'] = '1';
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = `${key} ${s.title}`;
      a.dataset['class'] = s.class;
      a.querySelector('.v-item-state')?.remove();
      a.appendChild(h('span', 'v-item-state', s.state));
    }
  }
}
