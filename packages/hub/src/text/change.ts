/**
 * The two verbs that change things. Patch swaps exact strings or sets YAML
 * by path, on the text as it stands. Write takes whole texts. Both end in
 * the same commit: a document and its pages save as one version through
 * saveDocument, and a record through the decision service, so the strict
 * save, the citation index, and the audit entry hold for every door.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import type { Surface } from '../audit.ts';
import { applyEdits, EditOperationSchema } from '../documents/edit.ts';
import { decodeAssets } from '../documents/assets.ts';
import { incomingFiles, pageFiles, readPage } from '../documents/pages.ts';
import { mergeText } from '../documents/merge.ts';
import { saveDocument } from '../documents/save.ts';
import { createDecision, updateDecision, whoOf } from '../decisions/write.ts';
import type { Decision } from '../decisions/types.ts';
import { HttpError, badRequest } from '../http.ts';
import { lineRange, markdownRange, type Edit, type Range } from '@vantage/mcp';
import { parseAddress, partOf, thingAddress, type Address } from './address.ts';
import { changedFields, createInput, parseRecordText, recordText } from './record-text.ts';
import { documentAt, pagePaths, readThing, recordAt, workspaceAt, type DocumentAt } from './things.ts';
import { pathLines } from '../documents/edit.ts';
import { commitItem, itemThing, placeAddress } from './items.ts';
import { taught, topicOf, type Topic } from './teach.ts';
import { documentLink, recordLink } from './links.ts';
import { writeScopes } from '../scopes/write.ts';
import { SCOPES } from '../scopes/text.ts';
import { refuseStandardWrite, writeStandardSettings } from '../standards/write.ts';
import { STANDARD } from '../standards/text.ts';

export interface ChangeResult {
  /** The thing as the hub names it now; a new record's is the citation it was given. */
  readonly address: string;
  readonly status: 'saved' | 'created' | 'unchanged' | 'conflict' | 'refused';
  readonly version?: string;
  readonly link?: string;
  /** One line a person or an agent can read. */
  readonly message: string;
  /** For a conflict: the text with both sides marked. */
  readonly preview?: string;
  /** For a conflict in a page: the page. */
  readonly path?: string;
}

export interface ChangeOptions {
  readonly message?: string | undefined;
  readonly surface: Surface;
  /** A record wording fix: Last updated stays. */
  readonly minor?: boolean | undefined;
}

interface DocumentWork {
  readonly key: string;
  readonly workspace: string;
  /** The slug the address names; undefined for a new document named after its title. */
  readonly slug: string | undefined;
  yaml: string | undefined;
  readonly pages: Map<string, string>;
  /** The version the caller's text was read from; the head when absent. */
  base: string | undefined;
}

interface RecordWork {
  /** A citation, or a registry prefix for a new record. */
  readonly target: string;
  readonly create: boolean;
  text: string;
  base: string | undefined;
}


async function commitDocument(ctx: AppContext, p: Principal, w: DocumentWork, assets: Readonly<Record<string, Uint8Array>> | undefined, opts: ChangeOptions): Promise<ChangeResult> {
  const ws = await workspaceAt(ctx, p, w.workspace, 'author');
  const at = w.slug ? await documentAt(ctx, p, { workspace: ws.slug, document: w.slug }, 'author') : undefined;
  const yaml = w.yaml ?? at?.head?.yaml;
  const named = w.slug ? `${ws.slug}/${w.slug}` : ws.slug;
  if (yaml === undefined) return { address: named, status: 'refused', message: `${named} is not saved yet; write its YAML at ${named} in the same call as its pages` };
  const r = await saveDocument(ctx, {
    orgId: p.orgId,
    workspaceId: ws.id,
    documentId: at?.doc.id,
    slug: at ? undefined : w.slug,
    yaml,
    files: incomingFiles(ctx, p.orgId, { ...(assets ?? {}), ...pageFiles(Object.fromEntries(w.pages)) }),
    message: opts.message,
    expectedVersionId: at?.head ? (w.base ?? at.head.id) : undefined,
    authorUserId: p.userId,
    who: whoOf(p),
    surface: opts.surface,
  });
  const address = `${ws.slug}/${r.document.slug}`;
  if (r.status === 'conflict') return { address, status: 'conflict', version: r.head.id, message: `conflict${r.path ? ` in page ${r.path}` : ''}: ${r.conflicts} region(s) changed on both sides; the head is ${r.head.id}. Read it again and patch the text as it stands`, preview: r.preview, ...(r.path ? { path: r.path } : {}) };
  const moved = r.moved.length ? ` These records moved; cite them as they are now: ${r.moved.map((m) => `${m.cited} is ${m.ref}`).join(', ')}.` : '';
  if (r.status === 'unchanged') return { address, status: 'unchanged', version: r.version.id, link: documentLink(ctx, ws.slug, r.document.slug), message: `unchanged: ${address} is still version ${r.version.id}.${moved}` };
  return { address, status: at ? 'saved' : 'created', version: r.version.id, link: documentLink(ctx, ws.slug, r.document.slug), message: `saved ${address} version ${r.version.id}${r.merged ? ' (merged with a change made since you read it)' : ''}. ${documentLink(ctx, ws.slug, r.document.slug)}${moved}` };
}


