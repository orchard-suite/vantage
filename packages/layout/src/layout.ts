/** Entry point: lays out any view kind. Walkthroughs lay out their base view. */
import { viewOf, type Model, type ResolvedView } from '@vantage/model/resolved';
import { layoutRelationView } from './relation.ts';
import { layoutSequenceView } from './sequence.ts';
import { layoutFlowView } from './flowchart.ts';
import { layoutPageView } from './page.ts';
import { layoutTimelineView } from './timeline.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import type { Layout } from './types.ts';
import { measureQuality } from './metrics.ts';

/** Centres of boxes in a view laid out earlier; a later view keeps shared nodes in the same order when nothing else decides. */
export type Anchors = ReadonlyMap<string, { x: number; y: number }>;

export function anchorsOf(layout: Layout): Anchors {
  return new Map(layout.boxes.map((b) => [b.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }]));
}

/** Carries a view's open item opt-in to the renderer; it moves nothing. */
function withOpenItems(l: Layout, on: boolean | undefined): Layout {
  return on ? { ...l, openItems: true } : l;
}

/** Layouts already made for a view object and a style, with no anchors: layout is pure, so a page and the view it embeds share one. */
const made = new WeakMap<ResolvedView, Map<LayoutStyle, Layout>>();

export function layoutView(model: Model, view: ResolvedView, style: LayoutStyle = DEFAULT_STYLE, anchors?: Anchors): Layout {
  if (anchors) return layoutFresh(model, view, style, anchors);
  const byStyle = made.get(view) ?? new Map<LayoutStyle, Layout>();
  const hit = byStyle.get(style);
  if (hit) return hit;
  const l = layoutFresh(model, view, style, undefined);
  byStyle.set(style, l);
  made.set(view, byStyle);
  return l;
}

/** A doc view is prose, not a picture: its layout holds nothing and scores full marks. */
function emptyLayout(viewId: string, title: string): Layout {
  return { viewId, title, width: 1, height: 1, boxes: [], edges: [], metrics: { ...measureQuality([], [], 1, 1), notes: [] } };
}

function layoutFresh(model: Model, view: ResolvedView, style: LayoutStyle, anchors: Anchors | undefined): Layout {
  switch (view.kind) {
    case 'relation':
      return withOpenItems(layoutRelationView(model, view, style, anchors), view.openItems);
    case 'sequence':
      return layoutSequenceView(model, view, style);
    case 'flow':
      return layoutFlowView(model, view, style);
    case 'walkthrough': {
      const base = viewOf(model, view.view);
      if (!base || base.kind !== 'relation') throw new Error(`walkthrough ${view.id} has no relation view ${view.view}`);
      const l = layoutRelationView(model, base, style, anchors);
      return withOpenItems({ ...l, viewId: view.id, title: view.title }, base.openItems);
    }
    case 'page':
      return layoutPageView(model, view, (v) => layoutView(model, v, style), style);
    case 'timeline':
      return layoutTimelineView(model, view, style);
    case 'doc':
      return emptyLayout(view.id, view.title);
  }
}
