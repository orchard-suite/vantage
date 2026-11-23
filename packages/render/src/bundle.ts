/**
 * Builds the viewer bundle: every view laid out and rendered, the box and
 * edge facts the viewer needs for hover, focus, and search, and the layout
 * kit the viewer lays out with when a reader opens, shuts, or zooms into a
 * group or changes the detail depth.
 */
import { layoutView, anchorsOf, depthStops, type Anchors, type Layout, type LayoutEdge } from '@vantage/layout';
import type { Model, ResolvedView, ResolvedRelationView, ResolvedPath, Diagnostic } from '@vantage/model';
import { renderSvg } from './render-svg.ts';
import { FileAssetSource } from './assets.ts';
import { assetHref, type Resources } from './hrefs.ts';
import { fontCss } from './fonts.ts';
import type { ThemeName } from './theme.ts';
import type { LayoutKit } from './engine.ts';
import { picture, type Json } from './picture.ts';
import { docEntry } from './doc-pages.ts';
import { renderDoc } from './doc.ts';
import type { AssetSource } from './hrefs.ts';

export type { Json } from './picture.ts';

export interface BundleOptions extends Resources {
  readonly theme?: ThemeName;
  readonly live?: boolean;
  readonly embedFonts?: boolean;
  readonly diagnostics?: readonly Diagnostic[];
}

/** The drawn edge a path step rides on, matched the way the layout matched it. */
function edgeForStep(edges: readonly LayoutEdge[], pathId: string, from: string, to: string, label: string | undefined): string | undefined {
  const key = `${from}>${to}`;
  const hits = edges.filter((e) => (e.pathIds ?? []).includes(pathId) && ((e.from === from && e.to === to) || e.members.includes(key) || (e.relation.from === from && e.relation.to === to)));
  if (!hits.length) return undefined;
  const exact = label !== undefined ? hits.find((e) => e.relation.label === label || e.label?.text.includes(label)) : undefined;
  return (exact ?? hits[0])!.id;
}

function pathsOf(view: ResolvedRelationView, layout: Layout): Json[] {
  return view.paths.map((p: ResolvedPath) => ({
    id: p.id,
    ...(p.title !== undefined ? { title: p.title } : {}),
    color: p.color,
    steps: p.steps.map((s) => {
      const edgeId = edgeForStep(layout.edges, p.id, s.from, s.to, s.label);
      return {
        from: s.from,
        to: s.to,
        badge: s.badge,
        ...(s.label !== undefined ? { label: s.label } : {}),
        ...(s.text !== undefined ? { text: s.text } : {}),
        ...(edgeId !== undefined ? { edgeId } : {}),
      };
    }),
  }));
}

/** The detail depths a relation view can show, when it can show more than one. */
function depthsOf(model: Model, view: ResolvedRelationView | undefined): Json {
  const stops = view ? depthStops(model, view) : [];
  return stops.length > 1 ? { depths: stops } : {};
}

/** One view's entry. A doc view's page is read from `assets`, the document's files. */
export function viewBundle(model: Model, view: ResolvedView, layout: Layout, svg: string, assets?: AssetSource): Json {
  const base = view.kind === 'walkthrough' ? view.view : undefined;
  const relation = view.kind === 'relation' ? view : undefined;
  return {
    id: view.id,
    title: view.title,
    kind: view.kind,
    ...(view.group !== undefined ? { group: view.group } : {}),
    ...(view.hidden ? { hidden: true } : {}),
    ...(view.question !== undefined ? { question: view.question } : {}),
    ...(view.notes !== undefined ? { notes: view.notes } : {}),
    ...picture(layout, svg),
    metrics: { score: layout.metrics.score, crossings: layout.metrics.crossings, notes: layout.metrics.notes },
    ...(base !== undefined ? { baseView: base } : {}),
    ...(view.kind === 'walkthrough' ? { steps: view.steps } : {}),
    ...(relation ? { detail: relation.detail ?? 0 } : {}),
    ...(relation?.openItems ? { openItems: true } : {}),
    ...depthsOf(model, relation),
    ...(relation && relation.paths.length ? { paths: pathsOf(relation, layout) } : {}),
    ...(relation && relation.annotations.length ? { annotations: relation.annotations } : {}),
    ...(view.kind === 'doc' ? docEntry(view, assets) : {}),
  };
}