async function commitRecord(ctx: AppContext, p: Principal, w: RecordWork, opts: ChangeOptions): Promise<ChangeResult> {
  if (w.create) {
    const d = await createDecision(ctx, p, w.target, createInput(parseRecordText(w.text)));
    return { address: d.ref, status: 'created', version: (await recordAt(ctx, p, d.ref)).version, link: recordLink(ctx, d.workspace, d.ref), message: `created ${d.ref}: ${d.title}. ${recordLink(ctx, d.workspace, d.ref)}` };
  }
  const at = await recordAt(ctx, p, w.target, 'author');
  const current = recordText(at.decision);
  let next = w.text;
  if (w.base !== undefined && w.base !== at.version) {
    const base = at.revisions.find((r) => r.id === w.base);
    if (!base) throw badRequest(`${w.base} is not a version of ${at.decision.ref}`);
    const m = mergeText(recordText(base.snapshot as unknown as Decision), current, w.text);
    if (!m.ok) return { address: at.decision.ref, status: 'conflict', version: at.version, message: `conflict: ${m.conflicts} region(s) of ${at.decision.ref} changed on both sides since ${w.base}`, preview: m.preview };
    next = m.text;
  }
  if (next === current) return { address: at.decision.ref, status: 'unchanged', version: at.version, message: `unchanged: ${at.decision.ref}` };
  const patch = changedFields(parseRecordText(current), parseRecordText(next));
  if (!Object.keys(patch).length) return { address: at.decision.ref, status: 'unchanged', version: at.version, message: `unchanged: ${at.decision.ref}` };
  const d = await updateDecision(ctx, p, at.decision.ref, { ...patch, ...(opts.minor ? { minor: true } : {}), ...(opts.message ? { message: opts.message.slice(0, 500) } : {}) });
  return { address: d.ref, status: 'saved', version: (await recordAt(ctx, p, d.ref)).version, link: recordLink(ctx, d.workspace, d.ref), message: `saved ${d.ref} (${Object.keys(patch).join(', ')}); last updated ${d.updatedOn}` };
}

async function commitScopes(ctx: AppContext, p: Principal, text: string, opts: ChangeOptions): Promise<ChangeResult> {
  const r = await writeScopes(ctx, p, text, opts.surface);
  return { address: SCOPES, status: r.status, version: r.version, message: r.message };
}

async function commitStandard(ctx: AppContext, p: Principal, text: string, opts: ChangeOptions): Promise<ChangeResult> {
  const r = await writeStandardSettings(ctx, p, text, opts.surface);
  return { address: STANDARD, status: r.status, version: r.version, message: r.message };
}

async function settle(run: () => Promise<ChangeResult>, address: string, topic: Topic): Promise<ChangeResult> {
  try {
    return await run();
  } catch (err) {
    return { address, status: 'refused', message: `${address} was not saved: ${taught(err, topic)}` };
  }
}

export interface WriteInput {
  readonly address: string;
  readonly text: string;
  /** The version the text was read from, for a merge when the thing moved since. */
  readonly base?: string | undefined;
}

