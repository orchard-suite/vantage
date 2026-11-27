/**
 * Decision registries and records over HTTP: the same service the MCP
 * tools call, so every surface checks and writes the same way.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocumentById } from './common.ts';
import { badRequest } from '../http.ts';
import { decisionHistory, documentDecisions, listDecisions, listRegistries, readDecision } from '../decisions/read.ts';
import { createDecision, createRegistry, peekNextNumber, supersedeDecision, updateDecision, updateRegistry } from '../decisions/write.ts';
import { importDecisions } from '../decisions/import-apply.ts';
import { decisionCitations } from '../decisions/backlinks.ts';
import { moveDecision } from '../decisions/move.ts';
import { discardDecision } from '../decisions/discard.ts';
import { StatusSchema } from '../decisions/types.ts';

const RECORD = 'title, category, status, decidedOn, updatedOn, deciders, context, decision, consequences, alternatives [{option, rejected}], related, alignment {stance, rule, note}, governs [{document, box | view}]';
/** The fields a refine changes, sent flat beside minor and message; every one optional. */
const PATCH_FIELDS: Record<string, string> = {
  title: 'optional',
  status: 'optional: proposed, accepted, or deprecated',
  decidedOn: 'optional: YYYY-MM-DD',
  updatedOn: 'optional: YYYY-MM-DD',
  deciders: 'optional: names',
  context: 'optional: Markdown',
  decision: 'optional: Markdown',
  consequences: 'optional: Markdown',
  alternatives: 'optional: [{option, rejected}]',
  related: 'optional: record citations',
  alignment: 'optional: {stance, rule, note}, or null',
  governs: 'optional: [{document, box | view}]',
};
const ImportBody = z.object({ files: z.array(z.object({ path: z.string().min(1).max(500), text: z.string().max(500_000) })).min(1).max(500), dryRun: z.boolean().optional() });

function categoryParam(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 9) throw badRequest('category is one digit, 0 to 9');
  return n;
}

