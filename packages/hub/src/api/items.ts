/**
 * Tracked items over HTTP (VAN-5001): nine verbs, the same
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
import { ask, attach, claim, finish, hold, link, move, note, put, release, renew, type WriteAnswer } from '../tracking/write.ts';
import { queue } from '../tracking/queue.ts';
import { importRoadmap } from '../tracking/import.ts';
import { pick, CARD_FIELDS, ROW_FIELDS } from '../tracking/fields.ts';
import { STATE_CLASSES } from '@vantage/model';
import { listApps, registerApp } from '../tracking/apps.ts';
import { erase, loadKind } from '../tracking/admin.ts';
import { maybe } from '../db/db.ts';
import type { KindDef } from '../tracking/kinds.ts';

const Labels = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const BodyEdit = z.object({ old: z.string().min(1), new: z.string() }).strict();
const PutBody = z.object({ kind: z.string().optional(), item: z.string().optional(), ref: z.string().min(1).max(200).optional(), title: z.string().optional(), labels: Labels.optional(), revision: z.string().min(1).max(200).optional(), body: z.string().max(200_000).optional(), edits: z.array(BodyEdit).min(1).max(50).optional(), parent: z.string().optional() }).strict();
// ask is a move whose lifecycle picks the state that waits for a person.
const MoveBody = z.object({ to: z.string().optional(), note: z.string().optional(), revision: z.string().optional(), ask: z.string().optional() }).strict();
// A claim is a hold that runs out; renew keeps one.
const HoldBody = z.object({ person: z.string().optional(), claim: z.union([z.literal(true), z.number().int().min(1).max(240)]).optional(), renew: z.literal(true).optional() }).strict();
const Run = z.object({ summary: z.string(), proof: z.array(z.string()).optional(), handoff: z.string().optional(), seconds: z.number().nonnegative().optional(), cost: z.object({ amount: z.number(), currency: z.string().min(1).max(10), tokens: z.number().int().nonnegative().optional() }).strict().optional() }).strict();
// Finishing a run is a release that carries the run record, and the move it ends with.
const ReleaseBody = z.object({ person: z.string().optional(), run: Run.optional(), move: z.string().optional() }).strict();
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
        HoldBody.extend({ verb: z.literal('hold'), item: z.string(), key: z.string().min(1).max(200) }),
        ReleaseBody.extend({ verb: z.literal('release'), item: z.string(), key: z.string().min(1).max(200) }),
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

type Ctx = AppContext;
type P = ReturnType<typeof principal>;

/** move, or its ask form. */
function moveVerb(ctx: Ctx, p: P, ref: string, b: z.infer<typeof MoveBody>, key: string): Promise<WriteAnswer> {
  if (b.ask !== undefined) {
    if (b.to !== undefined || b.revision !== undefined) throw badRequest('ask moves to the state its lifecycle waits in; leave out to and revision');
    return ask(ctx, p, ref, b.ask, key);
  }
  if (!b.to) throw badRequest('a move names the state to go to (to), or asks a person a question (ask)');
  return move(ctx, p, ref, { to: b.to, note: b.note, revision: b.revision }, key);
}

/** hold, or its claim and renew forms. */
function holdVerb(ctx: Ctx, p: P, ref: string, b: z.infer<typeof HoldBody>, key: string): Promise<WriteAnswer> {
  if (b.claim !== undefined && b.renew) throw badRequest('claim takes the item; renew keeps a claim you hold; send one');
  if ((b.claim !== undefined || b.renew) && b.person !== undefined && b.person !== 'me') throw badRequest('a claim is always your own; leave out person');
  if (b.renew) return renew(ctx, p, ref, key);
  if (b.claim !== undefined) return claim(ctx, p, ref, typeof b.claim === 'number' ? b.claim : undefined, key);
  return hold(ctx, p, ref, b.person, key);
}

