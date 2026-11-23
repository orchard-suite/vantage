/**
 * The text space over HTTP, for the laptop's working copy: what sits under
 * an address, a thing's whole text, one of a document's files, and a write
 * of many things with the versions they were read from. It is the same
 * text the agent verbs answer, read through the same module; here nothing
 * is cut to a size, because a program reads it and no model does.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal } from './common.ts';
import { assetKey } from '../documents/assets.ts';
import { badRequest, notFound } from '../http.ts';
import { parseAddress } from '../text/address.ts';
import { listThings } from '../text/list.ts';
import { readThing, requireDocumentAt } from '../text/things.ts';
import { write } from '../text/change.ts';
import { REFUSED, REFUSES } from '../documents/check.ts';

const WriteBody = z.object({
  writes: z.array(z.object({ address: z.string().min(1).max(600), text: z.string().max(2_000_000), base: z.string().max(200).optional() })).max(500),
  assets: z.record(z.string(), z.string()).optional(),
  message: z.string().max(500).optional(),
});

export function textRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const address = (value: string | undefined) => {
    if (!value) throw badRequest('address is required');
    return parseAddress(value);
  };

  reg.add({ method: 'get', path: '/text/list', summary: 'What sits under an address (a document, a registry, a record, or a workspace) as the files of a working copy: each with its address, version, and path', tag: 'text', query: ['address'], auth: 'viewer' });
  app.get('/text/list', async (c) => c.json({ things: await listThings(ctx, principal(c), address(c.req.query('address'))) }));

  reg.add({ method: 'get', path: '/text/read', summary: 'The whole text form of one thing, with the version to send back when writing it', tag: 'text', query: ['address'], auth: 'viewer', responses: { '200': '{ address, version, text }' } });
  app.get('/text/read', async (c) => {
    const t = await readThing(ctx, principal(c), address(c.req.query('address')));
    return c.json({ address: t.address, version: t.version, text: t.text });
  });

  reg.add({ method: 'get', path: '/text/file', summary: "One of a head version's files as bytes: a picture, a page, an artifact, or an imported file", tag: 'text', query: ['address'], auth: 'viewer' });
  app.get('/text/file', async (c) => {
    const a = address(c.req.query('address'));
    if (a.kind !== 'page') throw badRequest('name a file of a document: workspace/document/path');
    const { doc, head } = await requireDocumentAt(ctx, principal(c), a, 'viewer');
    const imported = (head.imports ?? {})[a.page] ?? (head.imports ?? {})[`./${a.page}`];
    if (imported !== undefined) return c.body(imported, 200, { 'content-type': 'text/plain; charset=utf-8' });
    const file = head.attachments.find((x) => x.path === a.page);
    const bytes = file ? await ctx.blob.get(assetKey(doc.org_id, file.hash)) : undefined;
    if (!file || !bytes) throw notFound(`file ${a.page}`);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': file.contentType });
  });

  reg.add({ method: 'post', path: '/text/write', summary: `Write the whole text of many things. Writes to one document, its pages included, are one version; each thing saves whole or not at all. A write that names the version it was read from is merged line by line when the thing moved since. ${REFUSES}`, tag: 'text', body: { writes: '[{ address, text, base }]', assets: '{ path: base64 } for the one document written', message: 'what changed and why' }, auth: 'author', responses: { '200': '{ results: [{ address, status, version, message, preview }] }', ...REFUSED } });
  app.post('/text/write', async (c) => {
    const p = principal(c);
    const input = await body(c, WriteBody);
    return c.json({ results: await write(ctx, p, input.writes, input.assets, { message: input.message, surface: p.surface }) });
  });
  return app;
}
