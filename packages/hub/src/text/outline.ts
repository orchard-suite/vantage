/**
 * Outline: what is at an address, as names and sizes, never the text. It
 * is the first rung of the climb: an agent reads an outline, then asks for
 * the one part it needs.
 */
import { parseDocumentText } from '@vantage/model';
import { STALE, staleOf } from './stale.ts';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { memberWorkspaces } from '../authz.ts';
import { readPage } from '../documents/pages.ts';
import { listDecisions, listRegistries, requireRegistry } from '../decisions/read.ts';
import { countDecisions } from '../decisions/repo.ts';
import { decisionCitations } from '../decisions/backlinks.ts';
import { listLine } from '../decisions/text.ts';
import { schemeText } from '../decisions/numbering.ts';
import { STATUSES, type DecisionStatus } from '../decisions/types.ts';
import { badRequest } from '../http.ts';
import { BUDGET, countLines, guideOutline, headingOutline, headings, schemaOutline } from '@vantage/mcp';
import { thingAddress, type Address } from './address.ts';
import { pagePaths, readThing, recordAt, requireDocumentAt, workspaceAt } from './things.ts';
import { yamlOutline } from './yaml-outline.ts';
import { RECORD_TEMPLATE } from './record-text.ts';
import { itemOutline, kindOutline, placeAddress } from './items.ts';
import { kindsFor } from '../tracking/read.ts';

const n = (x: number): string => x.toLocaleString('en-US');
const day = (d: Date): string => d.toISOString().slice(0, 10);
const plural = (count: number, word: string): string => `${n(count)} ${word}${count === 1 ? '' : 's'}`;

/** Fits lines to the outline budget; what does not fit is counted, with the call that narrows. */
function fit(lines: readonly string[], narrow: string): string {
  let used = 0;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    used += lines[i]!.length + 1;
    if (used > BUDGET.outlineChars) {
      out.push(`${n(lines.length - i)} more lines left out. more: ${narrow}`);
      break;
    }
    out.push(lines[i]!);
  }
  return out.join('\n');
}

interface DocLine {
  readonly slug: string;
  readonly name: string;
  readonly chars: number | null;
  readonly pages: number;
  readonly updated_at: Date;
}

async function documentLines(ctx: AppContext, workspaceId: string): Promise<DocLine[]> {
  return ctx.db.query<DocLine>(
    `select d.slug, d.name, length(v.yaml) as chars, d.updated_at,
            (select count(*)::int from jsonb_array_elements(coalesce(v.attachments, '[]'::jsonb)) a where a->>'path' ilike '%.md') as pages
       from documents d left join versions v on v.id = d.head_version_id
      where d.workspace_id = $1 order by d.name`,
    [workspaceId],
  );
}

async function root(ctx: AppContext, p: Principal): Promise<string> {
  const workspaces = await memberWorkspaces(ctx.db, p);
  const counts = await ctx.db.query<{ workspace_id: string; n: number }>('select workspace_id, count(*)::int as n from documents where workspace_id = any($1::text[]) group by workspace_id', [workspaces.map((w) => w.id)]);
  const registries = await listRegistries(ctx, p);
  const lines = ['workspaces (outline one for its documents):', ...workspaces.map((w) => `  ${w.slug}  ${w.name}  (${w.kind}, ${w.role})  ${plural(counts.find((c) => c.workspace_id === w.id)?.n ?? 0, 'document')}`)];
  if (!workspaces.length) lines.push('  none');
  lines.push('', 'registries of decision records (outline one for its records):');
  for (const r of registries) lines.push(`  ${r.prefix}  ${r.name}  (workspace ${r.workspace})  ${plural(await countDecisions(ctx.db, [r.id]), 'record')}`);
  if (!registries.length) lines.push('  none');
  const kinds = await kindsFor(ctx, p);
  lines.push('', 'kinds of tracked items (outline one for its items):');
  for (const k of kinds) lines.push(`  ${k.prefix}  ${k.name}  (workspace ${workspaces.find((w) => w.id === k.workspace_id)?.slug ?? 'shared'})`);
  if (!kinds.length) lines.push('  none; a kind is a document with a kind block (guide#kinds-and-items)');
  lines.push('', 'guide  the language and the rules, by topic', 'schema  the JSON Schema of a document, by part');
  return fit(lines, 'vantage_outline one workspace or registry');
}

