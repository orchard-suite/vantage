import { describe, expect, test } from 'bun:test';
import { testContext, testUser, SAMPLE_YAML } from '../testing.ts';
import { createHubApp, type Lifecycle } from './app.ts';
import { createLive } from '../live.ts';
import { saveDocument } from '../documents/save.ts';
import { accessibleWorkspaces } from '../authz.ts';

describe('draining a web pod', () => {
  test('readiness fails while draining, every answer closes its connection, and closing the live streams ends them with a reconnect hint', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'local');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    await saveDocument(ctx, { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api', yaml: SAMPLE_YAML });
    const lifecycle: Lifecycle = { draining: false };
    const live = createLive(ctx.db, ctx.log);
    const app = createHubApp(ctx, { live, lifecycle });
    expect((await app.request('/readyz')).status).toBe(200);
    // A shared part being down is reported, not a reason to leave the load balancer.
    const realQuery = ctx.db.query.bind(ctx.db);
    ctx.db.query = (async (text: string, params?: readonly unknown[]) => {
      if (text === 'select 1 as ok') throw new Error('database unreachable');
      return realQuery(text, params);
    }) as typeof ctx.db.query;
    const degraded = await app.request('/readyz');
    expect(degraded.status).toBe(200);
    expect(((await degraded.json()) as { ok: boolean; checks: Record<string, string> }).checks['db']).not.toBe('ok');
    ctx.db.query = realQuery;
    const before = await app.request('/healthz');
    expect([before.status, before.headers.get('connection')]).toEqual([200, null]);

    const res = await app.request(`/w/${ws.slug}/sample/api/events`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('retry: 1000');
    await new Promise((r) => setTimeout(r, 20));
    expect(live.size()).toBe(1);

    lifecycle.draining = true;
    const ready = await app.request('/readyz');
    expect(ready.status).toBe(503);
    expect(((await ready.json()) as { checks: Record<string, string> }).checks['draining']).toBeDefined();
    expect(ready.headers.get('connection')).toBe('close');
    expect((await app.request('/no/such/page')).headers.get('connection')).toBe('close');
    expect(live.closeAll()).toBe(1);
    let done = false;
    for (let i = 0; i < 5 && !done; i++) done = (await reader.read()).done;
    expect(done).toBe(true);
  });
});
