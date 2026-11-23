/**
 * The operations every surface shares: CLI, HTTP API, and MCP all call
 * these. Text in, diagnostics and pictures out.
 */
import { loadModelFromFile, loadModelFromText, documentJsonSchema, pictureViews, type Diagnostic, type DocumentTransform, type Model } from '@vantage/model';
import { exploreLayouts, layoutView, type Layout, type QualityMetrics } from '@vantage/layout';
import { contactSheet, renderSvg, renderPng, buildBundle, standaloneHtml, fontCss, FileAssetSource, FileIconSource, modelResources, resourceDiagnostics, type IconSource, type Resources, type TitleBlock } from '@vantage/render';
import { renderDrawio, renderPdf, renderVsdx, type Orientation, type PageSize } from '@vantage/export';

export type Theme = 'light' | 'dark' | 'print' | 'colorblind';
export type Format = 'svg' | 'png' | 'html' | 'json';
/** Whole-document formats: every view (or a chosen list) in one file. */
export type DocumentFormat = 'pdf' | 'drawio' | 'vsdx';
export type { TitleBlock, PageSize, Orientation, Resources };

export interface Source {
  readonly text?: string | undefined;
  readonly file?: string | undefined;
  /** Rewrites each parsed document before it resolves, for example to lay observed values over it. */
  readonly transform?: DocumentTransform | undefined;
}

export interface ViewReport {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly group?: string;
  /** A part other views extend; skipped by whole-document renders and exports unless named. */
  readonly hidden?: boolean;
  readonly width: number;
  readonly height: number;
  readonly metrics: QualityMetrics;
}

export interface Validation {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly views: readonly ViewReport[];
  readonly nodes: number;
  readonly relations: number;
}

let icons: IconSource | undefined;
/** The shipped icon packs. */
export function defaultIcons(): IconSource {
  icons ??= new FileIconSource();
  return icons;
}

/** Icons and pictures for a model on this machine: its own icons and files from disk, then the shipped packs. */
export function resourcesFor(model: Model): Required<Resources> {
  return modelResources(model, defaultIcons(), new FileAssetSource());
}

export function load(src: Source): { model?: Model; diagnostics: readonly Diagnostic[] } {
  if (src.file) return loadModelFromFile(src.file, src.transform);
  if (src.text !== undefined) return loadModelFromText(src.text, undefined, src.transform);
  return { diagnostics: [{ severity: 'error', code: 'no-source', message: 'provide text or file' }] };
}

export function validate(src: Source): Validation {
  const loaded = load(src);
  const diagnostics = [...loaded.diagnostics];
  const model = loaded.model;
  if (!model) return { ok: false, diagnostics, views: [], nodes: 0, relations: 0 };
  diagnostics.push(...resourceDiagnostics(model, resourcesFor(model)));
  const views: ViewReport[] = [];
  for (const view of model.views) {
    try {
      const layout = layoutView(model, view);
      views.push({ id: view.id, title: view.title, kind: view.kind, ...(view.group !== undefined ? { group: view.group } : {}), ...(view.hidden ? { hidden: true } : {}), width: layout.width, height: layout.height, metrics: layout.metrics });
    } catch (err) {
      diagnostics.push({ severity: 'error', code: 'layout-failed', message: `view ${view.id}: ${(err as Error).message}` });
    }
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics, views, nodes: model.nodes.size, relations: model.relations.length };
}

export interface RenderRequest extends Source {
  readonly view?: string | undefined;
  readonly format?: Format | undefined;
  readonly theme?: Theme | undefined;
  readonly scale?: number | undefined;
  /** Header band above the picture (svg and png). */
  readonly titleBlock?: TitleBlock | undefined;
  /** Leave the canvas unpainted (svg and png), for pasting over other content. */
  readonly transparent?: boolean | undefined;
  /** Inline the Inter faces so the svg looks the same everywhere. */
  readonly embedFonts?: boolean | undefined;
}

export interface RenderResult {
  readonly viewId: string;
  readonly layout: Layout;
  readonly svg: string;
  readonly png?: Uint8Array<ArrayBuffer>;
  readonly html?: string;
}

export function render(req: RenderRequest): { result?: RenderResult; diagnostics: readonly Diagnostic[] } {
  const { model, diagnostics } = load(req);
  if (!model) return { diagnostics };
  return renderModel(model, resourcesFor(model), req, diagnostics);
}

/** What a render or an export draws once its source is loaded: the options, without the text or the file. */
export type DrawOptions<R> = Omit<R, keyof Source>;

