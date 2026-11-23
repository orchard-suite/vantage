/**
 * The layout engine as the viewer runs it. A document's kit goes in once;
 * any reshaping of a relation view (a depth, groups opened or shut where
 * they stand, a zoom into one container) comes out as a finished picture.
 * The kit carries icons and pictures already resolved, so nothing here
 * reads a disk and it runs in a browser.
 */
import { layoutView, scopedView, zoomedView, type Anchors, type ViewScope } from '@vantage/layout/core';
import type { Model, ModelNode, ResolvedRelationView } from '@vantage/model/resolved';
import type { IconSource } from './icons/source.ts';
import { picture, type Json } from './picture.ts';
import { drawSvg } from './svg.ts';
import type { ThemeName } from './theme.ts';

export type { Json } from './picture.ts';

/** What the viewer needs to lay out a document's relation views itself. */
export interface LayoutKit {
  readonly theme: ThemeName;
  readonly nodes: readonly ModelNode[];
  readonly roots: readonly string[];
  /** The relation views, resolved; a walkthrough plays over one of them. */
  readonly views: readonly ResolvedRelationView[];
  /** Icon id to the SVG that draws it, for every icon a node names. */
  readonly icons: Readonly<Record<string, string>>;
}

/** One picture to draw: a relation view with the reader's changes, or zoomed into one container. */
export interface PictureRequest extends ViewScope {
  readonly view: string;
  /** The container to zoom into; every other container collapses to a stub. */
  readonly zoom?: string;
  /** Box centres of the view as drawn first, so a change in place keeps the rest in their order. */
  readonly anchors?: readonly (readonly [string, number, number])[];
}

export class Engine {
  private readonly model: Model;
  private readonly icons: IconSource;

  constructor(private readonly kit: LayoutKit) {
    this.model = { title: '', theme: kit.theme, nodes: new Map(kit.nodes.map((n) => [n.id, n])), roots: kit.roots, relations: [], views: kit.views, icons: new Map(), artifacts: [], evidence: [], diagnostics: [] };
    this.icons = {
      get: (id) => kit.icons[id],
      has: (id) => id in kit.icons,
      list: (pack) => Object.keys(kit.icons).filter((k) => !pack || k.startsWith(`${pack}/`)),
    };
  }

  /** The picture for a request, or undefined when the kit has no such view. */
  picture(req: PictureRequest): Json | undefined {
    const view = this.kit.views.find((v) => v.id === req.view);
    if (!view) return undefined;
    const shaped = req.zoom !== undefined ? zoomedView(this.model, view, req, req.zoom) : scopedView(view, req);
    const anchors: Anchors | undefined = req.zoom === undefined && req.anchors ? new Map(req.anchors.map(([id, x, y]) => [id, { x, y }])) : undefined;
    const layout = layoutView(this.model, shaped, undefined, anchors);
    return picture(layout, drawSvg(layout, { theme: this.kit.theme, icons: this.icons, background: false, openItems: true }));
  }
}
