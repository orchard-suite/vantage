/** Tiny element builder shared by the viewer modules. */
import { icon, type IconName } from './icons.ts';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function button(label: string, fn: () => void, title?: string, cls = 'v-btn'): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  b.addEventListener('click', fn);
  return b;
}

/** A button drawn as an icon, with an optional visible label after it; the title names it for pointer and screen reader alike. */
export function iconButton(name: IconName, title: string, fn: () => void, cls = 'v-btn v-icon-btn', label?: string): HTMLButtonElement {
  const b = h('button', cls);
  b.type = 'button';
  b.title = title;
  b.appendChild(icon(name));
  if (label) b.appendChild(h('span', 'v-btn-label', label));
  else b.setAttribute('aria-label', title);
  b.addEventListener('click', fn);
  return b;
}

/** Saves an SVG element as a file the browser downloads; open item badges stay only when the view asks exports to keep them. */
export function downloadSvg(svg: SVGSVGElement, name: string, keepOpenItems = false): void {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  if (!keepOpenItems) for (const g of copy.querySelectorAll('.v-open')) g.remove();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([copy.outerHTML], { type: 'image/svg+xml' }));
  a.download = name;
  a.click();
}
