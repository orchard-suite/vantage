/** Keyboard and screen reader wiring: roles, labels, and key handlers for the SVG and the picker. */
import type { BundleView } from './bundle.ts';

export function labelSvg(svg: SVGSVGElement, view: BundleView): void {
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', view.title);
  const name = (id: string): string => view.boxes.find((b) => b.id === id)?.name ?? id;
  for (const el of svg.querySelectorAll<SVGGElement>('.v-box')) {
    const b = view.boxes.find((x) => x.id === el.dataset['id']);
    if (!b) continue;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    const parts = [b.name, b.subtitle, b.kind === 'collapsed' ? 'collapsed' : b.kind === 'container' ? 'container' : undefined];
    el.setAttribute('aria-label', parts.filter(Boolean).join(', '));
  }
  for (const el of svg.querySelectorAll<SVGGElement>('.v-edge')) {
    const e = view.edges.find((x) => x.id === el.dataset['id']);
    if (!e) continue;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${name(e.from)} to ${name(e.to)}${e.label ? `: ${e.label}` : ''}`);
  }
  for (const el of svg.querySelectorAll<SVGGElement>('.v-badge-step')) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Step ${el.textContent?.trim() ?? ''}`);
  }
}

/** Enter and Space act like a click on focusable SVG groups. */
export function activateOnKey(el: Element, fn: () => void): void {
  el.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      fn();
    }
  });
}

/** Picker items are links; the arrows move between them, as they would in a menu, and Enter follows them. */
export function wirePicker(picker: HTMLElement): void {
  picker.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains('v-item') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...picker.querySelectorAll<HTMLElement>('.v-item')].filter((x) => x.offsetParent !== null);
    const i = items.indexOf(t);
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  });
}