async function workspace(ctx: AppContext, p: Principal, slug: string): Promise<string> {
  const ws = await workspaceAt(ctx, p, slug, 'viewer');
  const docs = await documentLines(ctx, ws.id);
  const registries = await listRegistries(ctx, p, ws.slug);
  const lines = [`${ws.slug}: ${ws.name} (${ws.kind}, you are ${ws.role}), ${n(docs.length)} document${docs.length === 1 ? '' : 's'}`];
  for (const d of docs) lines.push(`  ${ws.slug}/${d.slug}  ${d.name}  ${d.chars === null ? 'no version yet' : `${n(d.chars)} chars`}${d.pages ? `, ${d.pages} page${d.pages === 1 ? '' : 's'}` : ''}  updated ${day(d.updated_at)}`);
  for (const r of registries) lines.push(`  registry ${r.prefix}  ${r.name}  ${n(await countDecisions(ctx.db, [r.id]))} records`);
  for (const k of (await kindsFor(ctx, p)).filter((x) => x.workspace_id === ws.id)) lines.push(`  kind ${k.prefix}  ${k.name}  (outline ${k.prefix} for its items)`);
  return fit(lines, `vantage_find with in: ${ws.slug}`);
}

async function document(ctx: AppContext, p: Principal, a: { workspace: string; document: string }): Promise<string> {
  const { ws, doc, head } = await requireDocumentAt(ctx, p, a, 'viewer');
  const address = `${ws.slug}/${doc.slug}`;
  const lines = [`${address}: ${doc.name}  version ${head.id}  ${n(head.yaml.length)} chars, ${n(countLines(head.yaml))} lines`, `link: ${ctx.config.PUBLIC_URL}/w/${encodeURIComponent(ws.slug)}/${encodeURIComponent(doc.slug)}`];
  const pages = pagePaths(head);
  const files = head.attachments.filter((x) => !pages.includes(x.path));
  const tail: string[] = [];
  if (pages.length) {
    tail.push('', `pages (${pages.length}); outline one for its headings:`);
    for (const path of pages) {
      const body = (await readPage(ctx, head, path)) ?? '';
      tail.push(`  ${address}/${path}  ${n(body.length)} chars, ${n(headings(body).length)} headings`);
    }
  }
  if (files.length) tail.push('', `files: ${files.map((f) => f.path).join(', ')}`);
  const docs = await docsLine(ctx, doc.org_id, address, head.yaml);
  if (docs) lines.push(docs);
  const room = Math.max(1000, BUDGET.outlineChars - 1200 - tail.join('\n').length);
  return fit([...lines, ...yamlOutline(head.yaml, room), ...tail], `vantage_find with in: ${address}`);
}

/** The contract and what may be stale, in one line, when the document keeps docs. */
async function docsLine(ctx: AppContext, orgId: string, address: string, yaml: string): Promise<string | undefined> {
  const d = parseDocumentText(yaml).document;
  if (!d?.docs && !d?.evidence?.length) return undefined;
  const c = d.docs;
  const parts = [c?.kind, c?.repository, c?.audience ? `for ${c.audience}` : undefined, c?.pages?.length ? `must have ${c.pages.join(', ')}` : undefined].filter(Boolean);
  const stale = d.evidence?.length ? await staleOf(ctx, orgId, address, yaml) : undefined;
  const ties = stale?.count !== undefined ? `${plural(d.evidence!.length, 'evidence tie')}, ${stale.count} may be stale: vantage_read ${address}/${STALE}` : d.evidence?.length ? `${plural(d.evidence.length, 'evidence tie')}; ${address}/${STALE} says why none can be read` : undefined;
  return `docs: ${[...parts, ties].filter(Boolean).join('; ')}`;
}

async function page(ctx: AppContext, p: Principal, a: Address): Promise<string> {
  const t = await readThing(ctx, p, a);
  const hs = headingOutline(t.text);
  return fit([`${t.address}  version ${t.version}  ${n(t.text.length)} chars, ${n(countLines(t.text))} lines`, ...(hs.length ? hs : ['no headings; read it by lines: #L1-80'])], `vantage_find with in: ${t.address}`);
}

