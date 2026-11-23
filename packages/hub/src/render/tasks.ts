/**
 * Every piece of CPU-bound drawing the hub does, as named tasks over plain
 * data. The render pool runs them on threads so no request and no job
 * waits behind a layout; with no threads it runs them in place.
 */
import { diffLayouts, driftLayout, layoutView, type DriftInput, type LayoutChange } from '@vantage/layout';
import { docPages, kitForView, renderPng, renderSvg, resourceDiagnostics, standaloneHtml, viewBundle, type Json, type LayoutKit, type RefreshOptions } from '@vantage/render';
import { emptyObserved, expandObserved, type ObservedModel } from '@vantage/connectors';
import { loadOverlaid, loadStored, type ImportMap } from '../documents/model.ts';
import { drawRange, kitOf, planDocument, type DocumentInput, type PlanInput, type PlanOutput, type RangeInput, type RangeView } from './document-task.ts';
import { viewSvg, type ViewSvgInput } from './view-svg.ts';
import { NO_RESOURCES, resourcesFrom, type ResourceData } from './resources.ts';
import { inlineEngine, type LocalEngine } from '@vantage/mcp';
import { produce, type ProduceInput, type ProduceOutput } from './produce-task.ts';
import { reviewDocument, type ReviewInput, type ReviewOutput } from './review-task.ts';
import { checkPush, type PushInput, type PushOutput } from './push-task.ts';

export interface StoredText {
  readonly yaml: string;
  readonly imports: ImportMap;
}

export type Theme = 'light' | 'dark';

export interface DriftViewInput extends StoredText {
  readonly observed: ObservedModel;
  readonly resources: ResourceData;
  readonly viewId?: string | undefined;
  readonly items: readonly DriftInput[];
}

export type DriftViewOutput =
  | { readonly ok: true; readonly viewId: string; readonly svg: string; readonly sentences: readonly string[]; readonly counts: { missing: number; undeclared: number; mismatched: number } }
  | { readonly ok: false; readonly reason: 'unparsable'; readonly issues: readonly string[] }
  | { readonly ok: false; readonly reason: 'no-view'; readonly viewId?: string | undefined };

export interface DiffInput {
  readonly from: StoredText;
  readonly to: StoredText;
  readonly resources: ResourceData;
  readonly viewId: string;
  readonly theme: Theme;
}

export type DiffOutput = { readonly ok: true; readonly svg: string; readonly changes: readonly LayoutChange[] } | { readonly ok: false; readonly reason: 'unparsable' | 'no-view' };

export interface PreviewInput {
  readonly yaml: string;
  /** The files a saved document imports, for an edit of one. */
  readonly imports?: ImportMap | undefined;
  /** The saved document's pictures and its workspace's icons. */
  readonly resources?: ResourceData | undefined;
  readonly view?: string | undefined;
  readonly theme: Theme;
  /** Also answer the view as the viewer's stage takes it: the picture without a page background, its boxes, and its story. */
  readonly entry?: boolean | undefined;
}

export interface PreviewOutput {
  /** With `entry`, the same picture the entry carries, without a page background. */
  readonly svg: string | null;
  readonly view: string | null;
  readonly views: readonly { id: string; title: string }[];
  /** `line` is in the root file; problems in an imported file carry none. */
  readonly diagnostics: readonly { severity: string; message: string; path?: string; line?: number }[];
  readonly metrics: { readonly score: number; readonly notes: readonly string[] } | null;
  readonly entry: Json | null;
}


export interface Tasks {
  plan: [PlanInput, PlanOutput];
  range: [RangeInput, RangeView[]];
  /** A version's layout kit, for a viewer that draws ahead of the hub. */
  kit: [DocumentInput, string | undefined];
  /** One view's standalone SVG, drawn on first request. */
  viewSvg: [ViewSvgInput, string | undefined];
  png: [{ readonly svg: string; readonly scale?: number }, Uint8Array];
  /** A stored bundle (JSON text) cut to one view, its own and its layout kit's, with `extra` fields laid over. */
  oneView: [{ readonly bundle: string; readonly view: string; readonly extra?: Json }, string];
  html: [{ readonly bundle: string; readonly refresh?: RefreshOptions }, string];
  driftView: [DriftViewInput, DriftViewOutput];
  diff: [DiffInput, DiffOutput];
  preview: [PreviewInput, PreviewOutput];
  check: [CheckInput, CheckOutput];
  /** The hub's local MCP tools, one task each. */
  localRender: [Parameters<LocalEngine['render']>[0], Awaited<ReturnType<LocalEngine['render']>>];
  localExplore: [Parameters<LocalEngine['explore']>[0], Awaited<ReturnType<LocalEngine['explore']>>];
  localValidate: [Parameters<LocalEngine['validate']>[0], Awaited<ReturnType<LocalEngine['validate']>>];
  localExport: [Parameters<LocalEngine['exportDocument']>[0], Awaited<ReturnType<LocalEngine['exportDocument']>>];
  produce: [ProduceInput, ProduceOutput];
  review: [ReviewInput, ReviewOutput];
  push: [PushInput, PushOutput];
}

