/**
 * The doc views of a model as pages: each one's Markdown read from the
 * view or from its file, rendered once, and checked against the model. A
 * page whose file is missing, or that names a box, a view, a heading, or an attached file that does
 * not exist is an error, the way a relation to an unknown node is: the page
 * would point at nothing. So is a picture path that leaves the document's
 * folder: a page reads only its own document's files.
 */
import { assetRefs, citableRef, type Diagnostic, type Model, type ResolvedView } from '@vantage/model';
import { assetHref, mimeOf, type AssetSource } from './hrefs.ts';
import { renderDoc, type DocPage } from './doc.ts';
import { docCoverage } from './doc-coverage.ts';
import type { Json } from './picture.ts';

type DocView = Extract<ResolvedView, { kind: 'doc' }>;

/** At most this many problems are listed per page; the rest are counted. */
const LISTED = 12;

/** A doc view's Markdown: its own text, or its file. Undefined when the file is missing. */
export function docText(view: DocView, assets: AssetSource | undefined): string | undefined {
  if (view.text !== undefined) return view.text;
  const bytes = view.file !== undefined ? assets?.read(view.file) : undefined;
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

/** Where a file the page embeds is read: beside the document file on disk, or the attachment's own path. */
export function docFileRef(view: DocView, path: string): string {
  return view.dir !== undefined ? `${view.dir.replace(/\/$/, '')}/${path}` : path;
}

/** A doc view's page. With `draw`, its attached pictures are inlined from `assets` as data URLs, so the page stands alone. */
export function docPage(view: DocView, assets: AssetSource | undefined, draw = false): DocPage | undefined {
  const text = docText(view, assets);
  if (text === undefined) return undefined;
  return renderDoc(view.id, text, draw ? (path) => assetHref(docFileRef(view, path), assets) : undefined);
}

/** What a doc view's bundle entry carries beside the fields every view has. */
export function docEntry(view: DocView, assets: AssetSource | undefined): Json {
  const page = docPage(view, assets, true);
  return {
    doc: { html: page?.html ?? '', headings: page?.headings ?? [], nodes: page?.nodes ?? [], figures: page?.figures ?? [], decisions: page?.decisions ?? [] },
    ...(view.beside !== undefined ? { beside: view.beside } : {}),
  };
}

/** Every doc view's page, by view id. */
export function docPages(model: Model, assets: AssetSource | undefined): Map<string, DocPage> {
  const out = new Map<string, DocPage>();
  for (const v of model.views) {
    const page = v.kind === 'doc' ? docPage(v, assets) : undefined;
    if (page) out.set(v.id, page);
  }
  return out;
}

/** The files a model reads: what {@link assetRefs} names, and the files its pages embed. A save keeps these attachments and drops the rest. */
export function documentFiles(model: Model, assets: AssetSource | undefined): string[] {
  const refs = new Set(assetRefs(model));
  for (const v of model.views) {
    if (v.kind !== 'doc') continue;
    for (const path of docPage(v, assets)?.files ?? []) refs.add(docFileRef(v, path));
  }
  return [...refs].sort();
}

/** Boxes, views, headings, and files the pages point at that do not exist, picture paths that leave the document, and how well the pages cover the model. */
export function docDiagnostics(model: Model, assets: AssetSource | undefined): Diagnostic[] {
  const pages = docPages(model, assets);
  const kinds = new Map(model.views.map((v) => [v.id, v.kind]));
  const out: Diagnostic[] = [];
  const views = new Map(model.views.map((v) => [v.id, v]));
  if (assets) {
    for (const v of model.views) {
      if (v.kind !== 'doc' || v.text !== undefined || v.file === undefined || assets.read(v.file) !== undefined) continue;
      out.push({ severity: 'error', code: 'doc-file-missing', message: `page ${v.id} reads ${v.file}, which the document does not carry`, hint: 'Attach the page with the save (pages, path to Markdown), fix the path in `file`, or give the view its text' });
    }
  }
  for (const [id, page] of pages) {
    const found: string[] = [];
    const view = views.get(id) as DocView;
    for (const f of page.files) {
      if (!mimeOf(f)) found.push(`file ${f} (not a picture; use svg, png, jpg, gif, or webp)`);
      else if (assets?.read(docFileRef(view, f)) === undefined) found.push(`file ${f}`);
    }
    if (page.refused.length) {
      out.push({ severity: 'error', code: 'doc-file-outside', message: `page ${id} reads pictures outside its document: ${page.refused.slice(0, LISTED).join(', ')}${page.refused.length > LISTED ? ` and ${page.refused.length - LISTED} more` : ''}`, hint: 'A page embeds a web address or a file attached to its document, by a path inside the document folder (assets/screen.png); no `..`, no leading `/`' });
    }
    for (const n of page.nodes) if (!model.nodes.has(n)) found.push(`box ${n}`);
    for (const d of page.decisions) if (!citableRef(d)) found.push(`decision ${d} (cite it as PREFIX-NNNN or adr:<ULID>)`);
    for (const f of page.figures) if (!kinds.has(f) || kinds.get(f) === 'doc') found.push(`view ${f} as a figure`);
    for (const l of page.links) {
      const kind = kinds.get(l.view);
      if (kind === undefined) found.push(`view ${l.view}`);
      else if (l.kind === 'node' && l.target !== undefined && !model.nodes.has(l.target)) found.push(`box ${l.target} in view ${l.view}`);
      else if (l.kind === 'anchor' && l.target !== undefined && !pages.get(l.view)?.headings.some((h) => h.id === l.target)) found.push(`heading ${l.target} of ${l.view}`);
    }
    if (!found.length) continue;
    const listed = found.slice(0, LISTED).join(', ') + (found.length > LISTED ? ` and ${found.length - LISTED} more` : '');
    out.push({ severity: 'error', code: 'doc-unknown-target', message: `page ${id} points at what does not exist: ${listed}`, hint: 'Name a node id, a view id, a heading anchor, or an attached file that exists, or remove the reference' });
  }
  return [...out, ...docCoverage(model, pages)];
}
