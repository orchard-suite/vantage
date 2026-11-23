/**
 * Hover and focus. Hover lights up a box, its edges, and its neighbours.
 * Focus (click) keeps only what can reach or be reached from the box, the
 * way Ilograph dims the rest, and is cleared with Escape or a canvas click.
 * A container stands for everything inside it: its children stay lit, and
 * their edges count as its edges, so the reader can move the pointer inward.
 */
import type { BundleView } from './bundle.ts';

export class Highlighter {
  private svg: SVGSVGElement | undefined;
  private view: BundleView | undefined;
  private focused: string | undefined;
  private pinned: Set<string> | undefined;
  /** Boxes inside the hovered or focused container: left as they are, neither dimmed nor marked. */
  private quiet = new Set<string>();

  attach(svg: SVGSVGElement, view: BundleView): void {
    this.svg = svg;
    this.view = view;
    this.focused = undefined;
    if (this.pinned) this.applyPinned();
  }

  /** Walkthrough steps pin a highlight set until cleared. */
  pin(ids: readonly string[] | undefined): void {
    this.pinned = ids && ids.length ? new Set(ids) : undefined;
    this.applyPinned();
  }

  hover(id: string | undefined, isEdge = false): void {
    if (this.focused || this.pinned) return;
    if (!id) return this.clear();
    this.quiet = isEdge ? new Set() : this.inside(id);
    this.light(this.neighbourhood(id, isEdge), false);
  }

  focus(id: string | undefined): void {
    this.focused = id;
    if (!id) return this.applyPinned();
    this.quiet = this.inside(id);
    this.light(this.reachable(id), true);
  }

  get focusedId(): string | undefined {
    return this.focused;
  }

  private applyPinned(): void {
    this.quiet = new Set();
    if (!this.pinned) return this.clear();
    const set = new Set<string>();
    for (const id of this.pinned) {
      set.add(id);
      for (const e of this.view?.edges ?? []) if (e.id === id || (this.pinned.has(e.from) && this.pinned.has(e.to))) set.add(e.id);
    }
    this.light(set, true);
  }

  /** Everything inside a box: its boxes and the edges between them, not the box itself. */
  private inside(id: string): Set<string> {
    const f = this.family(id);
    f.delete(id);
    for (const e of this.view?.edges ?? []) if (f.has(e.from) && f.has(e.to)) f.add(e.id);
    return f;
  }

  /** A box and every box inside it. */
  private family(id: string): Set<string> {
    const boxes = this.view?.boxes ?? [];
    const set = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of boxes) {
        if (b.parentId !== undefined && set.has(b.parentId) && !set.has(b.id)) {
          set.add(b.id);
          grew = true;
        }
      }
    }
    return set;
  }

  private neighbourhood(id: string, isEdge: boolean): Set<string> {
    const inside = isEdge ? new Set<string>([id]) : this.family(id);
    const set = new Set<string>([id]);
    // For a container only the edges that cross its boundary count; the ones inside stay as they are.
    for (const e of this.view?.edges ?? []) {
      if (isEdge ? e.id === id : inside.has(e.from) !== inside.has(e.to)) {
        set.add(e.id);
        set.add(e.from);
        set.add(e.to);
      }
    }
    return set;
  }

  private reachable(id: string): Set<string> {
    const edges = this.view?.edges ?? [];
    const set = this.family(id);
    const walk = (start: string, dir: 'out' | 'in'): void => {
      const stack = [start];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const e of edges) {
          const next = dir === 'out' ? (e.from === cur ? e.to : undefined) : e.to === cur ? e.from : undefined;
          if (next === undefined) continue;
          set.add(e.id);
          set.add(next);
          stack.push(next);
        }
      }
    };
    for (const start of [...set]) {
      walk(start, 'out');
      walk(start, 'in');
    }
    return set;
  }

  private light(keep: Set<string>, strong: boolean): void {
    if (!this.svg) return;
    const ancestors = new Set<string>();
    const boxes = new Map((this.view?.boxes ?? []).map((b) => [b.id, b]));
    for (const id of keep) {
      let p = boxes.get(id)?.parentId;
      while (p !== undefined) {
        ancestors.add(p);
        p = boxes.get(p)?.parentId;
      }
    }
    for (const el of this.svg.querySelectorAll<SVGElement>('.v-box, .v-edge')) {
      const id = el.dataset['id']!;
      const on = keep.has(id);
      const edge = el.classList.contains('v-edge');
      // A box inside the hovered container is marked only when an edge in the set touches it.
      const touched = !this.quiet.has(id) || (!edge && (this.view?.edges ?? []).some((e) => keep.has(e.id) && !this.quiet.has(e.id) && (e.from === id || e.to === id)));
      el.classList.toggle('hi', on && touched && (strong || edge || id !== this.focused));
      el.classList.toggle('dim', !on && !ancestors.has(id) && !this.quiet.has(id));
    }
    // Path badges follow the strong states only; a hover should not blank the numbering.
    for (const el of this.svg.querySelectorAll<SVGElement>('.v-badge-step')) {
      const on = keep.has(el.dataset['id']!);
      el.classList.toggle('hi', strong && on);
      el.classList.toggle('dim', strong && !on);
    }
  }

  clear(): void {
    this.quiet = new Set();
    if (!this.svg) return;
    for (const el of this.svg.querySelectorAll('.hi, .dim')) el.classList.remove('hi', 'dim');
  }
}
