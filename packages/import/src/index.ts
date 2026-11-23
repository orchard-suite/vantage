/**
 * @vantage/import: draw.io, Visio, and Lucidchart (through VSDX) pictures
 * to a Vantage document. The drawing's geometry becomes pins, its text
 * becomes nodes, its connectors become relations, and the gestures it
 * suggests become hints the author reviews. Ilograph, Mermaid, and
 * PlantUML have no geometry; their views are laid out by the engine.
 */
import { DocumentSchema, loadModelFromText, type Diagnostic, type Document, type DocumentInput, type NodeInput, type RelationInput } from '@vantage/model';
import { Document as YamlDocument, isMap, isScalar, isSeq, visit } from 'yaml';
import { buildPage, IdPool, type PageReport } from './build.ts';
import type { Drawing } from './drawing.ts';
import { isDrawio, readDrawio } from './drawio.ts';
import { mergePages, type PageParts } from './merge.ts';
import { isVsdx, readVsdx } from './vsdx.ts';
import { importIlograph } from './ilograph.ts';
import { Pictures } from './pictures.ts';
import { applyTypes, type Guess } from './guess.ts';
import { importTextDiagrams, type TextFormat } from './text-import.ts';

export type ImportFormat = 'drawio' | 'vsdx' | 'ilograph' | TextFormat;

/** Extensions of the text formats, by format. */
const TEXT_EXTENSIONS: Readonly<Record<string, TextFormat>> = { mmd: 'mermaid', mermaid: 'mermaid', puml: 'plantuml', plantuml: 'plantuml', pu: 'plantuml', iuml: 'plantuml', md: 'markdown', markdown: 'markdown' };

/** Every extension `importDiagram` reads. */
export const IMPORT_EXTENSIONS: readonly string[] = ['drawio', 'xml', 'vsdx', 'ilograph', ...Object.keys(TEXT_EXTENSIONS)];

export interface ImportOptions {
  readonly filename: string;
  /** Import only this page (zero based); default every page. */
  readonly pageIndex?: number | undefined;
  /** Reads a file named relative to the input (Ilograph libraries); undefined when it cannot be found. */
  readonly readRelative?: ((path: string) => string | undefined) | undefined;
  /** Maps a foreign icon reference (an Ilograph icon path, a draw.io vendor stencil as `<vendor>/<category>/<Name>`) to one of our icon ids. */
  readonly iconResolver?: ((hint: string) => string | undefined) | undefined;
  /** keep (default): boxes stay where the drawing put them. auto: no pins, so Vantage lays every view out. */
  readonly layout?: 'keep' | 'auto' | undefined;
  /** Give untyped boxes a type read from their label and shape (default off). */
  readonly guessTypes?: boolean | undefined;
  /** Box id to type, over the guesses; an empty string leaves that box untyped. */
  readonly types?: Readonly<Record<string, string>> | undefined;
}

/** What became of every picture in the drawing. */
export interface PictureReport {
  /** Vendor library icons matched to our ids. */
  readonly matched: readonly string[];
  /** Embedded pictures written as files beside the document. */
  readonly kept: readonly string[];
  /** Pictures that could not be matched or drawn. */
  readonly missed: readonly string[];
}

export interface ImportReport {
  readonly filename: string;
  readonly format: ImportFormat;
  readonly pages: readonly PageReport[];
  readonly counts: {
    readonly shapes: number;
    readonly edges: number;
    readonly nodes: number;
    readonly containers: number;
    readonly relations: number;
    readonly dropped: number;
    /** Boxes that repeated across pages and became one node. */
    readonly merged: number;
  };
  readonly hints: readonly string[];
  /** One line per node kept once although several pages drew it. */
  readonly merged: readonly string[];
  readonly unmappedStyles: readonly string[];
  readonly warnings: readonly string[];
  readonly pictures: PictureReport;
  /** Diagnostics from loading the produced document; empty when it is clean. */
  readonly diagnostics: readonly Diagnostic[];
  /** Name the caller should give the kept copy of the input, for the hub to attach as the reference picture. */
  readonly originalName: string;
  /** Boxes given a type by guessTypes or types, in document order. */
  readonly typed: readonly Guess[];
  /** How the views will be laid out. */
  readonly layout: 'keep' | 'auto';
}

export interface ImportResult {
  readonly document: Document;
  readonly yaml: string;
  readonly report: ImportReport;
  /** Files the document names (pictures and icons), by path relative to it; write them beside it. */
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

export function detectFormat(bytes: Uint8Array, filename: string): ImportFormat {
  if (isVsdx(bytes)) return 'vsdx';
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'ilograph') return 'ilograph';
  const text = TEXT_EXTENSIONS[ext];
  if (text) return text;
  if (ext === 'vsdx') throw new Error(`${filename} has a .vsdx extension but is not a zip`);
  const head = Buffer.from(bytes.subarray(0, 4000)).toString('utf8');
  if (isDrawio(head)) return 'drawio';
  if (ext === 'drawio' || ext === 'xml') throw new Error(`${filename} does not hold an mxfile or mxGraphModel`);
  if (/^\s*@startuml\b/.test(head)) return 'plantuml';
  if (/^\s*(---\n[\s\S]*?\n---\s*\n)?\s*(flowchart|graph|sequenceDiagram|C4\w+|erDiagram)\b/.test(head)) return 'mermaid';
  throw new Error(`${filename}: not a draw.io file, a vsdx package, an Ilograph file, or Mermaid or PlantUML text`);
}