/** Writes whole texts. Writes to one document, its pages included, are one version. */
export async function write(ctx: AppContext, p: Principal, writes: readonly WriteInput[], assets: Readonly<Record<string, string>> | undefined, opts: ChangeOptions): Promise<ChangeResult[]> {
  const docs = new Map<string, DocumentWork>();
  const records: RecordWork[] = [];
  const items: { target: { create: true; prefix: string } | { create: false; key: string }; text: string; base: string | undefined; address: string }[] = [];
  const refused: ChangeResult[] = [];
  let scopes: string | undefined;
  let standard: string | undefined;
  const docWork = (workspace: string, slug: string | undefined): DocumentWork => {
    const key = `${workspace}/${slug ?? ''}`;
    let w = docs.get(key);
    if (!w) docs.set(key, (w = { key, workspace, slug, yaml: undefined, pages: new Map(), base: undefined }));
    return w;
  };
  for (const x of writes) {
    try {
      const a = await placeAddress(ctx, p, parseAddress(x.address));
      if (partOf(a) !== undefined) throw badRequest('a write takes the whole thing; to change a part, vantage_patch');
      if (a.kind === 'kind') items.push({ target: { create: true, prefix: a.prefix }, text: x.text, base: undefined, address: x.address });
      else if (a.kind === 'item') items.push({ target: { create: false, key: a.key }, text: x.text, base: x.base, address: x.address });
      else if (a.kind === 'workspace') Object.assign(docWork(a.workspace, undefined), { yaml: x.text });
      else if (a.kind === 'document') Object.assign(docWork(a.workspace, a.document), { yaml: x.text, base: x.base });
      else if (a.kind === 'page') {
        const w = docWork(a.workspace, a.document);
        w.pages.set(a.page, x.text);
        w.base ??= x.base;
      } else if (a.kind === 'record') records.push({ target: a.ref, create: false, text: x.text, base: x.base });
      else if (a.kind === 'registry') records.push({ target: a.prefix, create: true, text: x.text, base: undefined });
      else if (a.kind === 'scopes') scopes = x.text;
      else if (a.kind === 'standards') standard = x.text;
      else if (a.kind === 'standard') refuseStandardWrite(x.address);
      else throw badRequest(`${x.address} is not a thing a write can make`);
    } catch (err) {
      refused.push({ address: x.address, status: 'refused', message: `${x.address} was not saved: ${taught(err, 'working-in-a-hub')}` });
    }
  }
  const decoded = decodeAssets(assets);
  if (decoded && docs.size !== 1) refused.push({ address: 'assets', status: 'refused', message: 'assets go with the one document the call writes; this call writes ' + docs.size });
  const out: ChangeResult[] = [...refused];
  for (const w of docs.values()) out.push(await settle(() => commitDocument(ctx, p, w, docs.size === 1 ? decoded : undefined, opts), w.slug ? `${w.workspace}/${w.slug}` : w.workspace, 'working-in-a-hub'));
  for (const r of records) out.push(await settle(() => commitRecord(ctx, p, r, opts), r.target, 'decision-records-in-a-hub'));
  for (const i of items) out.push(await settle(() => commitItem(ctx, p, i.target, i.text, i.base), i.address, 'working-with-items'));
  if (scopes !== undefined) out.push(await settle(() => commitScopes(ctx, p, scopes!, opts), SCOPES, 'scopes-and-owners'));
  if (standard !== undefined) out.push(await settle(() => commitStandard(ctx, p, standard!, opts), STANDARD, 'standards'));
  return out;
}

/** Where `old` sits in `text`, as offsets, inside `scope` when one is given. */
function occurrences(text: string, old: string, scope: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(old, scope.start); i >= 0 && i + old.length <= scope.end; i = text.indexOf(old, i + Math.max(1, old.length))) out.push(i);
  return out;
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

function offsets(text: string, range: Range | undefined): { start: number; end: number } {
  if (!range) return { start: 0, end: text.length };
  const lines = text.split('\n');
  const start = lines.slice(0, range.from - 1).reduce((s, l) => s + l.length + 1, 0);
  const end = lines.slice(0, range.to).reduce((s, l) => s + l.length + 1, 0);
  return { start, end: Math.min(text.length, end) };
}

