/**
 * Drawing a loaded document to one file, whatever it came from: a file on
 * a laptop, text, or a version the hub holds with its imports, pictures,
 * and workspace icons. Every surface that draws calls these, so a saved
 * document draws in every format, theme, and title block a file does.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { pictureViews, type Diagnostic, type Model } from '@vantage/model';
import { exploreModel, exportModel, renderModel, type Orientation, type PageSize, type Resources, type Theme, type TitleBlock } from '@vantage/server';

export type ViewFormat = 'png' | 'svg' | 'pdf' | 'drawio' | 'vsdx';
export type DocumentFormat = 'html' | 'pdf' | 'drawio' | 'vsdx';

/** One view, drawn. pdf, drawio, and vsdx are a one-page document. */
export interface ViewArgs {
  readonly view?: string | undefined;
  readonly format: ViewFormat;
  readonly theme?: Theme | undefined;
  readonly scale?: number | undefined;
  readonly titleBlock?: TitleBlock | undefined;
  readonly transparent?: boolean | undefined;
}

/** The whole document, or the views named, in one file. */
export interface DocumentArgs {
  readonly format: DocumentFormat;
  readonly views?: readonly string[] | undefined;
  readonly theme?: Theme | undefined;
  readonly titleBlock?: TitleBlock | true | undefined;
  readonly page?: PageSize | undefined;
  readonly orientation?: Orientation | undefined;
}

/** One relation view laid out several ways, side by side. */
export interface ExploreArgs {
  readonly view?: string | undefined;
  readonly theme?: Theme | undefined;
  readonly limit?: number | undefined;
}

/** A drawn file: plain data that crosses a thread and a wire. */
export interface Drawn {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly extension: string;
  /** What the file shows: a view's size and score with its notes, or how many views a document holds. */
  readonly notes: string;
  /** The first view drawn, for the file's name. */
  readonly name: string;
}

export type DrawOutcome = { readonly drawn?: Drawn; readonly diagnostics: readonly Diagnostic[] };

const TEXT_TYPES: Readonly<Record<string, string>> = { svg: 'image/svg+xml', drawio: 'application/xml', html: 'text/html' };
const enc = new TextEncoder();

export async function drawView(model: Model, res: Resources, a: ViewArgs, diagnostics: readonly Diagnostic[] = []): Promise<DrawOutcome> {
  if (a.format === 'pdf' || a.format === 'drawio' || a.format === 'vsdx') {
    const first = a.view ?? (pictureViews(model.views).find((v) => !v.hidden) ?? model.views[0])?.id;
    return drawDocument(model, res, { format: a.format, ...(first ? { views: [first] } : {}), theme: a.theme, titleBlock: a.titleBlock }, diagnostics);
  }
  const r = renderModel(model, res, { view: a.view, format: a.format, theme: a.theme, scale: a.scale ?? 1.5, titleBlock: a.titleBlock, transparent: a.transparent, embedFonts: a.format === 'svg' }, diagnostics);
  if (!r.result) return { diagnostics: r.diagnostics };
  const { viewId, layout, svg, png } = r.result;
  const m = layout.metrics;
  const notes = `view ${viewId}: ${layout.width}x${layout.height}, score ${m.score}` + (m.notes.length ? `\n- ${m.notes.join('\n- ')}` : '');
  const bytes = a.format === 'png' ? png! : enc.encode(svg);
  return { drawn: { bytes, contentType: a.format === 'png' ? 'image/png' : TEXT_TYPES['svg']!, extension: a.format, notes, name: viewId }, diagnostics: r.diagnostics };
}