export type TaskKind = keyof Tasks;
export type TaskInput<K extends TaskKind> = Tasks[K][0];
export type TaskOutput<K extends TaskKind> = Tasks[K][1];

function oneView(input: TaskInput<'oneView'>): string {
  const b = JSON.parse(input.bundle) as Json;
  const views = (b['views'] as Json[]).filter((v) => v['id'] === input.view);
  // A walkthrough plays over a relation view the kit holds by the base view's id.
  const base = String(views[0]?.['baseView'] ?? input.view);
  const kit = b['kit'] ? { kit: kitForView(b['kit'] as LayoutKit, base) } : {};
  return JSON.stringify({ ...b, views, ...kit, ...(input.extra ?? {}) });
}

function driftView(input: DriftViewInput): DriftViewOutput {
  const { model, declared, diagnostics } = loadOverlaid(input, input.observed);
  if (!model || !declared) return { ok: false, reason: 'unparsable', issues: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message) };
  const view = input.viewId ? model.views.find((v) => v.id === input.viewId) : model.views[0];
  if (!view) return { ok: false, reason: 'no-view', viewId: input.viewId };
  const out = driftLayout(layoutView(model, view), input.items);
  const svg = renderSvg(out.layout, { theme: model.theme === 'dark' ? 'dark' : 'light', ...resourcesFrom(model, input.resources) });
  return { ok: true, viewId: view.id, svg, sentences: out.sentences, counts: out.counts };
}

function diff(input: DiffInput): DiffOutput {
  const a = loadStored(input.from.yaml, input.from.imports).model;
  const b = loadStored(input.to.yaml, input.to.imports).model;
  if (!a || !b) return { ok: false, reason: 'unparsable' };
  const va = a.views.find((v) => v.id === input.viewId);
  const vb = b.views.find((v) => v.id === input.viewId);
  if (!va || !vb) return { ok: false, reason: 'no-view' };
  const d = diffLayouts(layoutView(a, va), layoutView(b, vb));
  return { ok: true, svg: renderSvg(d.layout, { theme: input.theme, ...resourcesFrom(b, input.resources) }), changes: d.changes };
}

const DRAFT_FILE = 'document.vantage.yaml';

function preview(input: PreviewInput): PreviewOutput {
  const loaded = loadStored(input.yaml, input.imports ?? {}, DRAFT_FILE);
  const model = loaded.model;
  const diagnostics = loaded.diagnostics.map((d) => ({ severity: d.severity, message: d.message, ...(d.path ? { path: d.path } : {}), ...(d.line !== undefined && (d.file === undefined || d.file === DRAFT_FILE) ? { line: d.line } : {}) }));
  const views = (model?.views ?? []).filter((v) => !v.hidden).map((v) => ({ id: v.id, title: v.title ?? v.id }));
  const view = model ? (model.views.find((v) => v.id === input.view) ?? model.views.find((v) => !v.hidden) ?? model.views[0]) : undefined;
  const none = { svg: null, view: null, views, diagnostics, metrics: null, entry: null };
  if (!model || !view) return model && !view ? { ...none, diagnostics: [...diagnostics, { severity: 'error', message: 'the document has no views' }] } : none;
  try {
    const layout = layoutView(model, view);
    const res = resourcesFrom(model, input.resources ?? NO_RESOURCES);
    const svg = renderSvg(layout, { theme: input.theme, ...res, ...(input.entry ? { background: false } : {}) });
    const metrics = { score: layout.metrics.score, notes: layout.metrics.notes };
    return { svg, view: view.id, views, diagnostics, metrics, entry: input.entry ? viewBundle(model, view, layout, svg, res.assets) : null };
  } catch (err) {
    return { ...none, diagnostics: [...diagnostics, { severity: 'error', message: `view ${view.id} could not be laid out: ${(err as Error).message}` }] };
  }
}