/** The lines of `text` most like the first line of `old`, for a patch that missed. */
function nearest(text: string, old: string): string {
  const probe = (old.split('\n').find((l) => l.trim()) ?? '').trim().toLowerCase();
  const words = probe.split(/\W+/).filter((w) => w.length > 2);
  if (!words.length) return '';
  const scored = text
    .split('\n')
    .map((l, i) => ({ l, i, score: words.filter((w) => l.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3);
  return scored.length ? ` Nearest lines: ${scored.map((x) => `L${x.i + 1}: ${x.l.trim().slice(0, 160)}`).join(' | ')}` : '';
}

function swap(text: string, e: Edit, range: Range | undefined, where: string): string {
  if (e.old === undefined || e.old === '') throw badRequest('an edit gives old, the text as it stands, and new');
  const hits = occurrences(text, e.old, offsets(text, range));
  if (!hits.length) throw badRequest(`old was not found in ${where}; it must match exactly, spaces and line breaks included.${nearest(text, e.old)}`);
  if (hits.length > 1 && !e.all) throw badRequest(`old is in ${where} ${hits.length} times (lines ${hits.slice(0, 8).map((h) => lineAt(text, h)).join(', ')}); give more of the text around it, name a part, or set all: true`);
  let out = text;
  for (const h of [...hits].reverse()) out = out.slice(0, h) + (e.new ?? '') + out.slice(h + e.old.length);
  return out;
}

interface Open {
  readonly kind: 'document' | 'record' | 'item' | 'scopes' | 'standards';
  readonly key: string;
  failed?: string;
  doc?: { at: DocumentAt; yaml: string; pages: Map<string, string>; touched: Set<string>; yamlTouched: boolean };
  record?: { text: string; current: string };
}

/** Applies edits to the text as it stands and saves each thing they touch: whole, or not at all. */
export async function patch(ctx: AppContext, p: Principal, edits: readonly Edit[], opts: ChangeOptions): Promise<ChangeResult[]> {
  const open = new Map<string, Open>();
  const order: string[] = [];
  const thing = async (a: Address): Promise<Open> => {
    if (a.kind === 'standard') refuseStandardWrite(thingAddress(a));
    if (a.kind !== 'document' && a.kind !== 'page' && a.kind !== 'record' && a.kind !== 'item' && a.kind !== 'scopes' && a.kind !== 'standards') throw badRequest('a patch changes a document, a page, a record, an item, the scope tree, or the standard settings; a new thing is a vantage_write');
    const key = a.kind === 'record' ? a.ref : a.kind === 'item' ? a.key : a.kind === 'scopes' ? SCOPES : a.kind === 'standards' ? STANDARD : `${a.workspace}/${a.document}`;
    let o = open.get(key);
    if (o) return o;
    if (a.kind === 'scopes' || a.kind === 'standards') {
      const current = (await readThing(ctx, p, a)).text;
      o = { kind: a.kind, key, record: { text: current, current } };
    } else if (a.kind === 'item') {
      const current = (await itemThing(ctx, p, a.key)).text;
      o = { kind: 'item', key: a.key, record: { text: current, current } };
    } else if (a.kind === 'record') {
      const at = await recordAt(ctx, p, a.ref, 'author');
      const current = recordText(at.decision);
      o = { kind: 'record', key: at.decision.ref, record: { text: current, current } };
    } else {
      const at = await documentAt(ctx, p, a, 'author');
      if (!at?.head) throw new HttpError(404, `no saved document ${a.workspace}/${a.document}; a new one is a vantage_write`);
      o = { kind: 'document', key: `${at.ws.slug}/${at.doc.slug}`, doc: { at, yaml: at.head.yaml, pages: new Map(), touched: new Set(), yamlTouched: false } };
    }
    open.set(key, o);
    order.push(key);
    return o;
  };
  const stray: ChangeResult[] = [];
  for (const [i, e] of edits.entries()) {
    let o: Open | undefined;
    let placed: Address | undefined;
    try {
      const a = await placeAddress(ctx, p, parseAddress(e.address));
      placed = a;
      o = await thing(a);
      if (o.failed) continue;
      const part = partOf(a);
      if (a.kind === 'scopes' || a.kind === 'standards') {
        const r = o.record!;
        if (e.op) {
          const path = e.path ?? part;
          if (!path) throw badRequest('set, add, and remove take a path: workspaces.shop');
          r.text = applyEdits(r.text, [EditOperationSchema.parse({ op: e.op, path, ...(e.op === 'remove' ? {} : { value: e.value }) })]);
        } else r.text = swap(r.text, e, part ? lineRange(part, r.text.split('\n').length) ?? pathLines(r.text, part) ?? missing(o.key, part) : undefined, e.address);
      } else if (a.kind === 'record' || a.kind === 'item') {
        if (e.op) throw badRequest("a record or an item changes by old and new; its header's fields are text too (status: proposed)");
        const r = o.record!;
        r.text = swap(r.text, e, part ? markdownRange(r.text, part) ?? missing(o.key, part) : undefined, e.address);
      } else if (a.kind === 'page') {
        if (e.op) throw badRequest('a page changes by old and new; set, add, and remove are for YAML');
        const d = o.doc!;
        const head = d.at.head!;
        const text = d.pages.get(a.page) ?? (await readPage(ctx, head, a.page));
        if (text === undefined) throw new HttpError(404, `no page ${a.page} in ${o.key}; its pages: ${pagePaths(head).join(', ') || 'none'}`);
        d.pages.set(a.page, swap(text, e, part ? markdownRange(text, part) ?? missing(e.address, part) : undefined, e.address));
        d.touched.add(a.page);
      } else {
        const d = o.doc!;
        if (e.op) {
          const path = e.path ?? part;
          if (!path) throw badRequest('set, add, and remove take a path: nodes.api.subtitle');
          d.yaml = applyEdits(d.yaml, [EditOperationSchema.parse({ op: e.op, path, ...(e.op === 'remove' ? {} : { value: e.value }) })]);
        } else {
          const range = part ? lineRange(part, d.yaml.split('\n').length) ?? pathLines(d.yaml, part) ?? missing(o.key, part) : undefined;
          d.yaml = swap(d.yaml, e, range, e.address);
        }
        d.yamlTouched = true;
      }
    } catch (err) {
      const why = `edit ${i + 1} (${e.address}): ${taught(err, topicOf(placed))}`;
      if (o) o.failed = why;
      else stray.push({ address: e.address, status: 'refused', message: why });
    }
  }
  const out: ChangeResult[] = [...stray];
  for (const key of order) {
    const o = open.get(key)!;
    if (o.failed) {
      out.push({ address: o.key, status: 'refused', message: `${o.key} was not saved: ${o.failed}` });
      continue;
    }
    if (o.kind === 'record') {
      const r = o.record!;
      out.push(await settle(() => commitRecord(ctx, p, { target: o.key, create: false, text: r.text, base: undefined }, opts), o.key, 'decision-records-in-a-hub'));
      continue;
    }
    if (o.kind === 'scopes') {
      const r = o.record!;
      out.push(await settle(() => commitScopes(ctx, p, r.text, opts), SCOPES, 'scopes-and-owners'));
      continue;
    }
    if (o.kind === 'standards') {
      const r = o.record!;
      out.push(await settle(() => commitStandard(ctx, p, r.text, opts), STANDARD, 'standards'));
      continue;
    }
    if (o.kind === 'item') {
      const r = o.record!;
      out.push(await settle(() => commitItem(ctx, p, { create: false, key: o.key }, r.text, undefined), o.key, 'working-with-items'));
      continue;
    }
    const d = o.doc!;
    const work: DocumentWork = { key: o.key, workspace: d.at.ws.slug, slug: d.at.doc.slug, yaml: d.yamlTouched ? d.yaml : undefined, pages: new Map([...d.pages].filter(([path]) => d.touched.has(path))), base: d.at.head!.id };
    out.push(await settle(() => commitDocument(ctx, p, work, undefined, opts), o.key, 'working-in-a-hub'));
  }
  return out;
}

function missing(address: string, part: string): never {
  throw badRequest(`${address} has no part ${part}; vantage_outline it for its parts`);
}

/** What a change answers an agent: one line per thing. */
export function changeText(results: readonly ChangeResult[]): { text: string; isError: boolean } {
  const lines = results.map((r) => (r.status === 'conflict' && r.preview ? `${r.message}\n${r.preview.split('\n').slice(0, 60).join('\n')}` : r.message));
  return { text: lines.join('\n'), isError: results.some((r) => r.status === 'refused' || r.status === 'conflict') };
}
