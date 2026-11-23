/**
 * Taps on the picture. On a touch screen a box or badge drawn smaller than
 * a fingertip cannot be hit with intent: the tap zooms in on the spot, and
 * the next tap, on a target now big enough, acts. Story badges jump to
 * their step.
 */
import { activateOnKey } from './a11y.ts';
import type { PanZoom } from './panzoom.ts';

/** The smallest on-screen size a finger hits with intent, in CSS pixels. */
export const TAP_TARGET = 24;

/** Zooms in on a tap that landed on a target too small to mean; true when it did, so the tap does nothing else. */
export function zoomInstead(panzoom: PanZoom, el: Element, e: MouseEvent): boolean {
  if (!matchMedia('(pointer: coarse)').matches) return false;
  const r = el.getBoundingClientRect();
  if (Math.min(r.width, r.height) >= TAP_TARGET) return false;
  const c = panzoom.canvasRect();
  panzoom.zoomAt(e.clientX - c.left, e.clientY - c.top, 2, true);
  return true;
}

/** Each numbered story badge jumps to its step on a click, a key, or a tap big enough to mean it. */
export function wireStepBadges(svg: SVGSVGElement, panzoom: PanZoom, jump: (badgeId: string) => void): void {
  for (const el of svg.querySelectorAll<SVGGElement>('.v-badge-step')) {
    const go = (): void => jump(el.dataset['id']!);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!zoomInstead(panzoom, el, e)) go();
    });
    activateOnKey(el, go);
  }
}