async function record(ctx: AppContext, p: Principal, ref: string): Promise<string> {
  const { decision: d, version } = await recordAt(ctx, p, ref);
  const t = await readThing(ctx, p, { kind: 'record', ref: d.ref });
  const cited = await decisionCitations(ctx, p, d.ref);
  const lines = [
    `${d.ref}: ${d.title}  version ${version}  ${n(t.text.length)} chars`,
    `${d.status}; category ${d.category} ${d.categoryName}; decided ${d.decidedOn ?? 'not recorded'}; updated ${d.updatedOn}; by ${d.deciders.join(', ') || 'not recorded'}`,
    ...(d.supersededBy ? [`superseded by ${d.supersededBy.ref} ${d.supersededBy.title}`] : []),
    ...(d.supersedes ? [`supersedes ${d.supersedes.ref} ${d.supersedes.title}`] : []),
    ...(d.aliases.length ? [`formerly ${d.aliases.join(', ')}`] : []),
    `link: ${ctx.config.PUBLIC_URL}/w/${d.workspace}/decisions/${d.ref}`,
    ...headingOutline(t.text, 2),
  ];
  if (d.governs.length) lines.push(`governs: ${d.governs.map((g) => `${g.workspace}/${g.document} ${g.box ? `box ${g.box}` : `view ${g.view}`}`).join('; ')}`);
  const docs = cited.documents.slice(0, 10).map((x) => `${x.workspace}/${x.document} (${x.places.map((y) => `${y.kind} ${y.id}`).join(', ')})`);
  const recs = cited.records.slice(0, 10).map((x) => x.ref);
  const total = cited.documents.length + cited.records.length + cited.hidden;
  lines.push(total ? `cited by ${n(total)}: ${[...docs, ...recs].join('; ')}${cited.hidden ? `; ${cited.hidden} more you cannot open` : ''}` : 'cited by nothing yet');
  return fit(lines, `vantage_read ${d.ref}#decision`);
}

async function registry(ctx: AppContext, p: Principal, prefix: string, part: string | undefined): Promise<string> {
  const { row } = await requireRegistry(ctx, p, prefix, 'viewer');
  const filter: { category?: number; status?: DecisionStatus } = {};
  if (part !== undefined) {
    if (/^\d$/.test(part)) filter.category = Number(part);
    else if ((STATUSES as readonly string[]).includes(part.toLowerCase())) filter.status = part.toLowerCase() as DecisionStatus;
    else throw badRequest(`a registry's part is a category digit (${prefix}#3) or a status (${prefix}#accepted)`);
  }
  const records = await listDecisions(ctx, p, prefix, filter);
  const lines = [`${row.prefix}: ${row.name}  ${n(records.length)} record${records.length === 1 ? '' : 's'}${part ? ` in #${part}` : ''}; categories ${schemeText(row.categories)}`, ...records.map(listLine)];
  if (!part) lines.push('', `A new record: vantage_write to ${row.prefix} with this text, filled in:`, RECORD_TEMPLATE.trimEnd());
  return fit(lines, `vantage_outline ${row.prefix}#<category digit or status>, or vantage_find with in: ${row.prefix}`);
}

export async function outline(ctx: AppContext, p: Principal, given: Address): Promise<string> {
  const a = await placeAddress(ctx, p, given);
  switch (a.kind) {
    case 'kind':
      return fit((await kindOutline(ctx, p, a.prefix, a.part)).split('\n'), `vantage_outline ${a.prefix}#<state>`);
    case 'item':
      return fit((await itemOutline(ctx, p, a.key)).split('\n'), `vantage_read ${a.key}`);
    case 'root':
      return root(ctx, p);
    case 'guide':
      return guideOutline();
    case 'schema':
      return schemaOutline();
    case 'workspace':
      return workspace(ctx, p, a.workspace);
    case 'document':
      return document(ctx, p, a);
    case 'page':
      return page(ctx, p, a);
    case 'record':
      return record(ctx, p, a.ref);
    case 'registry':
      return registry(ctx, p, a.prefix, a.part);
  }
  throw badRequest(`${thingAddress(a)} is not an address`);
}
