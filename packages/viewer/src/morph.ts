/**
 * View transitions. Boxes that exist in both views slide from their old
 * place to the new one; everything else fades. Because ids are stable
 * across views the reader keeps their bearings. A box drawn more than once
 * in either view (a page repeats a box in several panels) has no single
 * place to slide from or to, so it fades like a new one.
 */
import type { BundleView } from './bundle.ts';

export function morph(stage: HTMLElement, prev: BundleView | undefined, next: BundleView, prevSvg: SVGSVGElement | undefined): SVGSVGElement {
  const holder = document.createElement('div');
  holder.innerHTML = next.svg;
  const svg = holder.firstElementChild as SVGSVGElement;
  const old = uniqueBoxes(prev?.boxes ?? []);
  const fresh = uniqueBoxes(next.boxes);
  // CSS transform replaces the attribute transform on SVG elements, so both ends are written as full positions.
  const moving: { el: SVGGElement; from: string; to: string }[] = [];
  if (prevSvg && prev) {
    for (const el of svg.querySelectorAll<SVGGElement>('.v-box')) {
      const id = el.dataset['id']!;
      const o = old.get(id);
      const n = fresh.get(id);
      if (o && n) moving.push({ el, from: `translate(${o.x}px,${o.y}px)`, to: `translate(${n.x}px,${n.y}px)` });
      else el.style.opacity = '0';
    }
    for (const el of svg.querySelectorAll<SVGGElement>('.v-edge')) el.style.opacity = '0';
    for (const m of moving) {
      m.el.style.transition = 'none';
      m.el.style.transform = m.from;
    }
  }
  stage.replaceChildren(svg);
  if (prevSvg && prev) {
    void svg.getBoundingClientRect();
    requestAnimationFrame(() => {
      for (const m of moving) {
        m.el.style.transition = '';
        m.el.style.transform = m.to;
      }
      for (const el of svg.querySelectorAll<SVGGElement>('.v-box, .v-edge')) el.style.opacity = '';
    });
  }
  return svg;
}

/** Boxes by id, leaving out every id drawn more than once. */
export function uniqueBoxes<B extends { readonly id: string }>(boxes: readonly B[]): Map<string, B> {
  const seen = new Map<string, B>();
  const repeated = new Set<string>();
  for (const b of boxes) {
    if (seen.has(b.id)) repeated.add(b.id);
    else seen.set(b.id, b);
  }
  for (const id of repeated) seen.delete(id);
  return seen;
}
