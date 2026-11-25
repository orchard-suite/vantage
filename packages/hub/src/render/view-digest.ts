/**
 * What one view's picture depends on, as a digest. A render reuses the
 * stored picture of every view whose digest matches the last render's, so
 * a save that changes one view lays out one view.
 *
 * A relation view reads the nodes it draws or moves in full, and of their
 * ancestors and descendants only where each sits in the tree (a folded box
 * counts what it hides, and the depths a reader can open follow the tree);
 * what a box it does not draw says never reaches the picture. It reads too
 * the relations that touch the nodes it draws, the anchors the view before
 * it left on the nodes it reads, and the document-wide settings. A walkthrough reads its relation view and its own
 * steps. A sequence, flow, or timeline reads the nodes it names, and a page
 * reads the views it holds, and a doc view reads its own Markdown and, through the
 * shared key, the pictures it embeds. A walkthrough over a view that is not a relation
 * view does not lay out, and takes the digest of the whole document.
 */
import { createHash } from 'node:crypto';
import { computeVisible, reparented, type Anchors } from '@vantage/layout';
import { ancestorsOf, descendantsOf, type Model, type ModelNode, type ResolvedView } from '@vantage/model';
import { freshnessOf } from '@vantage/render';

export interface DigestContext {
  /** Renderer version, theme, resources key, and threshold: what every view shares. */
  readonly shared: string;
  /** The digest of the whole document, for views that read all of it. */
  readonly document: string;
  readonly thresholdDays: number;
  readonly now: Date;
  /** The bytes of a file the document carries: a doc view's Markdown. The pictures a page embeds are in `shared`. */
  readonly file?: (path: string) => Uint8Array | undefined;
}

/** One render's digests: each node and relation is written out once, however many views read it. */
export class ViewDigests {
  private readonly nodeText = new Map<string, string>();
  private relationText: Map<string, string[]> | undefined;

  constructor(
    private readonly model: Model,
    private readonly ctx: DigestContext,
  ) {}

  digest(view: ResolvedView, anchors: Anchors | undefined): string {
    const h = createHash('sha256').update(this.ctx.shared);
    if (view.kind === 'walkthrough') {
      const base = this.model.views.find((v) => v.id === view.view);
      if (base?.kind === 'relation') return h.update(JSON.stringify(view)).update(this.relation(base, anchors)).digest('hex');
    }
    switch (view.kind) {
      case 'relation':
        return h.update(this.relation(view, anchors)).digest('hex');
      case 'page':
        // A page lays out each view it holds on its own, with no anchors.
        h.update(JSON.stringify(view));
        for (const id of view.panels.flatMap((p) => (p.view !== undefined ? [p.view] : []))) {
          const inner = this.model.views.find((v) => v.id === id);
          h.update(inner && inner.kind !== 'page' ? this.digest(inner, undefined) : `missing:${id}`);
        }
        return h.digest('hex');
      case 'sequence':
      case 'flow':
      case 'timeline':
        return h.update(this.named(view)).digest('hex');
      case 'doc':
        // A page's HTML names boxes and views by id and the viewer fills them in, so it reads its own Markdown; its pictures change `shared`.
        h.update(JSON.stringify(view));
        if (view.file !== undefined) h.update(this.ctx.file?.(view.file) ?? 'missing');
        return h.digest('hex');
      case 'walkthrough':
        return h.update(this.ctx.document).update(JSON.stringify(anchorList(anchors))).digest('hex');
    }
  }

  /** A view that draws the nodes it names: the view, the icons, and each node it names as drawn. */
  private named(view: ResolvedView): string {
    const h = createHash('sha256').update(JSON.stringify([view, [...this.model.icons]]));
    for (const id of [...namedNodes(this.model, view)].sort()) h.update(this.node(id));
    return h.digest('hex');
  }