export function decisionRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/registries', summary: 'Decision registries the caller can open', tag: 'decisions', query: ['workspace'], auth: 'user' });
  app.get('/registries', async (c) => c.json({ registries: await listRegistries(ctx, principal(c), c.req.query('workspace') || undefined) }));

  reg.add({ method: 'post', path: '/workspaces/:workspace/registries', summary: 'Make a decision registry in a workspace; its prefix is unique in the organization and never changes', tag: 'decisions', params: ['workspace'], body: { prefix: 'SHOP', name: 'name', description: 'optional', categories: '[{digit, name}]; defaults to 0 Governance through 6 Operations' }, auth: 'author', responses: { '201': 'created', '409': 'the prefix is taken' } });
  app.post('/workspaces/:workspace/registries', async (c) => c.json({ registry: await createRegistry(ctx, principal(c), c.req.param('workspace'), await c.req.json()) }, 201));

  reg.add({ method: 'patch', path: '/registries/:prefix', summary: 'Rename a registry or change its category scheme; a category in use stays', tag: 'decisions', params: ['prefix'], body: { name: 'optional', description: 'optional', categories: 'optional' }, auth: 'author' });
  app.patch('/registries/:prefix', async (c) => c.json({ registry: await updateRegistry(ctx, principal(c), c.req.param('prefix'), await c.req.json()) }));

  reg.add({ method: 'get', path: '/registries/:prefix/decisions', summary: 'A registry\'s records, filtered by category, status, and words', tag: 'decisions', params: ['prefix'], query: ['category', 'status', 'q'], auth: 'viewer' });
  app.get('/registries/:prefix/decisions', async (c) => {
    const status = c.req.query('status');
    const parsed = status ? StatusSchema.safeParse(status) : undefined;
    if (parsed && !parsed.success) throw badRequest('status is proposed, accepted, deprecated, or superseded');
    return c.json({ decisions: await listDecisions(ctx, principal(c), c.req.param('prefix'), { category: categoryParam(c.req.query('category')), status: parsed?.data, query: c.req.query('q') }) });
  });

  reg.add({ method: 'post', path: '/registries/:prefix/decisions', summary: 'Write a new record; it takes the next number in its category', tag: 'decisions', params: ['prefix'], body: { record: RECORD }, auth: 'author', responses: { '201': 'created' } });
  app.post('/registries/:prefix/decisions', async (c) => c.json({ decision: await createDecision(ctx, principal(c), c.req.param('prefix'), await c.req.json()) }, 201));

  reg.add({ method: 'get', path: '/registries/:prefix/next', summary: 'The number the next record in a category would take', tag: 'decisions', params: ['prefix'], query: ['category'], auth: 'viewer' });
  app.get('/registries/:prefix/next', async (c) => {
    const category = categoryParam(c.req.query('category'));
    if (category === undefined) throw badRequest('category is required');
    return c.json(await peekNextNumber(ctx, principal(c), c.req.param('prefix'), category));
  });

  reg.add({ method: 'post', path: '/registries/:prefix/import', summary: 'Import Markdown decision records; each keeps its number, dates, status, decision makers, and supersede links', tag: 'decisions', params: ['prefix'], body: { files: '[{path, text}]', dryRun: 'true reports and writes nothing' }, auth: 'author' });
  app.post('/registries/:prefix/import', async (c) => {
    const input = await body(c, ImportBody);
    return c.json(await importDecisions(ctx, principal(c), c.req.param('prefix'), input.files, { dryRun: input.dryRun ?? false }));
  });

  reg.add({ method: 'get', path: '/decisions/:ref', summary: 'One record by citation: SHOP-2001 or adr:<ULID>', tag: 'decisions', params: ['ref'], auth: 'viewer' });
  app.get('/decisions/:ref', async (c) => c.json({ decision: await readDecision(ctx, principal(c), c.req.param('ref')) }));

  reg.add({ method: 'patch', path: '/decisions/:ref', summary: 'Refine a record in place; Last updated moves unless minor is true', tag: 'decisions', params: ['ref'], body: { ...PATCH_FIELDS, minor: 'optional: true for a date or wording fix; Last updated stays', message: 'optional: what changed, for the history' }, auth: 'author' });
  app.patch('/decisions/:ref', async (c) => c.json({ decision: await updateDecision(ctx, principal(c), c.req.param('ref'), await c.req.json()) }));

  reg.add({ method: 'post', path: '/decisions/:ref/supersede', summary: 'Write a new record that supersedes this one; the old record keeps its body', tag: 'decisions', params: ['ref'], body: { record: RECORD }, auth: 'author', responses: { '201': 'created' } });
  app.post('/decisions/:ref/supersede', async (c) => c.json(await supersedeDecision(ctx, principal(c), c.req.param('ref'), await c.req.json()), 201));

  reg.add({ method: 'get', path: '/decisions/:ref/citations', summary: 'Every place that cites a record: documents with their boxes and pages, other records, and what it governs. Places the caller cannot open are only counted, as hidden', tag: 'decisions', params: ['ref'], auth: 'viewer' });
  app.get('/decisions/:ref/citations', async (c) => c.json(await decisionCitations(ctx, principal(c), c.req.param('ref'))));

  reg.add({ method: 'post', path: '/decisions/:ref/move', summary: 'Renumber a record, move it to another category, or to another registry. It keeps its id, its old citation stays an alias that resolves, and every citation the hub knows of is rewritten; a source the caller cannot write is reported, not a failure', tag: 'decisions', params: ['ref'], body: { registry: 'optional: the prefix to move to', number: 'optional: the exact new number', category: 'optional: the new category; the next number there', dryRun: 'true reports and writes nothing', message: 'optional: for the history' }, auth: 'author' });
  app.post('/decisions/:ref/move', async (c) => c.json(await moveDecision(ctx, principal(c), c.req.param('ref'), await c.req.json())));

  reg.add({ method: 'post', path: '/decisions/:ref/discard', summary: 'Take back a record its writer made by mistake: it is removed and its number is free for the next record in its category. Only while nothing points to it (no citation, related or supersede link, item link, or old citation, and no revision by anyone else); the audit log keeps its whole text', tag: 'decisions', params: ['ref'], body: { dryRun: 'true answers what points to it and writes nothing', message: 'optional: why, for the audit log' }, auth: 'author', responses: { '409': 'something points to it; details.pointers lists what' } });
  app.post('/decisions/:ref/discard', async (c) => c.json(await discardDecision(ctx, principal(c), c.req.param('ref'), await c.req.json())));

  reg.add({ method: 'get', path: '/decisions/:ref/history', summary: 'Every revision of a record, newest first', tag: 'decisions', params: ['ref'], auth: 'viewer' });
  app.get('/decisions/:ref/history', async (c) => c.json({ revisions: await decisionHistory(ctx, principal(c), c.req.param('ref')) }));

  reg.add({ method: 'get', path: '/documents/:id/decisions', summary: 'The records that govern a document\'s boxes and views, and the records its YAML and pages cite (cite=SHOP-2001,adr:...)', tag: 'decisions', params: ['id'], query: ['cite'], auth: 'viewer' });
  app.get('/documents/:id/decisions', async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'viewer');
    const cite = (c.req.query('cite') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return c.json(await documentDecisions(ctx, p, document.id, cite));
  });

  return app;
}
