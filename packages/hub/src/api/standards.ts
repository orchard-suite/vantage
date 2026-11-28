/**
 * The estate's standards over HTTP (VAN-3018): the settings, a scope's
 * built standard as text with its edition, and the steward's publish.
 * Each route goes through the same code the text verbs do.
 */
import { Hono } from 'hono';
import { stringify } from 'yaml';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { principal } from './common.ts';
import { whoOf } from '../decisions/write.ts';
import { scopeKey } from '../standards/model.ts';
import { publishEdition } from '../standards/publish.ts';
import { editionOf } from '../standards/repo.ts';
import { standardSetting } from '../standards/setting.ts';
import { parseStandardName, standardThing } from '../standards/text.ts';
import { writeStandardSettings } from '../standards/write.ts';

export function standardRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/standards', summary: "The estate's standard settings: binding words, who a line may bind, the steward gate, the withheld words, and the packs each scope adopts", tag: 'standards', auth: 'user', responses: { '200': '{ bindings, binds, steward_gate, withhold, packs: { scope: [{ pack, version, hash, origin, parameters, on }] } }' } });
  app.get('/standards', async (c) => c.json(await standardSetting(ctx.db, principal(c).orgId)));

  reg.add({ method: 'put', path: '/standards', summary: "Replace the estate's standard settings. The lists, the gate, and the withheld words are an admin's; a scope's packs are its steward's. Every scope's standard is built again", tag: 'standards', auth: 'user', body: { bindings: '[must, should, may]', binds: '[people, agents, systems]', steward_gate: 'false', withhold: '[words]', packs: '{ scope: [{ pack, version, hash, origin, parameters, on }] }' }, responses: { '200': '{ status, version, message }' } });
  app.put('/standards', async (c) => {
    const p = principal(c);
    return c.json(await writeStandardSettings(ctx, p, stringify(await c.req.json()), p.surface));
  });

  reg.add({ method: 'get', path: '/standards/:scope', summary: "A scope's built standard, estate for the whole estate, scope@n for edition n: the edition with its manifest, lines, packs, exceptions, pages, and changes, and its text", tag: 'standards', params: ['scope'], auth: 'user', responses: { '200': '{ edition: { scope, version, state, hash, manifest, body, changes, problems, publishedAt } | null, version, text }', '404': 'no such scope or edition' } });
  app.get('/standards/:scope', async (c) => {
    const p = principal(c);
    const thing = await standardThing(ctx, p, c.req.param('scope'));
    const { name, version } = parseStandardName(c.req.param('scope'));
    return c.json({ edition: (await editionOf(ctx.db, p.orgId, scopeKey(name), version)) ?? null, version: thing.version, text: thing.text });
  });

  reg.add({ method: 'post', path: '/standards/:scope/publish', summary: "Publish the edition of a scope's standard that waits for its steward; the scope's steward or an admin", tag: 'standards', params: ['scope'], auth: 'user', responses: { '200': '{ message }', '400': 'no edition waits', '403': 'not the steward' } });
  app.post('/standards/:scope/publish', async (c) => {
    const p = principal(c);
    return c.json({ message: await publishEdition(ctx, p, c.req.param('scope'), whoOf(p)) });
  });
  return app;
}
