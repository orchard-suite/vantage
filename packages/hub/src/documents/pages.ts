/**
 * The pages of a document: the Markdown files its doc views read. A save
 * brings pages as text. When the head moved since the version the caller
 * read, a page both sides changed is merged line by line, the way the YAML
 * is, so a person's edit and an agent's rewrite of other lines both land;
 * lines both changed are a conflict the caller gets back to settle.
 */
import type { AppContext } from '../context.ts';
import { sha256Bytes } from '../crypto.ts';
import { badRequest } from '../http.ts';
import { assetKey, storeAssets, type Attachment } from './assets.ts';
import { mergeText, unifiedDiff } from './merge.ts';
import type { VersionRow } from './repo.ts';

const PAGE = /\.md$/i;

/** The line a page read starts with, naming the version it came from; never part of the page. */
const PAGE_HEADER = /^<!-- version: \S+ page: \S+ -->\r?\n/;

/** A page as a read hands it over: the version it came from on the first line, then the Markdown. */
export function pageWithHeader(versionId: string, path: string, body: string): string {
  return `<!-- version: ${versionId} page: ${path} -->\n${body}`;
}

/** A page as stored: without the version line a read put on top, so text read and sent back stays the same. Every such line at the top goes, which also mends a page saved with them before. */
export function withoutPageHeader(text: string): string {
  let out = text;
  while (PAGE_HEADER.test(out)) out = out.replace(PAGE_HEADER, '');
  return out;
}

/** What a save's files come to: the attachments to lay over the head's, or the page two sides both changed. */
export type FilesResult = { readonly attachments: Attachment[] } | { readonly conflict: { readonly path: string; readonly diff: string; readonly preview: string; readonly conflicts: number } };

/** Settles a save's files against the version it was read from and the head it lands on; `base` is set only when the head moved. */
export type FileMerge = (state: { readonly base: VersionRow | undefined; readonly head: VersionRow | undefined }) => Promise<FilesResult>;

/** `{ path: Markdown }` from a request as files, each without the version line a read put on it. Throws 400 on a path that is not a page. */
export function pageFiles(pages: Readonly<Record<string, string>> | undefined): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(pages ?? {})) {
    if (!PAGE.test(path)) throw badRequest(`${path} is not a page; a page is a .md file`);
    out[path] = new TextEncoder().encode(withoutPageHeader(text));
  }
  return out;
}

/** One page of a version as text; undefined when the version has no such page. */
export async function readPage(ctx: AppContext, version: Pick<VersionRow, 'org_id' | 'attachments'>, path: string): Promise<string | undefined> {
  const a = version.attachments.find((x) => x.path === path);
  const bytes = a && PAGE.test(path) ? await ctx.blob.get(assetKey(version.org_id, a.hash)) : undefined;
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

/** The files a save brings, stored, with each page merged into the head's when both changed it. */
export function incomingFiles(ctx: AppContext, orgId: string, files: Readonly<Record<string, Uint8Array>>): FileMerge {
  return async ({ base, head }) => {
    const out: Record<string, Uint8Array> = { ...files };
    for (const [path, data] of Object.entries(files)) {
      if (!PAGE.test(path) || !base || !head) continue;
      const was = base.attachments.find((a) => a.path === path);
      const now = head.attachments.find((a) => a.path === path);
      // Only a page the head changed since the caller read it needs merging.
      if (!now || now.hash === was?.hash) continue;
      if ((await sha256Bytes(data)) === was?.hash) {
        delete out[path];
        continue;
      }
      const [baseText, headText] = [was ? ((await readPage(ctx, base, path)) ?? '') : '', (await readPage(ctx, head, path)) ?? ''];
      const m = mergeText(baseText, headText, new TextDecoder().decode(data));
      if (!m.ok) {
        ctx.log.warn('save.page.conflict', { path, head: head.id, expected: base.id, conflicts: m.conflicts });
        return { conflict: { path, diff: unifiedDiff(`${path} at version ${base.id}`, baseText, `${path} at version ${head.id}`, headText), preview: m.preview, conflicts: m.conflicts } };
      }
      out[path] = new TextEncoder().encode(m.text);
      ctx.log.info('save.page.merged', { path, head: head.id, expected: base.id });
    }
    return { attachments: await storeAssets(ctx, orgId, out) };
  };
}

/** The text of a version's pages for the search index: headings whole, bodies up to a bound, so a long specification stays findable by its item titles. */
export function pagesSearchText(files: Readonly<Record<string, Uint8Array>>, bodyBytes = 300_000): string {
  const headings: string[] = [];
  const bodies: string[] = [];
  let room = bodyBytes;
  for (const [path, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!PAGE.test(path)) continue;
    const text = new TextDecoder().decode(data);
    for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) headings.push(m[1]!.replace(/\s*\{#[^}]+\}\s*$/, ''));
    if (room > 0) {
      bodies.push(text.slice(0, room));
      room -= text.length;
    }
  }
  return [...headings, ...bodies].join('\n');
}
