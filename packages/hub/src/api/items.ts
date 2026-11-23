/**
 * Tracked items over HTTP (docs/decisions/5001): nine verbs, the same
 * service the agent tools and the work pages call. Every write carries an
 * Idempotency-Key: sent twice, it answers the same and changes nothing the
 * second time. An item is named by its key (VAN-12) or by its kind and the
 * caller's own key (VAN:forms/1842, encoded in the path).
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal, scopedDocumentById } from './common.ts';
import { HttpError, badRequest } from '../http.ts';
import { findItem } from '../tracking/access.ts';
import { membersOf, openMoves } from '../tracking/gate.ts';
import { bodyOf, cardOf, changes, describeKind, find, get, history, kindsFor, notes, planOf } from '../tracking/read.ts';
import { attach, hold, link, move, note, put, release, type WriteAnswer } from '../tracking/write.ts';
import { STATE_CLASSES } from '@vantage/model';
import { listApps, registerApp } from '../tracking/apps.ts';
import { erase, loadKind } from '../tracking/admin.ts';
import { maybe } from '../db/db.ts';
import type { KindDef } from '../tracking/kinds.ts';

const Labels = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const PutBody = z.object({ kind: z.string().optional(), item: z.string().optional(), ref: z.string().min(1).max(200).optional(), title: z.string().optional(), labels: Labels.optional(), revision: z.string().min(1).max(200).optional(), body: z.string().max(200_000).optional(), parent: z.string().optional() }).strict();
const MoveBody = z.object({ to: z.string(), note: z.string().optional(), revision: z.string().optional() }).strict();
const PersonBody = z.object({ person: z.string().optional() }).strict();
const NoteBody = z.object({ text: z.string() }).strict();
const LinkBody = z.object({ rel: z.string(), target: z.string(), remove: z.boolean().optional() }).strict();
const AppBody = z.object({ clientId: z.string().min(1).max(200), name: z.string().min(1).max(200), workspace: z.string(), kinds: z.array(z.string()).max(50) }).strict();
const KindBody = z.object({ yaml: z.string().max(500_000), workspace: z.string().optional() }).strict();
const EraseBody = z.object({ reason: z.string().min(1).max(500) }).strict();
const BatchBody = z.object({
  actions: z
    .array(
      z.discriminatedUnion('verb', [
        PutBody.extend({ verb: z.literal('put'), key: z.string().min(1).max(200) }),
        MoveBody.extend({ verb: z.literal('move'), item: z.string(), key: z.string().min(1).max(200) }),
        PersonBody.extend({ verb: z.enum(['hold', 'release']), item: z.string(), key: z.string().min(1).max(200) }),
        NoteBody.extend({ verb: z.literal('note'), item: z.string(), key: z.string().min(1).max(200) }),
        LinkBody.extend({ verb: z.literal('link'), item: z.string(), key: z.string().min(1).max(200) }),
      ]),
    )
    .min(1)
    .max(100),
});

/** The key that makes a write safe to send twice; every write carries one. */
function idempotencyKey(c: Context<HubEnv>): string {
  const k = c.req.header('idempotency-key')?.trim();
  if (!k) throw badRequest('every write to an item carries an Idempotency-Key header, so a write sent twice lands once');
  if (k.length > 200) throw badRequest('an Idempotency-Key is at most 200 characters');
  return k;
}

