/**
 * Picking boxes on the stage for a comment. While picking is on, a click on
 * a box adds it or takes it out, and a click anywhere else adds the box
 * nearest the spot: a comment points at the things on the diagram, never at
 * a place, because the layout moves after every edit. Escape stops picking.
 */
import type { BundleBox, BundleView } from './bundle.ts';

/** What the stage asks before its own click and Escape handling; true means the picker took the event. */
export interface StagePick {
  box(id: string): boolean;
  spot(clientX: number, clientY: number): boolean;
  escape(): boolean;
}

export interface PickerHost {
  /** The picture on the stage and the view laid out in it. */
  readonly stage: () => { svg: SVGSVGElement | undefined; view: BundleView | undefined };
  readonly highlight: (ids: readonly string[] | undefined) => void;
  readonly changed: () => void;
}

export class Picker implements StagePick {
  private on = false;
  private picked: string[] = [];
  /** Whether this picker pinned boxes last, so it unpins only its own and leaves a walkthrough's alone. */
  private lit = false;

  constructor(private readonly host: PickerHost) {}

  get active(): boolean {
    return this.on;
  }

  get ids(): readonly string[] {
    return this.picked;
  }

  toggle(): void {
    this.on = !this.on;
    this.show();
  }

  /** Empties the pick and stops picking; after a comment is posted. */
  clear(): void {
    this.on = false;
    this.picked = [];
    this.show();
  }

  remove(id: string): void {
    this.picked = this.picked.filter((x) => x !== id);
    this.show();
  }

  box(id: string): boolean {
    if (!this.on) return false;
    this.picked = this.picked.includes(id) ? this.picked.filter((x) => x !== id) : [...this.picked, id];
    this.show();
    return true;
  }

  spot(clientX: number, clientY: number): boolean {
    if (!this.on) return false;
    const { svg, view } = this.host.stage();
    const ctm = svg?.getScreenCTM();
    if (!svg || !view || !ctm) return true;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const id = nearestBox(view.boxes, p.x, p.y);
    if (id && !this.picked.includes(id)) this.picked = [...this.picked, id];
    this.show();
    return true;
  }

  escape(): boolean {
    if (!this.on) return false;
    this.toggle();
    return true;
  }

  /** Lights the picked boxes again, after the stage drew a new picture or a peek ended. */
  refresh(): void {
    if (this.picked.length) this.pin(this.picked);
    else if (this.lit) this.pin(undefined);
  }

  /** Lights other boxes for a moment (a comment's, while the pointer is on it); undefined goes back to the pick. */
  peek(ids: readonly string[] | undefined): void {
    if (ids?.length) this.pin(ids);
    else this.refresh();
  }

  private pin(ids: readonly string[] | undefined): void {
    this.lit = ids !== undefined;
    this.host.highlight(ids);
  }

  private show(): void {
    this.refresh();
    this.host.changed();
  }
}

/**
 * The box a spot means: the innermost box that holds it, else the box whose
 * edge is closest. Picture coordinates.
 */
export function nearestBox(boxes: readonly BundleBox[], x: number, y: number): string | undefined {
  let inside: BundleBox | undefined;
  let near: BundleBox | undefined;
  let nearest = Infinity;
  for (const b of boxes) {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    if (dx === 0 && dy === 0) {
      if (!inside || b.w * b.h < inside.w * inside.h) inside = b;
    } else if (Math.hypot(dx, dy) < nearest) {
      nearest = Math.hypot(dx, dy);
      near = b;
    }
  }
  return (inside ?? near)?.id;
}
