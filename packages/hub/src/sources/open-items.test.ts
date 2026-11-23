import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';
import { observedForDocument } from '../worker/artifacts.ts';
import { documentById } from '../documents/repo.ts';
import { observedModel } from './repo.ts';

const YAML = `title: Shop
nodes:
  - { id: api, name: Orders API, type: api, bind: catalog:svc:orders }
  - { id: db, name: Orders DB, type: database, bind: catalog:db:orders }
relations:
  - { from: api, to: db, label: writes, tags: [data] }
views:
  - { id: data, title: Data, include: { tags: [data] } }
`;

describe('open items in the hub', () => {
  test('items from a connector the document never binds land on its boxes, and closing them redraws it', async () => {
    const t = await testApp();
    const worker = createWorker(t.ctx);
    const author = await t.bearer('author');
    const ws = ((await t.json('/api/v1/workspaces', { headers: author.headers })).body['workspaces'] as { slug: string }[])[0]!;
    const base = `/api/v1/workspaces/${ws.slug}/connectors`;
    const make = async (slug: string): Promise<string> => (await t.json(base, { method: 'POST', headers: author.headers, body: JSON.stringify({ name: slug, slug, connector: 'push', clientId: `c-${slug}` }) })).body['id'] as string;
    const catalog = await make('catalog');
    const tracker = await make('tracker');
    const push = async (id: string, slug: string, body: unknown): Promise<Record<string, number>> => {
      expect((await t.json(`/api/v1/connector/${id}/batches`, { method: 'POST', headers: await t.connector(`c-${slug}`), body: JSON.stringify(body) })).status).toBe(202);
      await worker.drain();
      return ((await t.json(`${base}/${slug}/runs?limit=1`, { headers: author.headers })).body['runs'] as { counts: Record<string, number> }[])[0]!.counts;
    };
    const saved = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: author.headers, body: JSON.stringify({ yaml: YAML }) });
    const doc = saved.body['document'] as { id: string; slug: string };
    await worker.drain();
    await push(catalog, 'catalog', {
      entities: [
        { id: 'svc:orders', type: 'api', name: 'Orders API', facts: { repository: 'https://github.com/acme/orders' }, items: [{ id: 'a1', kind: 'alert', title: 'Orders 5xx high', severity: 'critical' }] },
        { id: 'db:orders', type: 'database', name: 'Orders DB' },
      ],
    });
    const counts = await push(tracker, 'tracker', {
      entities: [],
      items: [
        { id: 'OPS-1', kind: 'issue', title: 'OPS-1 Slow carts', severity: 'high', target: { key: 'catalog:db:orders' } },
        { id: 'acme/orders#4', kind: 'pr', title: '#4 Retry writes', target: { fact: 'repository', value: 'acme/orders' } },
        { id: 'OPS-2', kind: 'issue', title: 'OPS-2 Elsewhere', target: { key: 'catalog:svc:other' } },
      ],
    });
    expect(counts).toMatchObject({ itemsOpen: 3, itemsOpened: 3, itemsClosed: 0, documentsOverlaid: 1 });
    expect(Object.keys((await observedModel(t.ctx.db, tracker)).model.items ?? {})).toHaveLength(3);

    const row = (await documentById(t.ctx.db, doc.id))!;
    const observed = await observedForDocument(t.ctx, row, { yaml: YAML, imports: {} });
    expect(Object.values(observed.model.items ?? {}).map((i) => i.id).sort()).toEqual(['OPS-1', 'a1', 'acme/orders#4']);
    expect(observed.sources).toEqual(['catalog', 'tracker']);

    const bundle = async (): Promise<string> => (await t.app.request(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}/artifacts/bundle`, { headers: author.headers })).text();
    const open = await bundle();
    expect(open).toContain('Orders 5xx high');
    expect(open).toContain('OPS-1 Slow carts');
    expect(open).toContain('#4 Retry writes');
    expect(open).not.toContain('OPS-2 Elsewhere');

    const closed = await push(tracker, 'tracker', { entities: [], items: [] });
    expect(closed).toMatchObject({ itemsOpen: 0, itemsClosed: 3, documentsOverlaid: 1 });
    const after = await bundle();
    expect(after).not.toContain('OPS-1 Slow carts');
    expect(after).toContain('Orders 5xx high');
    await t.ctx.db.close();
  });
});