export async function drawDocument(model: Model, res: Resources, a: DocumentArgs, diagnostics: readonly Diagnostic[] = []): Promise<DrawOutcome> {
  if (a.format === 'html') {
    const r = renderModel(model, res, { format: 'html', theme: a.theme }, diagnostics);
    if (!r.result) return { diagnostics: r.diagnostics };
    const views = model.views.filter((v) => !v.hidden).length;
    return { drawn: { bytes: enc.encode(r.result.html!), contentType: TEXT_TYPES['html']!, extension: 'html', notes: `${views} views`, name: r.result.viewId }, diagnostics: r.diagnostics };
  }
  const d = await exportModel(model, res, { format: a.format, views: a.views, theme: a.theme, titleBlock: a.titleBlock, page: a.page, orientation: a.orientation }, diagnostics);
  if (!d.result) return { diagnostics: d.diagnostics };
  const { bytes, contentType, extension, viewIds } = d.result;
  return { drawn: { bytes, contentType, extension, notes: `${viewIds.length} view${viewIds.length === 1 ? '' : 's'}, ${bytes.byteLength} bytes`, name: viewIds[0] ?? 'view' }, diagnostics: d.diagnostics };
}

/** The candidates on one contact sheet, each with its score, its notes, and the hints to paste into the view. */
export function drawExplore(model: Model, res: Resources, a: ExploreArgs, diagnostics: readonly Diagnostic[] = []): DrawOutcome {
  const r = exploreModel(model, res, { view: a.view, theme: a.theme, limit: a.limit }, diagnostics);
  if (!r.result) return { diagnostics: r.diagnostics };
  const notes = r.result.candidates
    .map((c, i) => `${String.fromCharCode(65 + i)}. ${c.name}: score ${c.score}, ${c.width}x${c.height}${c.notes.length ? `\n   notes: ${c.notes.join('; ')}` : ''}\n   hints:\n${c.yaml.split('\n').map((l) => `     ${l}`).join('\n')}`)
    .join('\n');
  return { drawn: { bytes: r.result.png, contentType: 'image/png', extension: 'png', notes, name: r.result.viewId }, diagnostics: r.diagnostics };
}

/** Whether a format's file is text an agent can read in the answer. */
export const isText = (extension: string): boolean => extension === 'svg' || extension === 'drawio';

/** What a tool answers: text for the model, a picture, or a file as a resource. */
export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } | { uri: string; mimeType: string; text: string } };

/** A drawn file as a tool answers it: the file first, then its notes. A PNG is a picture, svg and drawio are text, the rest a file. */
export function drawnContent(d: Drawn): Content[] {
  const notes: Content = { type: 'text', text: d.notes };
  if (d.extension === 'png') return [{ type: 'image', data: Buffer.from(d.bytes).toString('base64'), mimeType: d.contentType }, notes];
  // A drawn file is a resource, never answer text: the size limit on answers (VAN-0002) bounds what the model is told, not the file it asked for.
  const uri = `vantage://${d.name}.${d.extension}`;
  if (isText(d.extension)) return [{ type: 'resource', resource: { uri, mimeType: d.contentType, text: new TextDecoder().decode(d.bytes) } }, notes];
  return [{ type: 'resource', resource: { uri, mimeType: d.contentType, blob: Buffer.from(d.bytes).toString('base64') } }, notes];
}

/** The drawn file back out of a tool's answer: the inverse of `drawnContent`, for a door that writes it to a path. */
export function drawnFrom(content: CallToolResult['content'], extension: string): Drawn | undefined {
  const [file, ...rest] = content;
  const notes = rest.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  const drawn = (bytes: Uint8Array, contentType: string): Drawn => ({ bytes, contentType, extension, notes, name: 'view' });
  if (file?.type === 'image') return drawn(Buffer.from(file.data, 'base64'), file.mimeType);
  if (file?.type === 'resource' && 'blob' in file.resource) return drawn(Buffer.from(file.resource.blob, 'base64'), file.resource.mimeType ?? 'application/octet-stream');
  if (file?.type === 'resource' && 'text' in file.resource && isText(extension)) return drawn(enc.encode(file.resource.text), file.resource.mimeType ?? TEXT_TYPES[extension]!);
  if (file?.type === 'text' && isText(extension)) return drawn(enc.encode(file.text), TEXT_TYPES[extension]!);
  return undefined;
}