export interface CheckInput {
  readonly yaml: string;
  readonly imports?: ImportMap | undefined;
  /** The document's files as the checked version would hold them, and its workspace's icons. */
  readonly resources?: ResourceData | undefined;
  /** Also lay every view out and answer its score and notes. */
  readonly scores?: boolean | undefined;
}

/** One problem a check found: its stable code, what is wrong, and where. */
export interface Finding {
  readonly code: string;
  readonly message: string;
  /** Path inside the YAML, such as `nodes[0].type`. */
  readonly path?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  /** What to do about it. */
  readonly hint?: string;
}

export interface CheckOutput {
  /** What must be fixed, and what every save refuses: text that does not parse, unknown types, and names of boxes, views, files, or headings that do not exist. */
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  /** What a reviewer should look at and no save refuses: how well the pages cover the model. */
  readonly notes: readonly Finding[];
  readonly views: readonly { readonly id: string; readonly title: string; readonly kind: string; readonly score?: number; readonly notes?: readonly string[] }[];
  /** Decision records the boxes and pages cite, as written, each once; the hub checks they exist. */
  readonly decisions: readonly string[];
}

/**
 * A document checked whole, pages and all, without saving or drawing it.
 * Its observe blocks add their views as a render does, with nothing
 * observed, so a page may link a live view whatever its source holds now.
 */
function check(input: CheckInput): CheckOutput {
  const none = emptyObserved();
  const loaded = loadStored(input.yaml, input.imports ?? {}, undefined, (d) => expandObserved(d, none));
  const model = loaded.model;
  const res = model ? resourcesFrom(model, input.resources ?? NO_RESOURCES) : undefined;
  const all = [...loaded.diagnostics, ...(model && res ? resourceDiagnostics(model, res) : [])];
  const say = ({ severity: _, ...finding }: (typeof all)[number]): Finding => finding;
  const errors = all.filter((d) => d.severity === 'error').map(say);
  const views = (model?.views ?? []).map((v) => {
    const head = { id: v.id, title: v.title, kind: v.kind };
    if (!input.scores || !model || v.kind === 'doc') return head;
    try {
      const m = layoutView(model, v).metrics;
      return { ...head, score: m.score, notes: m.notes };
    } catch (err) {
      errors.push({ code: 'layout-failed', message: `view ${v.id} could not be laid out: ${(err as Error).message}` });
      return head;
    }
  });
  const cited = new Set<string>();
  if (model && res) {
    for (const n of model.nodes.values()) for (const d of n.decisions ?? []) cited.add(d);
    for (const page of docPages(model, res.assets).values()) for (const d of page.decisions) cited.add(d);
  }
  return { errors, warnings: all.filter((d) => d.severity === 'warning').map(say), notes: all.filter((d) => d.severity === 'info').map(say), views, decisions: [...cited] };
}

const RUNNERS: { [K in TaskKind]: (input: TaskInput<K>) => TaskOutput<K> | Promise<TaskOutput<K>> } = {
  plan: planDocument,
  range: drawRange,
  kit: kitOf,
  viewSvg,
  png: (i) => renderPng(i.svg, { scale: i.scale ?? 2 }).bytes,
  oneView,
  html: (i) => standaloneHtml(JSON.parse(i.bundle) as Json, i.refresh ? { refresh: i.refresh } : {}),
  driftView,
  diff,
  preview,
  check,
  localRender: (i) => inlineEngine.render(i),
  localExplore: (i) => inlineEngine.explore(i),
  localValidate: (i) => inlineEngine.validate(i),
  localExport: (i) => inlineEngine.exportDocument(i),
  produce,
  review: reviewDocument,
  push: checkPush,
};

export async function runTask<K extends TaskKind>(kind: K, input: TaskInput<K>): Promise<TaskOutput<K>> {
  const runner = RUNNERS[kind] as (input: TaskInput<K>) => TaskOutput<K> | Promise<TaskOutput<K>>;
  if (!runner) throw new Error(`unknown render task ${String(kind)}`);
  return runner(input);
}
