/** The hover tip over the stage: one element, placed above its target, or below when there is no room. */
import type { BundleView } from './bundle.ts';
import { h } from './dom.ts';
import type { Highlighter } from './highlight.ts';

export class Tip {
  readonly el: HTMLElement;

  constructor(private readonly area: HTMLElement) {
    this.el = h('div', 'v-tip');
    this.el.setAttribute('role', 'tooltip');
    area.appendChild(this.el);
  }

  show(target: Element, text: string): void {
    this.el.textContent = text;
    this.el.classList.add('show');
    const r = target.getBoundingClientRect();
    const m = this.area.getBoundingClientRect();
    const left = r.left - m.left + r.width / 2 - this.el.offsetWidth / 2;
    const above = r.top - m.top - this.el.offsetHeight - 8;
    this.el.style.left = `${Math.max(8, Math.min(m.width - this.el.offsetWidth - 8, left))}px`;
    this.el.style.top = `${above < 8 ? r.bottom - m.top + 8 : above}px`;
  }

  hide(): void {
    this.el.classList.remove('show');
  }
}

/** Every arrow of a picture lights up on hover or focus and shows its label, its description, and the relations it bundles. */
export function wireEdgeTips(svg: SVGSVGElement, view: BundleView, hl: Highlighter, tip: Tip): void {
  for (const el of svg.querySelectorAll<SVGGElement>('.v-edge')) {
    const id = el.dataset['id']!;
    const edge = view.edges.find((x) => x.id === id);
    const text = edge ? `${edge.label ?? ''}${edge.description ? `\n${edge.description}` : ''}${edge.members.length > 1 ? `\n${edge.members.map((m) => m.replace('>', ' → ')).join('\n')}` : ''}`.trim() : '';
    const enter = (): void => {
      hl.hover(id, true);
      if (text) tip.show(el, text);
    };
    const leave = (): void => {
      hl.hover(undefined);
      tip.hide();
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    el.addEventListener('focus', enter);
    el.addEventListener('blur', leave);
  }
}