/** How a bundle draws its pictures: the theme and resources, never a page background, and the open item badges always. */
export function bundleDraw(model: Model, opts: BundleOptions = {}): (layout: Layout) => string {
  const theme = bundleTheme(model, opts);
  return (layout: Layout): string => renderSvg(layout, { theme, ...(opts.icons ? { icons: opts.icons } : {}), ...(opts.assets ? { assets: opts.assets } : {}), background: false, openItems: true });
}

function bundleTheme(model: Model, opts: BundleOptions): ThemeName {
  return opts.theme ?? (model.theme === 'auto' ? 'light' : model.theme);
}

/** What the viewer lays out with: the relation views, their nodes, and the icons and pictures they draw, resolved here. */
export function layoutKit(model: Model, opts: BundleOptions = {}): LayoutKit {
  const assets = opts.assets ?? new FileAssetSource();
  const icons: Record<string, string> = {};
  const nodes = [...model.nodes.values()].map((n) => {
    const svg = n.icon !== undefined ? opts.icons?.get(n.icon) : undefined;
    if (svg !== undefined) icons[n.icon!] = svg;
    return n.image === undefined ? n : { ...n, image: assetHref(n.image, assets) ?? '' };
  });
  const views = model.views.filter((v): v is ResolvedRelationView => v.kind === 'relation');
  return { theme: bundleTheme(model, opts), nodes, roots: model.roots, views, icons };
}

/**
 * The kit cut to one relation view, for a reader allowed that view alone:
 * the view and the trees its boxes sit in, the most a reader can open or
 * zoom it into.
 */
export function kitForView(kit: LayoutKit, viewId: string): LayoutKit {
  const view = kit.views.find((v) => v.id === viewId);
  if (!view) return { ...kit, nodes: [], roots: [], views: [], icons: {} };
  const byId = new Map(kit.nodes.map((n) => [n.id, n]));
  const rootOf = (id: string): string => {
    let n = byId.get(id);
    while (n?.parentId !== undefined) n = byId.get(n.parentId);
    return n?.id ?? id;
  };
  const seeds = [...view.relations.flatMap((r) => [r.from, r.to, ...r.via]), ...view.extraNodes, ...view.subtree, ...view.expand];
  const keep = new Set<string>();
  const stack = [...new Set(seeds.map(rootOf))];
  while (stack.length) {
    const id = stack.pop()!;
    keep.add(id);
    stack.push(...(byId.get(id)?.childIds ?? []));
  }
  const nodes = kit.nodes.filter((n) => keep.has(n.id));
  const used = new Set(nodes.map((n) => n.icon));
  const icons = Object.fromEntries(Object.entries(kit.icons).filter(([id]) => used.has(id)));
  return { theme: kit.theme, nodes, roots: kit.roots.filter((r) => keep.has(r)), views: [view], icons };
}

function kitOf(model: Model, opts: BundleOptions): Json {
  return model.views.some((v) => v.kind === 'relation') ? { kit: layoutKit(model, opts) } : {};
}

/** The bundle around its views: everything but the views themselves. */
export function bundleOf(model: Model, views: readonly Json[], opts: BundleOptions = {}): Json {
  return {
    title: model.title,
    ...(model.author !== undefined ? { author: model.author } : {}),
    ...(model.updated !== undefined ? { updated: model.updated } : {}),
    ...(model.description !== undefined ? { description: model.description, descriptionHtml: renderDoc('', model.description).html } : {}),
    theme: bundleTheme(model, opts),
    views,
    diagnostics: (opts.diagnostics ?? model.diagnostics).map((d) => ({ severity: d.severity, message: d.message, ...(d.line !== undefined ? { line: d.line } : {}) })),
    ...kitOf(model, opts),
    ...(opts.live ? { live: true } : {}),
    ...(opts.embedFonts === false ? {} : { fontCss: fontCss() }),
  };
}

/** Every view laid out and rendered, each relation view after the one before it so shared boxes keep their order. */
export function buildBundle(model: Model, opts: BundleOptions = {}): Json {
  const draw = bundleDraw(model, opts);
  let previous: Anchors | undefined;
  const views = model.views.map((view) => {
    const layout = layoutView(model, view, undefined, previous);
    if (view.kind === 'relation') previous = anchorsOf(layout);
    return viewBundle(model, view, layout, draw(layout), opts.assets ?? new FileAssetSource());
  });
  return bundleOf(model, views, opts);
}
