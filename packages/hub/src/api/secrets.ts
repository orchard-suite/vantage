/**
 * The sealed secret store by name. A value goes in and never comes out:
 * listing returns names and times, and connector or target config refers
 * to a secret by its name.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, who } from './common.ts';
import { requireAdmin } from '../authz.ts';
import { audit } from '../audit.ts';
import { badRequest, notFound } from '../http.ts';
import { deleteSecret, listSecrets, putSecret, SECRET_NAME } from '../secrets.ts';

export function secretRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/secrets', summary: 'Names of stored secrets; values are never returned', tag: 'secrets', auth: 'admin' });
  app.get('/secrets', async (c) => {
    const p = requireAdmin(c.get('principal'));
    return c.json({ secrets: (await listSecrets(ctx.db, p.orgId)).map((s) => ({ name: s.name, createdAt: s.created_at, updatedAt: s.updated_at })) });
  });

  reg.add({ method: 'put', path: '/secrets/:name', summary: 'Store or replace a secret value under a name', tag: 'secrets', params: ['name'], body: { value: 'the secret' }, auth: 'admin', responses: { '200': 'stored' } });
  app.put('/secrets/:name', async (c) => {
    const p = requireAdmin(c.get('principal'));
    const name = c.req.param('name');
    if (!SECRET_NAME.test(name)) throw badRequest('secret names are letters, digits, and _ . : / - up to 200 characters');
    const input = await body(c, z.object({ value: z.string().min(1).max(100_000) }).strict());
    const row = await putSecret(ctx.db, ctx.config.SECRETS_KEY, p.orgId, name, input.value);
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'secret.put', surface: p.surface, target: `secret:${name}`, details: { bytes: input.value.length } });
    return c.json({ name: row.name, createdAt: row.created_at, updatedAt: row.updated_at });
  });

  reg.add({ method: 'delete', path: '/secrets/:name', summary: 'Delete a secret; sources and publications that name it fail on their next run', tag: 'secrets', params: ['name'], auth: 'admin', responses: { '204': 'deleted' } });
  app.delete('/secrets/:name', async (c) => {
    const p = requireAdmin(c.get('principal'));
    const name = c.req.param('name');
    if (!(await deleteSecret(ctx.db, p.orgId, name))) throw notFound('secret');
    await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'secret.delete', surface: p.surface, target: `secret:${name}` });
    return c.body(null, 204);
  });

  return app;
}
