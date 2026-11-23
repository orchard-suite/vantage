/** What the viewer receives: one JSON object, embedded in the HTML or fetched from the server. */
import type { LayoutKit } from '@vantage/render/engine';

export interface BundleFact {
  readonly label: string;
  readonly value: string;
}

export interface BundleBox {
  readonly id: string;
  readonly name: string;
  readonly kind: 'leaf' | 'container' | 'collapsed';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly parentId?: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly type?: string;
  readonly url?: string;
  /** Decision records the YAML cites for this box (SHOP-2001 or adr:<ULID>); a hub resolves them. */
  readonly decisions?: readonly string[];
  readonly tags?: readonly string[];
  readonly facts?: readonly BundleFact[];
  readonly bullets?: readonly string[];
  readonly value?: string;
  readonly note?: string;
  /** Provenance, when the model carries it. */
  readonly source?: string;
  readonly observed?: string;
  /** What is open against the bound entity, worst first. */
  readonly openItems?: readonly BundleOpenItem[];
}

export interface BundleOpenItem {
  readonly kind: 'issue' | 'alert' | 'pr' | 'incident';
  readonly title: string;
  readonly url?: string;
  readonly severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  readonly status?: string;
  readonly updated?: string;
  readonly source: string;
  readonly observed: string;
  readonly stale?: boolean;
}

export interface BundleEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly description?: string;
  readonly kind: string;
  readonly members: readonly string[];
  readonly pathIds?: readonly string[];
}

export interface BundleMetrics {
  readonly score: number;
  readonly crossings: number;
  readonly notes: readonly string[];
}

export interface BundleWalkStep {
  readonly title: string;
  readonly text?: string;
  readonly highlight?: readonly string[];
  readonly focus?: string;
  readonly view?: string;
}

export interface BundlePathStep {
  readonly from: string;
  readonly to: string;
  readonly badge: string;
  readonly label?: string;
  readonly text?: string;
  readonly edgeId?: string;
}

export interface BundlePath {
  readonly id: string;
  readonly title?: string;
  readonly color: string;
  readonly steps: readonly BundlePathStep[];
}

export interface BundleAnnotation {
  readonly text: string;
  readonly at?: string;
  readonly kind?: 'note' | 'callout' | 'heading';
}

/** A finished picture: the SVG and the geometry the viewer needs to morph into it. */
export interface BundlePicture {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /** Where the drawing ends and the prose under it begins; the first frame fits the drawing. */
  readonly figureHeight?: number;
  readonly boxes: readonly BundleBox[];
  readonly edges: readonly BundleEdge[];
}

export interface BundleView extends BundlePicture {
  readonly id: string;
  readonly title: string;
  readonly kind: 'relation' | 'sequence' | 'flow' | 'walkthrough' | 'page' | 'timeline' | 'doc';
  readonly group?: string;
  /** A part other views extend; out of the picker until the reader turns on Show parts. */
  readonly hidden?: boolean;
  readonly question?: string;
  readonly notes?: string;
  readonly metrics: BundleMetrics;
  /** Walkthrough views: the base view id and the steps. */
  readonly baseView?: string;
  readonly steps?: readonly BundleWalkStep[];
  /** Relation views: the authored detail depth, paths, annotations, and the depths that change the picture. */
  readonly detail?: number;
  readonly paths?: readonly BundlePath[];
  readonly annotations?: readonly BundleAnnotation[];
  readonly depths?: readonly number[];
  /** The view asks exported pictures to keep the open item badges. */
  readonly openItems?: boolean;
  /** Doc views: the page, and the view it is read beside. */
  readonly doc?: BundleDoc;
  readonly beside?: string;
}

/** A doc view's page: its HTML, its headings, and the boxes and views it names by id. */
export interface BundleDoc {
  readonly html: string;
  readonly headings: readonly { readonly id: string; readonly text: string; readonly level: number }[];
  readonly nodes: readonly string[];
  readonly figures: readonly string[];
  /** Decision records the page cites; absent in bundles made before pages could cite them. */
  readonly decisions?: readonly string[];
}

/** Present when the hub serves the bundle to a signed-in reader; turns on steer, comments, and history. */
export interface BundleHub {
  readonly documentId: string;
  /** The head version this bundle was rendered from; every write names it as the expected version. */
  readonly version: string;
  readonly canEdit: boolean;
  /** The workspace's delete rule lets this reader delete the document. */
  readonly canDelete?: boolean;
  /** The workspace page, where the reader lands after a delete. */
  readonly workspaceUrl?: string;
  readonly apiBase: string;
  readonly csrf?: string;
  /** The look the reader picked on their account: it wins over this browser's memory, and system follows the system setting. */
  readonly theme?: 'system' | 'light' | 'dark';
  /** The kind of item this document defines, when it defines one: its name and its Work board. */
  readonly items?: { readonly name: string; readonly url: string };
}

