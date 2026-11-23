/**
 * The render of one version, as pure functions of plain data so they run
 * on render threads. A render is planned once and drawn in ranges:
 *
 * - `planDocument` lays the observed layer over the text, takes the digest
 *   of what the picture depends on (a match with the last render draws
 *   nothing), builds the bundle's shell (the layout kit, theme, and
 *   diagnostics), and says for each view whether it will likely be drawn
 *   and where a range may start.
 * - `drawRange` lays out and draws the views of one range, in order. A view
 *   whose digest (view-digest.ts) matches the last render's is taken as it
 *   was; only the rest is laid out.
 *
 * A relation view breaks layout ties with the box centres the relation
 * view before it left (its anchors), so views depend on the ones before
 * them. A range that starts mid-document starts from the anchors the last
 * render stored for the view before it; the caller checks that guess
 * against the anchors that view really left, and draws the range again
 * when they differ. Every picture is therefore the one a single pass over
 * every view, in order, draws.
 *
 * The stored bundle is the shell with a list of view ids and digests;
 * each view's entry is stored on its own, gzipped, and reused by the
 * renders after it until its digest changes.
 */
import { createHash } from 'node:crypto';
import { anchorsOf, layoutView, type Anchors } from '@vantage/layout';
import { drift, type Drift, type ItemFreshness, type ObservedModel } from '@vantage/connectors';
import { bundleDraw, bundleOf, chromeFontCss, freshnessOf, resourceDiagnostics, viewBundle, type Json } from '@vantage/render';
import { FONT_BASE } from '../web/look.ts';
import type { Diagnostic, Model, ResolvedView } from '@vantage/model';
import { loadOverlaid, type ImportMap } from '../documents/model.ts';
import { sanitizeBundle } from '../sanitize.ts';
import { resourcesFrom, type ResourceData } from './resources.ts';
import { nodesRead, namedNodes, ViewDigests } from './view-digest.ts';
import { RENDERER } from './renderer.ts';

/** Box centres a relation view leaves for the views after it. */
export type AnchorList = readonly (readonly [string, number, number])[];

/** What a render keeps of each view, so the next one can take it as it is. */
export interface CachedView {
  readonly digest: string;
  readonly anchors?: AnchorList;
  readonly score: number;
  readonly width: number;
  readonly height: number;
}

export interface DocumentInput {
  readonly yaml: string;
  readonly imports: ImportMap;
  /** The version's text hash. */
  readonly hash: string;
  /** Entities and relations of the sources the document draws from. */
  readonly observed: ObservedModel;
  readonly resources: ResourceData;
  readonly thresholdDays: number;
  /** ISO time freshness is judged at. */
  readonly now: string;
  /** The views of the last render: a view whose digest matches is reused, and its anchors start a range. */
  readonly cached?: Readonly<Record<string, CachedView>> | undefined;
}

export interface PlanInput extends DocumentInput {
  /** The digest of the last render of this hash; a match skips drawing. */
  readonly previousDigest?: string | undefined;
}

/** One view as planned: whether it will likely be drawn, its rough cost, and the relation view before it. */
export interface PlannedView {
  readonly id: string;
  readonly likely: boolean;
  readonly cost: number;
  /** The last relation view before this one, whose anchors this view starts from. */
  readonly prev?: string;
}

export type PlanOutput =
  | { readonly kind: 'skipped'; readonly digest: string; readonly errors: number; readonly drift: Drift }
  | { readonly kind: 'unparsable'; readonly digest: string; readonly errors: number; readonly drift: Drift; readonly bundleGz: Uint8Array }
  | {
      readonly kind: 'planned';
      readonly digest: string;
      readonly errors: number;
      readonly drift: Drift;
      /** The bundle without its views, as JSON text ending in `}`. */
      readonly shell: string;
      readonly views: readonly PlannedView[];
    };

export interface RangeInput extends DocumentInput {
  readonly from: number;
  readonly to: number;
  /** Anchors of the last relation view before `from`. */
  readonly incoming?: AnchorList | undefined;
}

export interface RangeView extends CachedView {
  readonly id: string;
  /** The view's bundle entry, gzipped, when this range drew it; a reused view keeps its stored entry. */
  readonly entryGz?: Uint8Array;
}

const NO_DRIFT: Drift = { items: [], counts: { declaredNotObserved: 0, observedNotDeclared: 0, factMismatch: 0 } };