export function readDrawing(bytes: Uint8Array, filename: string): { drawing: Drawing; format: ImportFormat } {
  const format = detectFormat(bytes, filename);
  return { format, drawing: format === 'vsdx' ? readVsdx(bytes) : readDrawio(Buffer.from(bytes).toString('utf8')) };
}

function baseName(filename: string): string {
  return filename.replace(/^.*[\\/]/, '').replace(new RegExp(`\\.(${IMPORT_EXTENSIONS.join('|')})$`, 'i'), '');
}

/** Pin rectangles and waypoints as flow maps, so the pins block stays one line per node. */
function toYaml(doc: DocumentInput): string {
  const y = new YamlDocument(doc);
  visit(y, {
    Map(_, node) {
      const numeric = node.items.every((p) => isScalar(p.value) && typeof p.value.value === 'number');
      if (numeric && node.items.length > 0 && node.items.length <= 4) node.flow = true;
    },
    Seq(_, node) {
      if (node.items.length && node.items.every((i) => isMap(i) && i.flow) && isSeq(node)) node.flow = true;
    },
  });
  return y.toString({ lineWidth: 0 });
}

export function importDiagram(bytes: Uint8Array, opts: ImportOptions): ImportResult {
  const detected = detectFormat(bytes, opts.filename);
  if (detected === 'ilograph') return importIlographFile(bytes, opts);
  if (detected === 'mermaid' || detected === 'plantuml' || detected === 'markdown') return importTextFile(bytes, opts, detected);
  const { drawing, format } = readDrawing(bytes, opts.filename);
  const pages = opts.pageIndex === undefined ? drawing.pages : drawing.pages.filter((_, i) => i === opts.pageIndex);
  if (!pages.length) throw new Error(opts.pageIndex === undefined ? `${opts.filename} has no pages` : `${opts.filename} has no page ${opts.pageIndex}; it has ${drawing.pages.length}`);
  const ids = new IdPool(), viewIds = new IdPool();
  const pictures = new Pictures(opts.iconResolver);
  const parts: PageParts[] = [];
  const reports: PageReport[] = [];
  for (const page of pages) {
    const index = drawing.pages.indexOf(page);
    const built = buildPage(page, index, ids, viewIds, drawing.warnings.filter((w) => w.startsWith(`page ${page.name}:`)), pictures);
    parts.push({ nodes: built.nodes, relations: built.relations, view: built.view });
    reports.push(built.report);
  }
  const merged = mergePages(parts);
  const { nodes, relations } = merged;
  const typed = opts.guessTypes || opts.types ? applyTypes(nodes as NodeInput[], opts.types ?? {}) : [];
  const layout = opts.layout ?? 'keep';
  // Without pins every view goes to the layout engine; arrangement hints and highlights stay.
  const views = layout === 'auto' ? merged.views.map((v) => { const { pins: _pins, ...rest } = v as typeof v & { pins?: unknown }; return rest as typeof v; }) : merged.views;
  const title = baseName(opts.filename);
  const icons = Object.keys(pictures.icons).length ? { icons: pictures.icons } : {};
  const input: DocumentInput = { vantage: 1, title, description: `Imported from ${opts.filename} (${format}).`, ...icons, nodes, ...(relations.length ? { relations } : {}), views };
  const yaml = toYaml(input);
  const loaded = loadModelFromText(yaml, `${title}.vantage.yaml`);
  const document = DocumentSchema.parse(input);
  const sum = (f: (p: PageReport) => number): number => reports.reduce((s, p) => s + f(p), 0);
  const ext = opts.filename.toLowerCase().split('.').pop() ?? format;
  const report: ImportReport = {
    filename: opts.filename,
    format,
    pages: reports,
    counts: { shapes: sum((p) => p.shapes), edges: sum((p) => p.edges), nodes: countNodes(nodes), containers: sum((p) => p.containers), relations: relations.length, dropped: sum((p) => p.dropped.length), merged: merged.notes.length },
    hints: reports.flatMap((p) => (reports.length > 1 ? p.hints.map((h) => `${p.name}: ${h}`) : p.hints)),
    merged: merged.notes,
    unmappedStyles: [...new Set(reports.flatMap((p) => p.unmappedStyles))],
    warnings: [...new Set(drawing.warnings)],
    pictures: pictureReport(pictures),
    diagnostics: loaded.diagnostics,
    originalName: `${title}.original.${ext}`,
    typed,
    layout,
  };
  return { document, yaml, report, assets: pictures.files };
}

