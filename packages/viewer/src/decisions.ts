/**
 * Decision records on a hub: which records govern each box (linked on the
 * record, or cited by the box's YAML), a badge with the count at the top
 * left of every such box, a Decisions section in the box's panel, and
 * links for the records a doc page cites. Each points at the record's page
 * on the hub.
 */
import type { BundleBox, BundleView } from './bundle.ts';
import { button, h } from './dom.ts';
import { icon } from './icons.ts';
import type { HubDecision } from './hub.ts';

export interface DecisionsHost {
  readonly select: (box: string) => void;
}

const STATUS: Record<HubDecision['status'], string> = { proposed: 'Proposed', accepted: 'Accepted', deprecated: 'Deprecated', superseded: 'Superseded' };

export class Decisions {
  private byId = new Map<string, HubDecision>();
  private cited: Readonly<Record<string, string>> = {};

  constructor(private readonly host: DecisionsHost) {}

  set(decisions: readonly HubDecision[], cited: Readonly<Record<string, string>>): void {
    this.byId = new Map(decisions.map((d) => [d.id, d]));
    this.cited = cited;
  }

  /** The records that govern a box: linked to it, or cited by it, each once, by citation. */
  forBox(b: BundleBox): HubDecision[] {
    const out = new Map<string, HubDecision>();
    for (const d of this.byId.values()) if (d.boxes.includes(b.id)) out.set(d.id, d);
    for (const ref of b.decisions ?? []) {
      const d = this.byId.get(this.cited[ref] ?? '');
      if (d) out.set(d.id, d);
    }
    return [...out.values()].sort((a, c) => a.ref.localeCompare(c.ref));
  }

  /** A record for a citation as written, when the reader may open it. */
  forRef(ref: string): HubDecision | undefined {
    return this.byId.get(this.cited[ref] ?? '');
  }

  paint(stage: HTMLElement | null, view: BundleView | undefined, drawn: BundleView | undefined): void {
    if (!stage) return;
    stage.querySelector(':scope > .v-dec-layer')?.remove();
    if (!view || !drawn || view.kind === 'doc') return;
    const layer = h('div', 'v-dec-layer');
    for (const b of drawn.boxes) {
      const list = this.forBox(b);
      if (!list.length) continue;
      const badge = button('', () => this.host.select(b.id), undefined, 'v-dec-badge');
      badge.title = list.map((d) => `${d.ref} ${d.title}`).join('\n');
      badge.setAttribute('aria-label', `${list.length} decision${list.length === 1 ? '' : 's'} govern ${b.name}`);
      badge.style.left = `${b.x}px`;
      badge.style.top = `${b.y}px`;
      badge.append(icon('doc', 12), document.createTextNode(String(list.length)));
      layer.appendChild(badge);
    }
    if (layer.childElementCount) stage.appendChild(layer);
  }

  /** The panel's Decisions section for a box, or nothing when no record governs it. */
  section(host: HTMLElement, b: BundleBox): void {
    const list = this.forBox(b);
    if (!list.length) return;
    const s = h('section', 'v-sec');
    const head = h('h4', 'v-sec-h', 'Decisions');
    head.appendChild(h('span', 'n', String(list.length)));
    s.appendChild(head);
    const ul = h('ul', 'v-decs');
    for (const d of list) {
      const li = h('li', d.status === 'superseded' || d.status === 'deprecated' ? 'gone' : undefined);
      const a = h('a', 'v-dec');
      a.href = d.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.append(h('span', 'v-dec-ref', d.ref), h('span', 'v-dec-title', d.title), h('span', 'v-dec-status', STATUS[d.status]));
      li.appendChild(a);
      ul.appendChild(li);
    }
    s.appendChild(ul);
    host.appendChild(s);
  }

  /** Turns the citations on a doc page into links to their records; one the reader cannot open stays plain text. */
  link(root: ParentNode): void {
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a.v-decision[data-decision]')) {
      const d = this.forRef(a.dataset['decision'] ?? '');
      if (!d) continue;
      a.href = d.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = `${d.ref} ${d.title} (${STATUS[d.status]})`;
    }
  }
}
