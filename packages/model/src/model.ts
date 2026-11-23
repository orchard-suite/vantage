/**
 * The resolved model: what the layout engine and renderer consume. Every id
 * is final, every type is resolved, every relation endpoint exists.
 */
import type { Artifact, DocsContract, EvidenceTie } from './schema-docs.ts';
import type { NodeRole, NodeShape } from './types.ts';
import type { Arrangement, Direction, DocView, EdgeStyle, FlowView, Head, PageView, Provenance, RelationKind, SequenceView, Style, TimelineView, WalkthroughView } from './schema.ts';
import type { Annotation, Fact, Highlight, NodeSize, Pins, StoryPath } from './schema-story.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { NodeOpenItem } from './schema-open.ts';

export interface ModelNode {
  readonly id: string;
  readonly name: string;
  readonly typeName: string;
  readonly role: NodeRole;
  readonly shape: NodeShape;
  readonly color: string;
  readonly icon?: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly url?: string;
  /** Decision records the YAML cites for this box, as written (SHOP-2001 or adr:<ULID>). */
  readonly decisions?: readonly string[];
  readonly tags: readonly string[];
  readonly style: Style;
  readonly count?: number;
  readonly facts: readonly Fact[];
  readonly bullets: readonly string[];
  readonly value?: string;
  readonly size: NodeSize;
  readonly note?: string;
  /** Resolved picture location: an absolute path, a URL, or a data URL. */
  readonly image?: string;
  readonly imageSize?: { readonly w: number; readonly h: number };
  readonly parentId?: string;
  readonly childIds: readonly string[];
  readonly depth: number;
  /** Which file declared it; imported nodes keep their namespace prefix in `id`. */
  readonly namespace?: string;
  /** The observed entity this node stands for, as source:id. */
  readonly bind?: string;
  /** Where the observed values on this node came from, when it is bound and overlaid. */
  readonly provenance?: Provenance;
  /** What is open against the bound entity, when the overlay found any. */
  readonly openItems?: readonly NodeOpenItem[];
}

export interface ModelRelation {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly description?: string;
  readonly kind: RelationKind;
  readonly via: readonly string[];
  readonly tags: readonly string[];
  readonly both: boolean;
  readonly weight: number;
  readonly color?: string;
  readonly style: EdgeStyle;
  readonly heads?: { readonly from?: Head | undefined; readonly to?: Head | undefined };
  /** The view that declared it, or undefined for model-level relations. */
  readonly viewId?: string;
}

export interface ResolvedRelationView {
  readonly kind: 'relation';
  readonly id: string;
  readonly title: string;
  readonly group?: string;
  readonly hidden?: boolean;
  readonly question?: string;
  readonly notes?: string;
  readonly tags: readonly string[];
  readonly direction: Direction;
  readonly relations: readonly ModelRelation[];
  /** Nodes requested without a relation. */
  readonly extraNodes: readonly string[];
  readonly subtree: readonly string[];
  readonly detail?: number;
  readonly expand: readonly string[];
  readonly collapse: readonly string[];
  readonly hide: readonly string[];
  /** This view's parent overrides: node id to container id, or `root`. */
  readonly reparent: Readonly<Record<string, string>>;
  readonly arrange: readonly Arrangement[];
  /** Draw a legend: always, never, or 'auto' when the view mixes line styles a reader must tell apart. */
  readonly legend: boolean | 'auto';
  /** Exported pictures draw open item badges too. */
  readonly openItems?: boolean;
  readonly paths: readonly ResolvedPath[];
  readonly annotations: readonly Annotation[];
  readonly highlights: readonly Highlight[];
  readonly narrative: boolean;
  readonly pins?: Pins;
}

export interface ResolvedPathStep {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly text?: string;
  /** Badge text: a number by default, or the author's id such as 4a. */
  readonly badge: string;
}

export interface ResolvedPath extends Omit<StoryPath, 'steps'> {
  readonly id: string;
  readonly color: string;
  readonly steps: readonly ResolvedPathStep[];
}