/**
 * What the picture depends on: the text, the documents after the observed
 * layer (with each observation reduced to its freshness, the only part a
 * picture shows; an open item keeps its stale mark, not its time), the files and icons, the threshold, and the renderer.
 */
function digestOf(input: DocumentInput, drawn: readonly unknown[]): string {
  const now = new Date(input.now);
  const normalized = JSON.stringify(drawn, (key, value: unknown) => {
    if (key === 'openItems' && Array.isArray(value)) return value.map((i: { observed?: string }) => ({ ...i, observed: undefined }));
    if (key !== 'provenance' || !value || typeof value !== 'object') return value;
    const p = value as { observed?: string };
    return { ...p, observed: freshnessOf(p.observed, input.thresholdDays, now) };
  });
  return createHash('sha256').update(JSON.stringify([RENDERER, input.hash, input.resources.key, input.thresholdDays])).update(normalized).digest('hex');
}

/** How open items are judged stale in this render. */
const freshOf = (input: DocumentInput): ItemFreshness => ({ now: new Date(input.now), thresholdDays: input.thresholdDays });

function bundleDiagnostics(diagnostics: readonly Diagnostic[]): { severity: string; message: string; line?: number }[] {
  return diagnostics.map((d) => ({ severity: d.severity, message: d.message, ...(d.line !== undefined ? { line: d.line } : {}) }));
}

interface Prepared {
  readonly digest: string;
  readonly errors: number;
  readonly drift: Drift;
  readonly diagnostics: Diagnostic[];
  readonly model: Model | undefined;
}

function prepare(input: DocumentInput): Prepared {
  const loaded = loadOverlaid(input, input.observed, freshOf(input));
  const diagnostics = [...loaded.diagnostics];
  return {
    digest: digestOf(input, loaded.drawn),
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    drift: loaded.declared ? drift(loaded.declared, input.observed) : NO_DRIFT,
    diagnostics,
    model: loaded.model,
  };
}

/** How every view of a parsed document is drawn and digested. */
function drawing(input: DocumentInput, model: Model, digest: string) {
  const theme = model.theme === 'dark' ? 'dark' : 'light';
  const res = resourcesFrom(model, input.resources);
  const digests = new ViewDigests(model, { shared: JSON.stringify([RENDERER, theme, input.resources.key, input.thresholdDays]), document: digest, thresholdDays: input.thresholdDays, now: new Date(input.now), file: (path) => input.resources.files[path] });
  return { theme, res, digests } as const;
}

const toAnchors = (list: AnchorList | undefined): Anchors | undefined => (list ? new Map(list.map(([id, x, y]) => [id, { x, y }])) : undefined);

export function planDocument(input: PlanInput): PlanOutput {
  const p = prepare(input);
  if (input.previousDigest === p.digest) return { kind: 'skipped', digest: p.digest, errors: p.errors, drift: p.drift };
  const model = p.model;
  if (!model) {
    const bundle = { title: 'Untitled', theme: 'light', views: [], diagnostics: bundleDiagnostics(p.diagnostics) };
    return { kind: 'unparsable', digest: p.digest, errors: p.errors, drift: p.drift, bundleGz: Bun.gzipSync(JSON.stringify(bundle)) };
  }
  const { theme, res, digests } = drawing(input, model, p.digest);
  const diagnostics = [...p.diagnostics, ...resourceDiagnostics(model, res)];
  // The shell carries the layout kit; its text is sanitized like the views', since the viewer lays out pictures from it.
  // Its fonts are the hub's own files, so a refresh does not carry them; a copy that stands alone embeds them (derived.ts).
  const { views: _views, ...bare } = bundleOf(model, [], { theme, diagnostics, ...res, embedFonts: false });
  const shell = sanitizeBundle({ ...bare, fontCss: chromeFontCss(FONT_BASE) });
  const views: PlannedView[] = [];
  let prev: string | undefined;
  for (const view of model.views) {
    // Each view's digest as the last render's anchors would make it: a guess the ranges are checked against.
    const cached = input.cached?.[view.id];
    const d = digests.digest(view, toAnchors(prev !== undefined ? input.cached?.[prev]?.anchors : undefined));
    const likely = cached?.digest !== d;
    views.push({ id: view.id, likely, cost: likely ? costOf(model, view) : 0, ...(prev !== undefined ? { prev } : {}) });
    if (view.kind === 'relation') prev = view.id;
  }
  return { kind: 'planned', digest: p.digest, errors: p.errors, drift: p.drift, shell: JSON.stringify(shell), views };
}