/** Ilograph has no geometry, so the result has no pins: a model and views, laid out by the engine. */
function importIlographFile(bytes: Uint8Array, opts: ImportOptions): ImportResult {
  const matched: string[] = [], missed: string[] = [];
  const iconResolver = (hint: string): string | undefined => {
    const id = opts.iconResolver?.(hint);
    if (id !== undefined) matched.push(`${hint} as ${id}`);
    else missed.push(`no icon matched ${hint}`);
    return id;
  };
  const r = importIlograph(Buffer.from(bytes).toString('utf8'), { filename: opts.filename, readRelative: opts.readRelative, iconResolver });
  const yaml = toYaml(r.input);
  const title = String(r.input.title ?? 'imported');
  const loaded = loadModelFromText(yaml, `${title}.vantage.yaml`);
  const document = DocumentSchema.parse(r.input);
  const report: ImportReport = {
    filename: opts.filename,
    format: 'ilograph',
    pages: r.pages,
    counts: { shapes: 0, edges: r.counts.relations, nodes: r.counts.nodes, containers: r.counts.containers, relations: r.counts.relations, dropped: r.counts.dropped, merged: 0 },
    hints: r.hints,
    merged: [],
    unmappedStyles: [],
    warnings: [...new Set(r.warnings)],
    pictures: { matched: [...new Set(matched)], kept: [], missed: [...new Set(missed)] },
    diagnostics: loaded.diagnostics,
    originalName: `${title}.original.ilograph`,
    typed: [],
    layout: 'auto',
  };
  return { document, yaml, report, assets: {} };
}

/** Mermaid and PlantUML have no geometry either: nodes and views, laid out by the engine. */
function importTextFile(bytes: Uint8Array, opts: ImportOptions, format: TextFormat): ImportResult {
  const title = baseName(opts.filename);
  const r = importTextDiagrams(Buffer.from(bytes).toString('utf8'), opts.filename, format, title);
  const yaml = toYaml(r.input);
  const loaded = loadModelFromText(yaml, `${title}.vantage.yaml`);
  const document = DocumentSchema.parse(r.input);
  const ext = opts.filename.toLowerCase().split('.').pop() ?? format;
  const report: ImportReport = {
    filename: opts.filename,
    format,
    pages: r.pages,
    counts: { ...r.counts, merged: r.merged.length },
    hints: r.hints,
    merged: r.merged,
    unmappedStyles: [],
    warnings: [...new Set(r.warnings)],
    pictures: { matched: [], kept: [], missed: [] },
    diagnostics: loaded.diagnostics,
    originalName: `${title}.original.${ext}`,
    typed: [],
    layout: 'auto',
  };
  return { document, yaml, report, assets: {} };
}

function pictureReport(p: Pictures): PictureReport {
  return { matched: [...new Set(p.matched)], kept: p.kept, missed: [...new Set(p.missed)] };
}

function countNodes(nodes: readonly NodeInput[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children ?? []), 0);
}

/** The report as the lines a CLI prints or an agent reads. */
export function formatReport(r: ImportReport, limit = 40): string {
  const lines: string[] = [`${r.filename} (${r.format}): ${r.pages.length} page${r.pages.length === 1 ? '' : 's'}`];
  for (const p of r.pages) lines.push(`  ${p.name}: ${p.shapes} shapes, ${p.edges} connectors -> ${p.nodes} nodes (${p.containers} containers), ${p.relations} relations, ${p.dropped.length} dropped`);
  lines.push(`nodes ${r.counts.nodes}, containers ${r.counts.containers}, relations ${r.counts.relations}, dropped ${r.counts.dropped}${r.counts.merged ? `, ${r.counts.merged} repeated across pages and kept once` : ''}`);
  const section = (title: string, items: readonly string[]): void => {
    if (!items.length) return;
    lines.push(`${title}:`);
    for (const i of items.slice(0, limit)) lines.push(`  - ${i}`);
    if (items.length > limit) lines.push(`  ... ${items.length - limit} more`);
  };
  section('hints to review', r.hints);
  section('kept once', r.merged);
  section('dropped', r.pages.flatMap((p) => (r.pages.length > 1 ? p.dropped.map((d) => `${p.name}: ${d}`) : p.dropped)));
  section('vendor icons matched', r.pictures.matched);
  section('pictures kept as files', r.pictures.kept);
  section('pictures not kept', r.pictures.missed);
  section('unmapped styles', r.unmappedStyles);
  section('warnings', r.warnings);
  section('diagnostics', r.diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`));
  lines.push(`keep the original beside the document as ${r.originalName}`);
  return lines.join('\n');
}

export { readDrawio } from './drawio.ts';
export { readVsdx } from './vsdx.ts';
export { importIlograph, list } from './ilograph.ts';
export { diagramBlocks, hasDiagramBlocks } from './markdown-blocks.ts';
export { drawioIconHint, iconWords, matchIconId } from './icons.ts';
export type { Drawing, RawPage, RawShape, RawEdge } from './drawing.ts';
export type { PageReport } from './build.ts';
export { guessType, applyTypes, type Guess } from './guess.ts';