/** release, or its finish form: the run record, its move, and letting go. */
function releaseVerb(ctx: Ctx, p: P, ref: string, b: z.infer<typeof ReleaseBody>, key: string): Promise<WriteAnswer> {
  if (!b.run) {
    if (b.move !== undefined) throw badRequest('a release moves the item only as it finishes a run; send run with move, or move the item first');
    return release(ctx, p, ref, b.person, key);
  }
  if (b.person !== undefined && b.person !== 'me') throw badRequest('a run is finished by the one who ran it; leave out person');
  const r = b.run;
  return finish(ctx, p, ref, { move: b.move, run: { summary: r.summary, proof: r.proof ?? [], ...(r.handoff !== undefined ? { handoff: r.handoff } : {}), ...(r.seconds !== undefined ? { seconds: r.seconds } : {}), ...(r.cost ? { cost: { amount: r.cost.amount, currency: r.cost.currency, ...(r.cost.tokens !== undefined ? { tokens: r.cost.tokens } : {}) } } : {}) } }, key);
}

/** `fields=title,state` as a list, or undefined for every field. */
const fieldsOf = (raw: string | undefined): string[] | undefined => (raw ? raw.split(',').map((f) => f.trim()).filter(Boolean) : undefined);

/** `held=VAN-1@5,VAN-2@7`: the version of each item the caller already holds. */
function heldOf(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (raw ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const at = pair.lastIndexOf('@');
    const n = Number(pair.slice(at + 1));
    if (at < 1 || !Number.isInteger(n) || n < 0) throw badRequest('held is key@version pairs: held=VAN-1@5,VAN-2@7');
    out[pair.slice(0, at)] = n;
  }
  return out;
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

  reg.add({ method: 'put', path: '/items', summary: "put: make an item, or change the fields named; by the caller's own key (kind + ref) it is safe to send twice", tag: 'items', body: { kind: 'prefix, for a new item or one named by ref', item: 'optional: an item to change', ref: "optional: the owner's own key", title: 'optional', labels: 'optional: {name: value}; null removes one', revision: 'optional: the content revision', body: 'optional: Markdown, for a new item of a kind the hub keeps', edits: "optional: [{old, new}], each old matching the body exactly once; how a body changes", parent: 'optional: an item key' }, auth: 'author', responses: { '201': 'created', '200': 'changed, unchanged, or a repeat' } });
  app.put('/items', async (c) => answer(c, await put(ctx, principal(c), await body(c, PutBody), idempotencyKey(c)), true));

  reg.add({ method: 'put', path: '/items/roadmap', summary: 'put many: a Markdown roadmap (a table with an outcome column, or bullets under Now, Next, and Later) as items of a kind, sent as the request body; sent twice it makes nothing twice', tag: 'items', query: ['kind', 'dryRun'], auth: 'author' });
  app.put('/items/roadmap', async (c) => {
    const kind = c.req.query('kind');
    if (!kind) throw badRequest('name the kind: ?kind=PLAN');
    return c.json({ lines: await importRoadmap(ctx, principal(c), kind, await c.req.text(), c.req.query('dryRun') === 'true') });
  });

  reg.add({ method: 'post', path: '/items/:item/move', summary: 'move: change state through the lifecycle; a refusal (409) names the moves open. ask: a question for a person moves the item to the state its lifecycle waits in', tag: 'items', params: ['item'], body: { to: 'a state id', note: 'optional; some moves need one', revision: 'optional; some moves pin one', ask: 'optional, in place of to: a question for a person' }, auth: 'viewer', responses: { '409': 'the lifecycle refuses it; details.open lists the moves open' } });
  app.post('/items/:item/move', async (c) => answer(c, await moveVerb(ctx, principal(c), item(c), await body(c, MoveBody), idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/:item/hold', summary: 'hold: who has it now; person is me or an email. claim: hold it for a while (true: 20 minutes, or minutes), offered again when it runs out; renew: keep your claim', tag: 'items', params: ['item'], body: { person: 'optional: me or an email', claim: 'optional: true or minutes', renew: 'optional: true' }, auth: 'viewer' });
  app.post('/items/:item/hold', async (c) => answer(c, await holdVerb(ctx, principal(c), item(c), await body(c, HoldBody), idempotencyKey(c))));

  reg.add({ method: 'post', path: '/items/:item/release', summary: 'release: let go of an item. run: finish a run as you let go, with its record and the move it ends with', tag: 'items', params: ['item'], body: { person: 'optional: me or an email', run: 'optional: {summary, proof, handoff, seconds, cost}', move: 'optional, with run: the state to end in' }, auth: 'viewer' });
  app.post('/items/:item/release', async (c) => answer(c, await releaseVerb(ctx, principal(c), item(c), await body(c, ReleaseBody), idempotencyKey(c))));

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
            case 'move': {
              const { item: ref, ...b } = rest as z.infer<typeof MoveBody> & { item: string };
              return moveVerb(ctx, p, ref, b, key);
            }
            case 'hold': {
              const { item: ref, ...b } = rest as z.infer<typeof HoldBody> & { item: string };
              return holdVerb(ctx, p, ref, b, key);
            }
            case 'release': {
              const { item: ref, ...b } = rest as z.infer<typeof ReleaseBody> & { item: string };
              return releaseVerb(ctx, p, ref, b, key);
            }
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

  reg.add({ method: 'get', path: '/items/:item', summary: "get: one item's card, and its body when the hub keeps it; fields=title,state,body answers only those; held=<version> answers an unchanged item with nothing", tag: 'items', params: ['item'], query: ['held', 'fields'], auth: 'viewer' });
  app.get('/items/:item', async (c) => {
    const p = principal(c);
    const f = await findItem(ctx, p, item(c));
    if (intParam(c.req.query('held'), 'held') === f.item.position) return c.json({ item: f.item.key, unchanged: f.item.position });
    const fields = fieldsOf(c.req.query('fields'));
    const card = await cardOf(ctx, f);
    const withBody = card.hasBody && (!fields || fields.includes('body'));
    return c.json({ card: pick(card, fields?.filter((x) => x !== 'body'), CARD_FIELDS), ...(withBody ? { body: await bodyOf(ctx, f.item) } : {}) });
  });

  reg.add({ method: 'get', path: '/items/:item/history', summary: "An item's events, newest first, a page at a time", tag: 'items', params: ['item'], query: ['before', 'limit'], auth: 'viewer' });
  app.get('/items/:item/history', async (c) => c.json(await history(ctx, await findItem(ctx, principal(c), item(c)), { ...(intParam(c.req.query('before'), 'before') ? { before: intParam(c.req.query('before'), 'before')! } : {}), ...(intParam(c.req.query('limit'), 'limit') ? { limit: intParam(c.req.query('limit'), 'limit')! } : {}) })));

  reg.add({ method: 'get', path: '/items/:item/notes', summary: "An item's notes, newest first, a page at a time", tag: 'items', params: ['item'], query: ['before', 'limit'], auth: 'viewer' });
  app.get('/items/:item/notes', async (c) => c.json(await notes(ctx, await findItem(ctx, principal(c), item(c)), { ...(intParam(c.req.query('before'), 'before') ? { before: intParam(c.req.query('before'), 'before')! } : {}), ...(intParam(c.req.query('limit'), 'limit') ? { limit: intParam(c.req.query('limit'), 'limit')! } : {}) })));

  reg.add({ method: 'get', path: '/items', summary: 'get many by key (keys=VAN-1,VAN-2, held=VAN-1@5), or find: a page of items the caller may see, filtered, with the total; count=state|class|kind|holder answers counts; list=queue answers what the caller may pick up; fields=title,state answers only those', tag: 'items', query: ['keys', 'held', 'kind', 'state', 'class', 'holder', 'asker', 'parent', 'q', 'label.<name>', 'limit', 'offset', 'count', 'list', 'fields'], auth: 'user' });
  app.get('/items', async (c) => {
    const p = principal(c);
    const fields = fieldsOf(c.req.query('fields'));
    const keys = c.req.query('keys');
    if (keys) return c.json({ items: (await get(ctx, p, keys.split(',').map((k) => k.trim()).filter(Boolean), heldOf(c.req.query('held')))).map((x) => ('card' in x ? { card: pick(x.card, fields, CARD_FIELDS) } : x)) });
    const list = c.req.query('list');
    if (list !== undefined && list !== 'queue') throw badRequest('list is queue: what you may pick up');
    if (list === 'queue') {
      const kind = c.req.query('kind');
      const limit = intParam(c.req.query('limit'), 'limit');
      return c.json(await queue(ctx, p, { ...(kind ? { kinds: kind.split(',') } : {}), ...(limit ? { limit } : {}) }));
    }
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
    return c.json(fields ? { ...r, rows: r.rows.map((row) => pick(row, fields, ROW_FIELDS)) } : r);
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