  private relation(view: RelationView, anchors: Anchors | undefined): string {
    const read = nodesRead(this.model, view);
    const drawn = nodesDrawn(this.model, view);
    const ids = [...read].sort();
    const h = createHash('sha256').update(JSON.stringify([view, { roots: this.model.roots, icons: [...this.model.icons], theme: this.model.theme }, anchorList(anchors, read)]));
    for (const id of ids) h.update(drawn.has(id) ? this.node(id) : this.place(id));
    const byNode = this.relations();
    const seen = new Set<string>();
    for (const id of ids) if (drawn.has(id)) for (const r of byNode.get(id) ?? []) if (!seen.has(r)) (seen.add(r), h.update(r));
    return h.digest('hex');
  }

  /** Where a node the view does not draw sits in the tree: all the picture takes from it. */
  private place(id: string): string {
    const n = this.model.nodes.get(id)!;
    return JSON.stringify(['place', n.id, n.parentId ?? null, n.childIds, n.depth]);
  }

  private node(id: string): string {
    let text = this.nodeText.get(id);
    if (text === undefined) {
      text = JSON.stringify(nodeAsDrawn(this.model.nodes.get(id)!, this.ctx));
      this.nodeText.set(id, text);
    }
    return text;
  }

  /** Each relation's text under both its ends, in model order. */
  private relations(): Map<string, string[]> {
    if (!this.relationText) {
      this.relationText = new Map();
      for (const r of this.model.relations) {
        const text = JSON.stringify(r);
        for (const end of new Set([r.from, r.to])) {
          const list = this.relationText.get(end) ?? [];
          list.push(text);
          this.relationText.set(end, list);
        }
      }
    }
    return this.relationText;
  }
}

type RelationView = Extract<ResolvedView, { kind: 'relation' }>;

/** The nodes a relation view's picture reads. */
export function nodesRead(model: Model, view: RelationView): Set<string> {
  const read = new Set<string>();
  const done = new Set<string>();
  const add = (id: string): void => {
    if (done.has(id) || !model.nodes.has(id)) return;
    done.add(id);
    read.add(id);
    for (const a of ancestorsOf(model, id)) read.add(a);
    for (const d of descendantsOf(model, id)) read.add(d);
  };
  for (const id of computeVisible(model, view).nodes.keys()) add(id);
  for (const r of view.relations) for (const id of [r.from, r.to, ...r.via]) add(id);
  for (const id of [...view.extraNodes, ...view.subtree, ...Object.keys(view.reparent), ...Object.values(view.reparent)]) add(id);
  return read;
}

/**
 * The nodes a relation view draws: the boxes it shows, in its own tree and
 * in the document's. A relation whose end is hidden or folded away is drawn
 * to the box that shows it, and the view's text carries the relation, so
 * the rest of what it reads counts only by its place in the tree.
 */
export function nodesDrawn(model: Model, view: RelationView): Set<string> {
  const drawn = new Set(computeVisible(model, view).nodes.keys());
  if (Object.keys(view.reparent).length) for (const id of computeVisible(reparented(model, view.reparent), view).nodes.keys()) drawn.add(id);
  return drawn;
}

/** Every node a view names anywhere in its own text: an over-count is safe, a miss is not. */
export function namedNodes(model: Model, view: ResolvedView): Set<string> {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (model.nodes.has(v)) found.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(view);
  return found;
}

/** A node as the picture sees it: an observation reduced to its freshness, and an open item to its stale mark. */
function nodeAsDrawn(node: ModelNode, ctx: DigestContext): unknown {
  const open = node.openItems ? { openItems: node.openItems.map(({ observed: _o, ...i }) => i) } : {};
  if (!node.provenance) return { ...node, ...open };
  return { ...node, ...open, provenance: { ...node.provenance, observed: freshnessOf(node.provenance.observed, ctx.thresholdDays, ctx.now) } };
}

function anchorList(anchors: Anchors | undefined, only?: ReadonlySet<string>): [string, number, number][] {
  if (!anchors) return [];
  return [...anchors].filter(([id]) => !only || only.has(id)).map(([id, p]): [string, number, number] => [id, p.x, p.y]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