/** Draws a loaded model with the icons and pictures it was given: a file's from disk, a saved document's from its hub. */
export function renderModel(model: Model, res: Resources, req: DrawOptions<RenderRequest>, diagnostics: readonly Diagnostic[] = []): { result?: RenderResult; diagnostics: readonly Diagnostic[] } {
  const theme = req.theme ?? (model.theme === 'auto' ? 'light' : model.theme);
  if (req.format === 'html') {
    const bundle = buildBundle(model, { theme, ...res, diagnostics });
    const first = model.views.find((v) => !v.hidden) ?? model.views[0];
    if (!first) return { diagnostics: [...diagnostics, { severity: 'error', code: 'no-views', message: 'the document has no views' }] };
    const layout = layoutView(model, first);
    return { result: { viewId: first.id, layout, svg: '', html: standaloneHtml(bundle) }, diagnostics };
  }
  const view = req.view ? model.views.find((v) => v.id === req.view) : (model.views.find((v) => !v.hidden) ?? model.views[0]);
  if (!view) {
    return { diagnostics: [...diagnostics, { severity: 'error', code: 'unknown-view', message: `no view ${req.view ?? ''}; views: ${model.views.map((v) => v.id).join(', ')}` }] };
  }
  const layout = layoutView(model, view);
  const svg = renderSvg(layout, {
    theme,
    ...res,
    ...(req.titleBlock ? { titleBlock: req.titleBlock } : {}),
    ...(req.transparent ? { background: false } : {}),
    ...(req.embedFonts ? { fontCss: fontCss() } : {}),
  });
  const png = req.format === 'png' ? renderPng(svg, { scale: req.scale ?? 2 }).bytes : undefined;
  return { result: { viewId: view.id, layout, svg, ...(png ? { png } : {}) }, diagnostics };
}

export interface ExportRequest extends Source {
  readonly format: DocumentFormat;
  /** View ids to include, in order; defaults to every view. */
  readonly views?: readonly string[] | undefined;
  readonly theme?: Theme | undefined;
  /** Title block on every page; the subtitle defaults to the view title. `true` fills it from the document. */
  readonly titleBlock?: TitleBlock | true | undefined;
  readonly page?: PageSize | undefined;
  readonly orientation?: Orientation | undefined;
}

export interface ExportResult {
  readonly format: DocumentFormat;
  readonly viewIds: readonly string[];
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
  readonly extension: string;
}

const DOCUMENT_TYPES: Record<DocumentFormat, { contentType: string; extension: string }> = {
  pdf: { contentType: 'application/pdf', extension: 'pdf' },
  drawio: { contentType: 'application/xml', extension: 'drawio' },
  vsdx: { contentType: 'application/vnd.ms-visio.drawing', extension: 'vsdx' },
};

/** The title block for a document, from the request or the document's own metadata. */
export function documentTitleBlock(model: Model, tb: TitleBlock | true | undefined): TitleBlock | undefined {
  if (!tb) return undefined;
  if (tb !== true) return tb;
  return {
    title: model.title,
    ...(model.author ? { author: model.author } : {}),
    ...(model.updated ? { updated: model.updated } : {}),
    published: new Date().toISOString().slice(0, 10),
  };
}

/** Renders a whole document (or the listed views) to one multi-page file. */
export async function exportDocument(req: ExportRequest): Promise<{ result?: ExportResult; diagnostics: readonly Diagnostic[] }> {
  const { model, diagnostics } = load(req);
  if (!model) return { diagnostics };
  return exportModel(model, resourcesFor(model), req, diagnostics);
}

/** Exports a loaded model with the icons and pictures it was given. */
export async function exportModel(model: Model, res: Resources, req: DrawOptions<ExportRequest>, diagnostics: readonly Diagnostic[] = []): Promise<{ result?: ExportResult; diagnostics: readonly Diagnostic[] }> {
  const pictures = pictureViews(model.views);
  const wanted = req.views?.length ? req.views.filter((id) => !model.views.some((v) => v.id === id && v.kind === 'doc')) : pictures.filter((v) => !v.hidden).map((v) => v.id);
  const missing = wanted.filter((id) => !model.views.some((v) => v.id === id));
  if (missing.length) return { diagnostics: [...diagnostics, { severity: 'error', code: 'unknown-view', message: `no view ${missing.join(', ')}; views: ${model.views.map((v) => v.id).join(', ')}` }] };
  if (wanted.length === 0) return { diagnostics: [...diagnostics, { severity: 'error', code: 'no-views', message: 'the document has no views' }] };
  const theme = req.theme ?? (model.theme === 'dark' ? 'dark' : 'light');
  const layouts = wanted.map((id) => layoutView(model, model.views.find((v) => v.id === id)!));
  const block = documentTitleBlock(model, req.titleBlock);
  let bytes: Uint8Array<ArrayBuffer>;
  if (req.format === 'pdf') {
    const pages = layouts.map((layout) => ({ layout, ...(block ? { titleBlock: { ...block, subtitle: block.subtitle ?? layout.title } } : {}) }));
    bytes = await renderPdf(pages, { theme, ...res, title: model.title, ...(model.author ? { author: model.author } : {}), ...(req.page ? { page: req.page } : {}), ...(req.orientation ? { orientation: req.orientation } : {}) });
  } else if (req.format === 'drawio') {
    bytes = new Uint8Array(Buffer.from(renderDrawio(layouts, { theme, ...res }), 'utf8')) as Uint8Array<ArrayBuffer>;
  } else {
    bytes = renderVsdx(layouts, { theme, title: model.title, ...(model.author ? { author: model.author } : {}) });
  }
  return { diagnostics, result: { format: req.format, viewIds: wanted, bytes, ...DOCUMENT_TYPES[req.format] } };
}

