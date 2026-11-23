/**
 * Reactions on boxes, for review sessions. The Comments panel gets a bar
 * for the selected box (thumbs up, looks wrong, a question; each toggles,
 * and "looks wrong" asks for an optional sentence that goes in a comment)
 * and a summary of the view's most flagged boxes, orphaned ones marked.
 * The stage gets a small count badge on each box, who on hover. Badges
 * sit in a layer beside the picture, never in it, so no export carries them.
 */
import type { ViewerContext } from './app.ts';
import type { BundleView } from './bundle.ts';
import { button, h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { BoxReactions, ReactionKind } from './hub.ts';

export const KINDS: readonly { readonly kind: ReactionKind; readonly icon: IconName; readonly label: string }[] = [
  { kind: 'up', icon: 'thumb', label: 'Thumbs up' },
  { kind: 'wrong', icon: 'warn', label: 'Looks wrong' },
  { kind: 'question', icon: 'question', label: 'Question' },
];
const SUMMARY_ROWS = 5;

export interface ReactionsHost {
  /** Puts the reader's reaction on (with the sentence for "looks wrong") or takes it off. */
  readonly toggle: (view: string, box: string, kind: ReactionKind, on: boolean, text?: string) => Promise<void>;
  /** Selects a box on the stage. */
  readonly select: (box: string) => void;
}

/** The view's boxes with reactions, most flagged first: more "looks wrong", then questions, then all. */
export function flagged(list: readonly BoxReactions[], view: string): BoxReactions[] {
  return list
    .filter((r) => r.view === view && r.total > 0)
    .sort((a, b) => b.kinds.wrong.count - a.kinds.wrong.count || b.kinds.question.count - a.kinds.question.count || b.total - a.total || a.box.localeCompare(b.box));
}

/** Who reacted how, one line per kind, for a badge's hover. */
export function whoText(r: BoxReactions): string {
  return KINDS.filter((k) => r.kinds[k.kind].count)
    .map((k) => `${k.label}: ${r.kinds[k.kind].people.map((p) => p.label).join(', ')}`)
    .join('\n');
}

export class Reactions {
  private list: readonly BoxReactions[] = [];
  /** The box whose "looks wrong" sentence is being typed, and the sentence so far. */
  private asking: { box: string; text: string } | undefined;

  constructor(private readonly host: ReactionsHost) {}

  set(list: readonly BoxReactions[]): void {
    this.list = list;
  }

  /** The bar for the selected box and the view's summary, for the Comments panel. */
  section(ctx: ViewerContext): HTMLElement {
    const el = h('div', 'v-react');
    const view = ctx.view;
    if (!view) return el;
    if (ctx.node) el.appendChild(this.bar(view.id, ctx.node.id, ctx.node.name));
    const top = flagged(this.list, view.id);
    if (!top.length) return el;
    el.appendChild(h('h3', undefined, 'Most flagged'));
    const rows = h('ul', 'v-react-sum');
    for (const r of top.slice(0, SUMMARY_ROWS)) {
      const name = ctx.drawn?.boxes.find((b) => b.id === r.box)?.name ?? view.boxes.find((b) => b.id === r.box)?.name ?? r.box;
      const row = h('li', r.orphaned ? 'orphaned' : undefined);
      const label = r.orphaned ? h('span', 'v-react-name', name) : button(name, () => this.host.select(r.box), `Select ${name}`, 'v-link v-react-name');
      row.append(label, this.counts(r));
      if (r.orphaned) row.appendChild(h('span', 'v-muted v-react-gone', 'no longer in this view'));
      row.title = whoText(r);
      rows.appendChild(row);
    }
    el.appendChild(rows);
    return el;
  }

  /** Draws a count badge on each box of the view that has reactions, in a layer above the picture. */
  paint(stage: HTMLElement | null, view: BundleView | undefined, drawn: BundleView | undefined): void {
    if (!stage) return;
    stage.querySelector(':scope > .v-react-layer')?.remove();
    if (!view || !drawn) return;
    const layer = h('div', 'v-react-layer');
    for (const r of this.list) {
      if (r.view !== view.id || r.orphaned || !r.total) continue;
      const b = drawn.boxes.find((x) => x.id === r.box);
      if (!b) continue;
      const badge = button('', () => this.host.select(b.id), undefined, 'v-react-badge');
      badge.title = whoText(r);
      badge.setAttribute('aria-label', `Reactions on ${b.name}: ${KINDS.filter((k) => r.kinds[k.kind].count).map((k) => `${k.label} ${r.kinds[k.kind].count}`).join(', ')}`);
      badge.style.left = `${b.x + b.w}px`;
      badge.style.top = `${b.y}px`;
      badge.appendChild(this.counts(r));
      layer.appendChild(badge);
    }
    if (layer.childElementCount) stage.appendChild(layer);
  }

  private counts(r: BoxReactions): HTMLElement {
    const row = h('span', 'v-react-counts');
    for (const k of KINDS) {
      const n = r.kinds[k.kind].count;
      if (!n) continue;
      const seg = h('span', `v-react-n ${k.kind}`);
      seg.append(icon(k.icon, 12), document.createTextNode(String(n)));
      row.appendChild(seg);
    }
    return row;
  }

  private bar(view: string, box: string, name: string): HTMLElement {
    const r = this.list.find((x) => x.view === view && x.box === box);
    const root = h('div', 'v-react-wrap');
    const redraw = (): void => root.replaceWith(this.bar(view, box, name));
    const el = h('div', 'v-react-bar');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `React to ${name}`);
    for (const k of KINDS) {
      const tally = r?.kinds[k.kind];
      const mine = tally?.mine ?? false;
      const b = button('', () => {
        if (k.kind === 'wrong' && !mine) {
          this.asking = this.asking?.box === box ? undefined : { box, text: '' };
          return redraw();
        }
        b.disabled = true;
        void this.host.toggle(view, box, k.kind, !mine);
      }, mine ? `Take back ${k.label.toLowerCase()} on ${name}` : `${k.label} on ${name}`, `v-btn v-react-btn ${k.kind}`);
      b.setAttribute('aria-pressed', String(mine));
      b.append(icon(k.icon, 14), h('span', undefined, tally?.count ? String(tally.count) : ''));
      if (tally?.people.length) b.title = `${k.label}: ${tally.people.map((p) => p.label).join(', ')}`;
      el.appendChild(b);
    }
    root.appendChild(el);
    if (this.asking?.box !== box) return root;
    const form = h('div', 'v-react-ask');
    const input = h('input', 'v-text');
    input.placeholder = 'What looks wrong? (optional)';
    input.setAttribute('aria-label', `What looks wrong about ${name}, optional`);
    input.maxLength = 2000;
    input.value = this.asking.text;
    input.addEventListener('input', () => {
      if (this.asking) this.asking.text = input.value;
    });
    const send = (): void => {
      const said = input.value.trim();
      this.asking = undefined;
      void this.host.toggle(view, box, 'wrong', true, said || undefined);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.asking = undefined;
        redraw();
      }
    });
    form.append(input, button('Flag', send, `Flag ${name} as looking wrong and file a comment`, 'v-btn v-btn-primary'));
    root.appendChild(form);
    queueMicrotask(() => input.focus());
    return root;
  }
}
