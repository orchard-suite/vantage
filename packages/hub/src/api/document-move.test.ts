import { describe, expect, test } from 'bun:test';
import { SAMPLE_YAML, testApp, type TestApp } from '../testing.ts';

type Ws = { slug: string };

async function diagram(t: TestApp, headers: Record<string, string>, ws: string, name: string): Promise<{ id: string; slug: string }> {
  await t.json(`/api/v1/workspaces/${ws}/documents`, { method: 'POST', headers, body: JSON.stringify({ yaml: SAMPLE_YAML, name }) });
  const docs = (await t.json(`/api/v1/workspaces/${ws}/documents`, { headers })).body['documents'] as { id: string; slug: string; name: string }[];
  return docs.find((d) => d.name === name)!;
}

describe('a document takes a new slug through its move', () => {
  test('renames in place, moves and renames at once, and the old addresses send people on; a taken or malformed slug is refused', async () => {
    const t = await testApp();
    const me = await t.bearer('admin', { admin: true });
    const home = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as Ws[])[0]!.slug;
    const team = (await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Platform' }) })).body as Ws;
    const doc = await diagram(t, me.headers, home, 'Shop map');
    const move = (body: Record<string, unknown>) => t.json(`/api/v1/documents/${doc.id}/move`, { method: 'POST', headers: me.headers, body: JSON.stringify(body) });

    expect((await move({})).status).toBe(400);
    expect((await move({ slug: 'Shop Atlas' })).status).toBe(400);

    const renamed = await move({ slug: 'shop-atlas' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: doc.id, slug: 'shop-atlas', workspace: home, url: `/w/${home}/shop-atlas` });
    const old = await t.app.request(`/w/${home}/${doc.slug}`, { headers: me.headers });
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe(`/w/${home}/shop-atlas`);
    const audit = await t.ctx.db.query<{ target: string; details: { slug: string; newSlug: string } }>("select target, details from audit where what = 'document.move'");
    expect(audit.map((a) => [a.target, a.details.slug, a.details.newSlug])).toEqual([[expect.stringMatching(/^workspace:/), doc.slug, 'shop-atlas']]);

    const both = await move({ workspace: team.slug, slug: 'storefront' });
    expect(both.body).toMatchObject({ slug: 'storefront', workspace: team.slug, url: `/w/${team.slug}/storefront` });
    for (const from of [doc.slug, 'shop-atlas']) expect((await t.app.request(`/w/${home}/${from}`, { headers: me.headers })).headers.get('location')).toBe(`/w/${team.slug}/storefront`);

    const other = await diagram(t, me.headers, team.slug, 'Billing map');
    const taken = await move({ slug: other.slug });
    expect(taken.status).toBe(409);
    expect(taken.body['error']).toContain(`already has a diagram at ${other.slug}`);
    await t.ctx.db.close();
  });
});