export interface Bundle {
  readonly title: string;
  readonly author?: string;
  readonly updated?: string;
  readonly description?: string;
  /** The description's Markdown as HTML, rendered once with the doc pages' renderer. */
  readonly descriptionHtml?: string;
  readonly theme: 'light' | 'dark' | 'print' | 'colorblind';
  readonly views: readonly BundleView[];
  readonly diagnostics: readonly { severity: string; message: string; line?: number }[];
  /** Set by the dev server so the viewer can subscribe to reloads. */
  readonly live?: boolean;
  /** Set by the hub: the viewer says who is here and lets readers follow each other over the live stream. */
  readonly presence?: boolean;
  /** The hub is still rendering this version; the views are empty and a newer answer follows. */
  readonly pending?: boolean;
  /** The hub is drawing a newer version; these are the last finished pictures, and the new ones follow. */
  readonly drawing?: boolean;
  readonly fontCss?: string;
  readonly hub?: BundleHub;
  /** Set by the hub: its voice walkthroughs can be listed and played beside this bundle. */
  readonly recordings?: boolean;
  /** The hub render this bundle came from. */
  readonly render?: string | null;
  /** The hub version these pictures are of; may trail the head while it draws. */
  readonly version?: string;
  /** The views are listed by id and digest, and each view's entry is read from its own address. */
  readonly lazy?: boolean;
  /** What the viewer lays out with when a reader opens, shuts, or zooms into a group, or changes the depth. */
  readonly kit?: LayoutKit;
}

/** Views in picker order: grouped by first appearance, in document order within a group. Parts stay out unless asked for. */
export function pickerOrder(views: readonly BundleView[], parts = false): BundleView[] {
  const groups = new Map<string, BundleView[]>();
  for (const v of views) {
    if (v.hidden && !parts) continue;
    const g = v.group ?? 'Views';
    groups.set(g, [...(groups.get(g) ?? []), v]);
  }
  return [...groups.values()].flat();
}

/** What the app bar says while the hub draws a newer version than the one on the stage. */
export function drawingNote(bundle: Bundle): string | undefined {
  return bundle.drawing ? 'Drawing your change' : undefined;
}

/** A document has an overview page when there is something to say about it as a whole: a description, or more than one view to choose from. */
export function hasOverview(bundle: Bundle): boolean {
  return bundle.views.length > 0 && (Boolean(bundle.description) || pickerOrder(bundle.views).length > 1);
}

/** The first view a reader should see: the first one that is not a part. */
export function firstView(views: readonly BundleView[]): BundleView | undefined {
  return views.find((v) => !v.hidden) ?? views[0];
}

/** A `group` is a path: "Platform / Identity" nests Identity inside Platform. */
export function groupPath(group: string | undefined): string[] {
  return (group ?? 'Views').split(' / ').map((s) => s.trim()).filter(Boolean);
}

export interface PickerGroup {
  readonly name: string;
  /** The full path, for remembering fold state: "Platform / Identity". */
  readonly path: string;
  readonly groups: PickerGroup[];
  readonly views: BundleView[];
}

/** The picker as a tree of folding groups. Groups appear where their first view does; views keep document order. */
export function pickerTree(views: readonly BundleView[], parts = false): PickerGroup[] {
  const roots: PickerGroup[] = [];
  const find = (list: PickerGroup[], name: string, path: string): PickerGroup => {
    let g = list.find((x) => x.name === name);
    if (!g) {
      g = { name, path, groups: [], views: [] };
      list.push(g);
    }
    return g;
  };
  for (const v of views) {
    if (v.hidden && !parts) continue;
    let list = roots;
    let group: PickerGroup | undefined;
    let path = '';
    for (const name of groupPath(v.group)) {
      path = path ? `${path} / ${name}` : name;
      group = find(list, name, path);
      list = group.groups;
    }
    group?.views.push(v);
  }
  return roots;
}

/** The base view with another picture of it swapped in. */
export function withPicture(base: BundleView, pic: BundlePicture): BundleView {
  const { figureHeight: _old, ...rest } = base;
  return { ...rest, svg: pic.svg, width: pic.width, height: pic.height, ...(pic.figureHeight !== undefined ? { figureHeight: pic.figureHeight } : {}), boxes: pic.boxes, edges: pic.edges };
}

declare global {
  interface Window {
    __VANTAGE__?: Bundle;
  }
}

/** The boxes of a view's first story step, as one rect: where a picture too wide to read whole opens. */
export function firstStepRect(view: BundleView | undefined): { x: number; y: number; w: number; h: number } | undefined {
  const step = view?.paths?.[0]?.steps[0];
  if (!view || !step) return undefined;
  // The drawn edge names the boxes on screen: a step into a box folded inside another lands on the one drawn.
  const edge = step.edgeId !== undefined ? view.edges.find((e) => e.id === step.edgeId) : undefined;
  const ends = edge ? [edge.from, edge.to] : [step.from, step.to];
  const bs = view.boxes.filter((b) => ends.includes(b.id));
  if (!bs.length) return undefined;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}