export function schema(): Record<string, unknown> {
  return documentJsonSchema();
}

export function searchIcons(query: string, pack?: string, limit = 60): string[] {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  return defaultIcons()
    .list(pack)
    .filter((id) => q.every((t) => id.toLowerCase().includes(t)))
    .slice(0, limit);
}

export interface ExploreRequest extends Source {
  readonly view?: string | undefined;
  readonly theme?: Theme | undefined;
  readonly limit?: number | undefined;
  readonly scale?: number | undefined;
}

export interface ExploreCandidate {
  readonly name: string;
  readonly score: number;
  readonly width: number;
  readonly height: number;
  readonly notes: readonly string[];
  /** YAML the author pastes into the view to get this candidate. */
  readonly yaml: string;
}

export interface ExploreResult {
  readonly viewId: string;
  readonly candidates: readonly ExploreCandidate[];
  readonly svg: string;
  readonly png: Uint8Array<ArrayBuffer>;
}

/** Lays a relation view out several ways and returns one picture with every candidate captioned, plus the hints behind each. */
export function explore(req: ExploreRequest): { result?: ExploreResult; diagnostics: readonly Diagnostic[] } {
  const { model, diagnostics } = load(req);
  if (!model) return { diagnostics };
  return exploreModel(model, resourcesFor(model), req, diagnostics);
}

/** Explores a loaded model with the icons and pictures it was given. */
export function exploreModel(model: Model, res: Resources, req: DrawOptions<ExploreRequest>, diagnostics: readonly Diagnostic[] = []): { result?: ExploreResult; diagnostics: readonly Diagnostic[] } {
  const view = req.view ? model.views.find((v) => v.id === req.view) : model.views.find((v) => v.kind === 'relation' && !v.hidden);
  if (!view || view.kind !== 'relation') {
    return { diagnostics: [...diagnostics, { severity: 'error', code: 'unknown-view', message: `explore needs a relation view; views: ${model.views.filter((v) => v.kind === 'relation').map((v) => v.id).join(', ')}` }] };
  }
  const theme = req.theme ?? (model.theme === 'auto' ? 'light' : model.theme);
  const candidates = exploreLayouts(model, view, req.limit ?? 4);
  const items = candidates.map((c, i) => ({
    svg: renderSvg(c.layout, { theme, ...res }),
    width: c.layout.width,
    height: c.layout.height,
    caption: `${String.fromCharCode(65 + i)}. ${c.name}  (score ${c.score})`,
  }));
  const svg = contactSheet(items, { theme });
  const png = renderPng(svg, { scale: req.scale ?? 1 }).bytes;
  return {
    diagnostics,
    result: {
      viewId: view.id,
      svg,
      png,
      candidates: candidates.map((c) => ({ name: c.name, score: c.score, width: c.layout.width, height: c.layout.height, notes: c.layout.metrics.notes, yaml: hintsYaml(c.hints) })),
    },
  };
}

function hintsYaml(h: { arrange?: readonly Record<string, unknown>[]; collapse?: readonly string[]; direction?: string }): string {
  const lines: string[] = [];
  if (h.direction) lines.push(`direction: ${h.direction}`);
  if (h.collapse?.length) lines.push(`collapse: [${h.collapse.join(', ')}]`);
  if (h.arrange?.length) {
    lines.push('arrange:');
    for (const a of h.arrange) lines.push(`  - { ${Object.entries(a).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')} }`);
  }
  return lines.length ? lines.join('\n') : '(no hints: the view as written)';
}