const answer = (c: Context<HubEnv>, a: WriteAnswer, created = false) => c.json({ status: a.status, key: a.key, line: a.line }, created && a.status === 'done' ? 201 : 200);
const intParam = (raw: string | undefined, name: string): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${name} is a whole number`);
  return n;
};

export function itemRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const item = (c: Context<HubEnv>): string => decodeURIComponent(c.req.param('item') ?? '');

  reg.add({ method: 'get', path: '/kinds', summary: 'describe: the kinds of item the caller may see', tag: 'items', auth: 'user' });
  app.get('/kinds', async (c) => c.json({ kinds: (await kindsFor(ctx, principal(c))).map((k) => k.definition) }));

  reg.add({ method: 'get', path: '/kinds/:prefix', summary: "describe: a kind's states, moves, labels, and roles, with a live count of items in each state", tag: 'items', params: ['prefix'], auth: 'viewer' });
  app.get('/kinds/:prefix', async (c) => {
    const { kind, counts } = await describeKind(ctx, principal(c), c.req.param('prefix'));
    return c.json({ kind: kind.definition, counts });
  });

  reg.add({ method: 'get', path: '/items/:item/moves', summary: 'describe: the moves open to the caller on one item now, and what each needs', tag: 'items', params: ['item'], auth: 'viewer' });
  app.get('/items/:item/moves', async (c) => {
    const p = principal(c);
    const f = await findItem(ctx, p, item(c));
    return c.json({ item: f.item.key, state: f.item.state, moves: openMoves(f.kind.definition, f.item, f.caller, await membersOf(ctx.db, p.orgId, f.kind.definition)) });
  });

  reg.add({ method: 'put', path: '/items', summary: "put: make an item, or change the fields named; by the caller's own key (kind + ref) it is safe to send twice", tag: 'items', body: { kind: 'prefix, for a new item or one named by ref', item: 'optional: an item to change', ref: "optional: the owner's own key", title: 'optional', labels: 'optional: {name: value}; null removes one', revision: 'optional: the content revision', body: 'optional: Markdown, for a kind the hub keeps', parent: 'optional: an item key' }, auth: 'author', responses: { '201': 'created', '200': 'changed, unchanged, or a repeat' } });
  app.put('/items', async (c) => answer(c, await put(ctx, principal(c), await body(c, PutBody), idempotencyKey(c)), true));

  reg.add({ method: 'post', path: '/items/:item/move', summary: 'move: change state through the lifecycle; a refusal (409) names the moves open', tag: 'items', params: ['item'], body: { to: 'a state id', note: 'optional; some moves need one', revision: 'optional; some moves pin one' }, auth: 'viewer', responses: { '409': 'the lifecycle refuses it; details.open lists the moves open' } });
  app.post('/items/:item/move', async (c) => answer(c, await move(ctx, principal(c), item(c), await body(c, MoveBody), idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/:item/hold', summary: 'hold: who has it now; person is me or an email', tag: 'items', params: ['item'], body: { person: 'optional: me or an email' }, auth: 'author' });
  app.post('/items/:item/hold', async (c) => answer(c, await hold(ctx, principal(c), item(c), (await body(c, PersonBody)).person, idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/:item/release', summary: 'release: let go of an item', tag: 'items', params: ['item'], body: { person: 'optional: me or an email' }, auth: 'viewer' });
  app.post('/items/:item/release', async (c) => answer(c, await release(ctx, principal(c), item(c), (await body(c, PersonBody)).person, idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/:item/notes', summary: 'note: a note on the item; a longer text is a file', tag: 'items', params: ['item'], body: { text: 'the note' }, auth: 'author' });
  app.post('/items/:item/notes', async (c) => answer(c, await note(ctx, principal(c), item(c), (await body(c, NoteBody)).text, idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/:item/files', summary: 'attach: a file about the work, sent as the request body; the file is stored before the event', tag: 'items', params: ['item'], query: ['name'], auth: 'author' });
  app.post('/items/:item/files', async (c) => {
    const name = c.req.query('name');
    if (!name) throw badRequest('name the file: ?name=proof.pdf');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return answer(c, await attach(ctx, principal(c), item(c), { name, contentType: c.req.header('content-type') ?? 'application/octet-stream', bytes }, idempotencyKey(c)));
  });

  reg.add({ method: 'get', path: '/items/:item/files/:id', summary: 'A file on an item', tag: 'items', params: ['item', 'id'], auth: 'viewer' });
  app.get('/items/:item/files/:id', async (c) => {
    const f = await findItem(ctx, principal(c), item(c));
    const row = (await ctx.db.query<{ name: string; content_type: string; blob_key: string }>('select name, content_type, blob_key from item_files where id = $1 and item_id = $2', [c.req.param('id'), f.item.id]))[0];
    if (!row) throw new HttpError(404, 'no such file on this item');
    const bytes = await ctx.blob.get(row.blob_key);
    if (!bytes) throw new HttpError(404, 'the file is gone from the store');
    return new Response(Buffer.from(bytes), { headers: { 'content-type': row.content_type, 'content-disposition': `attachment; filename="${row.name.replace(/"/g, '')}"` } });
  });

  reg.add({ method: 'post', path: '/items/:item/links', summary: 'link: came-from or part-of an item, a box or a view (workspace/document#id), or a decision record; remove: true takes one away', tag: 'items', params: ['item'], body: { rel: 'came-from, part-of, box, view, or decision', target: 'what it links to', remove: 'optional' }, auth: 'author' });
  app.post('/items/:item/links', async (c) => answer(c, await link(ctx, principal(c), item(c), await body(c, LinkBody), idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/batch', summary: 'Several writes in one request; each commits alone with its own key, and the answer says in a line each which landed', tag: 'items', body: { actions: '[{verb: put | move | hold | release | note | link, key, ...that verb\'s body, item}]' }, auth: 'user' });
  app.post('/items/batch', async (c) => {
    const p = principal(c);
    const { actions } = await body(c, BatchBody);
    const results: { status: string; key?: string; line: string }[] = [];
    for (const a of actions) {
      try {
        const { verb, key, ...rest } = a;
        const r = await (async (): Promise<WriteAnswer> => {
          switch (a.verb) {
            case 'put':
              return put(ctx, p, rest as z.infer<typeof PutBody>, key);
            case 'move':
              return move(ctx, p, a.item, { to: a.to, note: a.note, revision: a.revision }, key);
            case 'hold':
            case 'release':
              return (a.verb === 'hold' ? hold : release)(ctx, p, a.item, a.person, key);
            case 'note':
              return note(ctx, p, a.item, a.text, key);
            case 'link':
              return link(ctx, p, a.item, { rel: a.rel, target: a.target, ...(a.remove ? { remove: true } : {}) }, key);
          }
        })();
        void verb;
        results.push({ status: r.status, key: r.key, line: r.line });
      } catch (err) {
        results.push({ status: 'refused', line: `${'item' in a ? a.item : (a.kind ?? 'put')}: ${err instanceof HttpError ? err.message : (err as Error).message}` });
      }
    }
    return c.json({ results });
  });

  reg.add({ method: 'get', path: '/items/:item', summary: "get: one item's card, and its body when the hub keeps it; held=<version> answers an unchanged item with nothing", tag: 'items', params: ['item'], query: ['held'], auth: 'viewer' });
  app.get('/items/:item', async (c) => {
    const p = principal(c);
    const f = await findItem(ctx, p, item(c));
    if (intParam(c.req.query('held'), 'held') === f.item.position) return c.json({ item: f.item.key, unchanged: f.item.position });
    const card = await cardOf(ctx, f);
    return c.json({ card, ...(card.hasBody ? { body: await bodyOf(ctx, f.item) } : {}) });
  });

  reg.add({ method: 'get', path: '/items/:item/history', summary: "An item's events, newest first, a page at a time", tag: 'items', params: ['item'], query: ['before', 'limit'], auth: 'viewer' });
  app.get('/items/:item/history', async (c) => c.json(await history(ctx, await findItem(ctx, principal(c), item(c)), { ...(intParam(c.req.query('before'), 'before') ? { before: intParam(c.req.query('before'), 'before')! } : {}), ...(intParam(c.req.query('limit'), 'limit') ? { limit: intParam(c.req.query('limit'), 'limit')! } : {}) })));

  reg.add({ method: 'get', path: '/items/:item/notes', summary: "An item's notes, newest first, a page at a time", tag: 'items', params: ['item'], query: ['before', 'limit'], auth: 'viewer' });
  app.get('/items/:item/notes', async (c) => c.json(await notes(ctx, await findItem(ctx, principal(c), item(c)), { ...(intParam(c.req.query('before'), 'before') ? { before: intParam(c.req.query('before'), 'before')! } : {}), ...(intParam(c.req.query('limit'), 'limit') ? { limit: intParam(c.req.query('limit'), 'limit')! } : {}) })));

  reg.add({ method: 'get', path: '/items', summary: 'get many by key (keys=VAN-1,VAN-2), or find: a page of items the caller may see, filtered, with the total; count=state|class|kind|holder answers counts', tag: 'items', query: ['keys', 'kind', 'state', 'class', 'holder', 'asker', 'parent', 'q', 'label.<name>', 'limit', 'offset', 'count'], auth: 'user' });
  app.get('/items', async (c) => {
    const p = principal(c);
    const keys = c.req.query('keys');
    if (keys) return c.json({ items: await get(ctx, p, keys.split(',').map((k) => k.trim()).filter(Boolean)) });
    const cls = c.req.query('class');
    if (cls && !(STATE_CLASSES as readonly string[]).includes(cls)) throw badRequest(`class is one of ${STATE_CLASSES.join(', ')}`);
    const count = c.req.query('count');
    if (count && !['state', 'class', 'kind', 'holder'].includes(count)) throw badRequest('count is state, class, kind, or holder');
    const labels = Object.fromEntries(Object.entries(c.req.queries()).filter(([k]) => k.startsWith('label.')).map(([k, v]) => [k.slice(6), v[0] ?? '']));
    const kind = c.req.query('kind');
    const opt = <T,>(v: T | undefined, k: string) => (v === undefined || v === '' ? {} : { [k]: v });
    const r = await find(ctx, p, {
      ...(kind ? { kinds: kind.split(',') } : {}),
      ...opt(c.req.query('state'), 'state'),
      ...(cls ? { class: cls as (typeof STATE_CLASSES)[number] } : {}),
      ...opt(c.req.query('holder'), 'holder'),
      ...opt(c.req.query('asker'), 'asker'),
      ...opt(c.req.query('parent'), 'parent'),
      ...opt(c.req.query('q'), 'q'),
      labels,
      ...opt(intParam(c.req.query('limit'), 'limit'), 'limit'),
      ...opt(intParam(c.req.query('offset'), 'offset'), 'offset'),
      ...(count ? { countBy: count as 'state' } : {}),
    });
    return c.json(r);
  });

  reg.add({ method: 'get', path: '/documents/:id/plan', summary: "The plan on a document: the items the caller may see that add, change, or retire its boxes and views, with where each stands and its horizon", tag: 'items', params: ['id'], auth: 'viewer' });
  app.get('/documents/:id/plan', async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'viewer');
    // A document that defines a kind draws its lifecycle; each state shows a live count of the items the reader may see in it.
    const kind = await maybe<{ prefix: string; definition: KindDef }>(ctx.db, 'select prefix, definition from item_kinds where document_id = $1', [document.id]);
    const lifecycle = kind && !kind.definition.drawnIn.shipped ? { view: kind.definition.drawnIn.view, prefix: kind.prefix, counts: (await find(ctx, p, { kinds: [kind.prefix], countBy: 'state' })).counts ?? {} } : undefined;
    return c.json({ items: await planOf(ctx, p, document.id), ...(lifecycle ? { lifecycle } : {}) });
  });

  reg.add({ method: 'post', path: '/apps', summary: "Register a module's OAuth client with the kinds it works and the workspace they live in; admins only", tag: 'items', body: { clientId: 'the client id the issuer signs for', name: 'name', workspace: 'workspace slug', kinds: '[prefixes]' }, auth: 'admin' });
  app.post('/apps', async (c) => c.json({ app: await registerApp(ctx, principal(c), await body(c, AppBody)) }));

  reg.add({ method: 'get', path: '/apps', summary: "Modules' apps and the kinds each works; admins only", tag: 'items', auth: 'admin' });
  app.get('/apps', async (c) => c.json({ apps: await listApps(ctx, principal(c)) }));

  reg.add({ method: 'put', path: '/kinds/:prefix', summary: "Load a kind's file from a pipeline: the document with its kind block, made or changed. A module loads its own kinds into its own workspace", tag: 'items', params: ['prefix'], body: { yaml: 'the kinds file', workspace: 'for a person: the workspace slug' }, auth: 'author' });
  app.put('/kinds/:prefix', async (c) => {
    const b = await body(c, KindBody);
    return c.json(await loadKind(ctx, principal(c), c.req.param('prefix'), b.yaml, b.workspace));
  });

  reg.add({ method: 'delete', path: '/items/:item', summary: "Erase what an item says, for good: a hard delete that is itself an event and keeps the history's order. Admins only", tag: 'items', params: ['item'], body: { reason: 'why' }, auth: 'admin' });
  app.delete('/items/:item', async (c) => answer(c, await erase(ctx, principal(c), item(c), (await body(c, EraseBody)).reason, idempotencyKey(c))));

  reg.add({ method: 'get', path: '/changes', summary: 'changes: everything that changed after a position, in order, on items the caller may see; carry on from next', tag: 'items', query: ['after', 'limit', 'kinds'], auth: 'user' });
  app.get('/changes', async (c) => {
    const kinds = c.req.query('kinds');
    return c.json(await changes(ctx, principal(c), { ...(intParam(c.req.query('after'), 'after') !== undefined ? { after: intParam(c.req.query('after'), 'after')! } : {}), ...(intParam(c.req.query('limit'), 'limit') ? { limit: intParam(c.req.query('limit'), 'limit')! } : {}), ...(kinds ? { kinds: kinds.split(',') } : {}) }));
  });

  return app;
}