/**
 * The layout kit of a version, as JSON text: what a viewer lays a view out
 * with in the browser while the hub draws the version itself.
 */
export function kitOf(input: DocumentInput): string | undefined {
  const model = loadOverlaid(input, input.observed, freshOf(input)).model;
  if (!model) return undefined;
  const theme = model.theme === 'dark' ? 'dark' : 'light';
  const shell = sanitizeBundle(bundleOf(model, [], { theme, ...resourcesFrom(model, input.resources) }));
  return shell['kit'] === undefined ? undefined : JSON.stringify(shell['kit']);
}

/** A view's rough layout cost: the boxes it lays out. */
function costOf(model: Model, view: ResolvedView): number {
  if (view.kind === 'relation') return 1 + nodesRead(model, view).size;
  if (view.kind === 'walkthrough') {
    const base = model.views.find((v) => v.id === view.view);
    return 1 + (base?.kind === 'relation' ? nodesRead(model, base).size : 0);
  }
  return 1 + namedNodes(model, view).size;
}

export function drawRange(input: RangeInput): RangeView[] {
  const p = prepare(input);
  const model = p.model;
  if (!model) throw new Error('a range of a document that does not parse');
  const { theme, res, digests } = drawing(input, model, p.digest);
  const draw = bundleDraw(model, { theme, ...res });
  let previous = toAnchors(input.incoming);
  const out: RangeView[] = [];
  for (const view of model.views.slice(input.from, input.to)) {
    const d = digests.digest(view, previous);
    const cached = input.cached?.[view.id];
    if (cached?.digest === d) {
      out.push({ ...cached, id: view.id });
      if (view.kind === 'relation') previous = toAnchors(cached.anchors);
      continue;
    }
    const layout = layoutView(model, view, undefined, previous);
    const anchors = view.kind === 'relation' ? anchorsOf(layout) : undefined;
    const entry: Json = sanitizeBundle(viewBundle(model, view, layout, draw(layout), res.assets));
    out.push({
      id: view.id,
      digest: d,
      score: layout.metrics.score,
      width: layout.width,
      height: layout.height,
      ...(anchors ? { anchors: [...anchors].map(([id, pt]): [string, number, number] => [id, pt.x, pt.y]) } : {}),
      entryGz: Bun.gzipSync(JSON.stringify(entry)),
    });
    if (view.kind === 'relation') previous = anchors;
  }
  return out;
}

/** Whether two anchor lists name the same boxes at the same places. */
export function sameAnchors(a: AnchorList | undefined, b: AnchorList | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  return a.every((x, i) => x[0] === b[i]![0] && x[1] === b[i]![1] && x[2] === b[i]![2]);
}

export interface Range {
  readonly from: number;
  readonly to: number;
}

/**
 * Splits the planned views into at most `parts` ranges of about equal
 * cost. A range starts only where the last render left anchors to start
 * from, so a document drawn for the first time is one range.
 */
export function splitRanges(views: readonly PlannedView[], cached: Readonly<Record<string, CachedView>> | undefined, parts: number): Range[] {
  const total = views.reduce((a, v) => a + v.cost, 0);
  if (parts <= 1 || total === 0) return [{ from: 0, to: views.length }];
  const target = total / parts;
  const ranges: Range[] = [];
  let from = 0;
  let acc = 0;
  for (let i = 0; i < views.length; i++) {
    const v = views[i]!;
    const canStart = v.prev === undefined || cached?.[v.prev]?.anchors !== undefined;
    if (i > from && acc >= target && canStart && ranges.length < parts - 1) {
      ranges.push({ from, to: i });
      from = i;
      acc = 0;
    }
    acc += v.cost;
  }
  ranges.push({ from, to: views.length });
  return ranges;
}

/** The stored bundle's text: the shell with each view's id and digest in order. */
export function shellBundle(shell: string, views: readonly Pick<RangeView, 'id' | 'digest'>[]): string {
  return `${shell.slice(0, -1)},"lazy":true,"views":${JSON.stringify(views.map((v) => ({ id: v.id, digest: v.digest })))}}`;
}
