/**
 * What the reader has done to each relation view during this visit:
 * groups opened or shut where they stand, and the detail depth. A zoom
 * comes from the route and lays out over the same changes, so zooming out
 * finds them as they were. Nothing here is saved; presence may carry the
 * changes to a reader who follows, and the document never changes.
 */
import type { PictureRequest } from '@vantage/render/engine';
import type { Bundle, BundleBox, BundlePicture, BundleView } from './bundle.ts';
import { LayoutEngine, type EngineSource } from './engine.ts';

interface Scope {
  readonly detail?: number;
  readonly open: ReadonlySet<string>;
  readonly shut: ReadonlySet<string>;
}

const AUTHORED: Scope = { open: new Set(), shut: new Set() };

/** A view's changes as plain lists, the way presence carries them. */
export interface Groups {
  readonly open: readonly string[];
  readonly shut: readonly string[];
  readonly detail?: number;
}

function isAuthored(s: Scope): boolean {
  return s.detail === undefined && !s.open.size && !s.shut.size;
}

/** The scope with one group flipped: a drawn container shuts, anything else opens. Undoing a change returns to the view as authored. */
function flipped(s: Scope, box: BundleBox): Scope {
  const open = new Set(s.open);
  const shut = new Set(s.shut);
  if (box.kind === 'container') {
    if (!open.delete(box.id)) shut.add(box.id);
  } else if (!shut.delete(box.id)) open.add(box.id);
  return { ...(s.detail !== undefined ? { detail: s.detail } : {}), open, shut };
}

export class Reshaper {
  private readonly scopes = new Map<string, Scope>();
  private engine: LayoutEngine | undefined;
  /** Node id to its number of children in the model, from the kit. */
  private kids = new Map<string, number>();

  constructor(bundle: Bundle, private readonly source: EngineSource | undefined) {
    this.setBundle(bundle);
  }

  /** A newer bundle: a new kit, so pictures laid out from the old one go. The reader's changes stay. */
  setBundle(bundle: Bundle): void {
    this.engine?.close();
    this.engine = bundle.kit && this.source ? new LayoutEngine(bundle.kit, this.source) : undefined;
    this.kids = new Map((bundle.kit?.nodes ?? []).map((n) => [n.id, n.childIds.length]));
  }

  /** Whether a box is a group the reader can open, shut, or zoom into. */
  canOpen(id: string): boolean {
    return this.engine !== undefined && (this.kids.get(id) ?? 0) > 0;
  }

  depth(base: BundleView): number {
    return this.scope(base).detail ?? base.detail ?? 0;
  }

  toggle(base: BundleView, box: BundleBox): void {
    this.scopes.set(base.id, flipped(this.scope(base), box));
  }

  setDepth(base: BundleView, depth: number): void {
    const { detail: _, ...rest } = this.scope(base);
    this.scopes.set(base.id, depth === (base.detail ?? 0) ? rest : { ...rest, detail: depth });
  }

  /** The reader's changes to a view, for presence; undefined when it is as authored. */
  changes(base: BundleView): Groups | undefined {
    const s = this.scope(base);
    return isAuthored(s) ? undefined : { open: [...s.open], shut: [...s.shut], ...(s.detail !== undefined ? { detail: s.detail } : {}) };
  }

  /** Takes another reader's changes to a view (undefined: as authored); true when that changes the picture. */
  adopt(base: BundleView, g: Groups | undefined): boolean {
    const next: Scope = { open: new Set(g?.open ?? []), shut: new Set(g?.shut ?? []), ...(g?.detail !== undefined ? { detail: g.detail } : {}) };
    const now = this.scope(base);
    const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
    if (now.detail === next.detail && same(now.open, next.open) && same(now.shut, next.shut)) return false;
    this.scopes.set(base.id, next);
    return true;
  }

  /** The picture on hand for the view and zoom: the view itself when the reader changed nothing, else one laid out already. */
  ready(base: BundleView, zoom: string | undefined): BundlePicture | undefined {
    if (this.authored(base, zoom)) return base;
    return this.engine?.peek(this.request(base, this.scope(base), zoom));
  }

  /** The picture for the view and zoom, laid out now if need be. Undefined when no engine can draw it. */
  async picture(base: BundleView, zoom: string | undefined): Promise<BundlePicture | undefined> {
    if (this.authored(base, zoom)) return base;
    return this.engine?.request(this.request(base, this.scope(base), zoom), true);
  }

  /** Lays out, ahead of the reader, every next step from the drawn picture: each group flipped, and each zoom. */
  prefetch(base: BundleView, drawn: BundlePicture, zoom: string | undefined): void {
    const engine = this.engine;
    if (!engine) return;
    engine.dropLater();
    const s = this.scope(base);
    for (const b of drawn.boxes) {
      if (!this.canOpen(b.id) || b.id === zoom) continue;
      const next = flipped(s, b);
      if (b.kind !== 'leaf' && (zoom !== undefined || !isAuthored(next))) void engine.request(this.request(base, next, zoom), false);
      void engine.request(this.request(base, s, b.id), false);
    }
  }

  private scope(base: BundleView): Scope {
    return this.scopes.get(base.id) ?? AUTHORED;
  }

  private authored(base: BundleView, zoom: string | undefined): boolean {
    return zoom === undefined && isAuthored(this.scope(base));
  }

  private request(base: BundleView, s: Scope, zoom: string | undefined): PictureRequest {
    return {
      // A walkthrough on its own (a guest link to it alone) is its own base; the kit holds the view it plays over.
      view: base.baseView ?? base.id,
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
      open: [...s.open],
      shut: [...s.shut],
      ...(zoom !== undefined ? { zoom } : {}),
      anchors: base.boxes.map((b): [string, number, number] => [b.id, b.x + b.w / 2, b.y + b.h / 2]),
    };
  }
}

/** A view as its author shaped it, laid out from a newer kit, its boxes kept where they stand. */
export function aheadRequest(base: BundleView): PictureRequest {
  return { view: base.baseView ?? base.id, open: [], shut: [], anchors: base.boxes.map((b): [string, number, number] => [b.id, b.x + b.w / 2, b.y + b.h / 2]) };
}