export interface ResolvedSequenceView extends Omit<SequenceView, 'tags'> {
  readonly tags: readonly string[];
}
export interface ResolvedFlowView extends Omit<FlowView, 'tags'> {
  readonly tags: readonly string[];
}
export interface ResolvedWalkthroughView extends Omit<WalkthroughView, 'tags'> {
  readonly tags: readonly string[];
}

export interface ResolvedPageView extends Omit<PageView, 'tags'> {
  readonly tags: readonly string[];
}

export interface ResolvedTimelineView extends Omit<TimelineView, 'tags'> {
  readonly tags: readonly string[];
}

/** A page of prose: Markdown from a file beside the document or written in it, read alone or beside a view. */
export interface ResolvedDocView extends Omit<DocView, 'tags'> {
  readonly tags: readonly string[];
  /** The folder of the document file on disk, where the files the page embeds are read; absent when the document is not a file (in the hub, a path is the attachment's own). */
  readonly dir?: string;
}

export type ResolvedView = ResolvedRelationView | ResolvedSequenceView | ResolvedFlowView | ResolvedWalkthroughView | ResolvedPageView | ResolvedTimelineView | ResolvedDocView;

export interface Model {
  readonly title: string;
  readonly author?: string;
  readonly updated?: string;
  readonly description?: string;
  readonly theme: 'light' | 'dark' | 'print' | 'colorblind' | 'auto';
  readonly nodes: ReadonlyMap<string, ModelNode>;
  readonly roots: readonly string[];
  readonly relations: readonly ModelRelation[];
  readonly views: readonly ResolvedView[];
  /** Custom icons from `icons:` blocks: icon id to the file or URL that draws it. */
  readonly icons: ReadonlyMap<string, string>;
  /** The docs contract, when the document has one. */
  readonly docs?: DocsContract;
  /** Files kept and never drawn; `file` is resolved as a picture's is. */
  readonly artifacts: readonly Artifact[];
  readonly evidence: readonly EvidenceTie[];
  readonly diagnostics: readonly Diagnostic[];
}

const REMOTE = /^(https?:|data:)/;

const DOCUMENT_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._/-]+$/;

/** Whether a path names a file inside the document's folder: relative, no `.` or `..` part, letters, digits, dots, dashes, underscores, and slashes. */
export function isDocumentPath(path: string): boolean {
  return DOCUMENT_PATH.test(path);
}

/** The views that are pictures: every view but the doc views, which are prose. Exports and publications of pictures walk these. */
export function pictureViews<V extends { readonly kind: string }>(views: readonly V[]): V[] {
  return views.filter((v) => v.kind !== 'doc');
}

/** The Markdown files the model's doc views read. */
export function docRefs(model: Pick<Model, 'views'>): string[] {
  return [...new Set(model.views.flatMap((v) => (v.kind === 'doc' && v.file !== undefined ? [v.file] : [])))].sort();
}

/** The files a model reads: custom icon files, pictures, the Markdown of its doc views, and its artifacts. URLs and data URLs are not files. */
export function assetRefs(model: Model): string[] {
  const refs = new Set<string>(docRefs(model));
  for (const ref of model.icons.values()) if (!REMOTE.test(ref)) refs.add(ref);
  for (const n of model.nodes.values()) if (n.image !== undefined && !REMOTE.test(n.image)) refs.add(n.image);
  for (const a of model.artifacts) refs.add(a.file);
  return [...refs].sort();
}

export function nodeOf(model: Model, id: string): ModelNode {
  const n = model.nodes.get(id);
  if (!n) throw new Error(`unknown node ${id}`);
  return n;
}

export function ancestorsOf(model: Model, id: string): string[] {
  const out: string[] = [];
  let cur = model.nodes.get(id)?.parentId;
  while (cur !== undefined) {
    out.push(cur);
    cur = model.nodes.get(cur)?.parentId;
  }
  return out;
}

export function descendantsOf(model: Model, id: string): string[] {
  const out: string[] = [];
  const stack = [...(model.nodes.get(id)?.childIds ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    stack.push(...(model.nodes.get(c)?.childIds ?? []));
  }
  return out;
}

export function viewOf(model: Model, id: string): ResolvedView | undefined {
  return model.views.find((v) => v.id === id);
}
