import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import { applyEdits, describeEdits, editDocument } from './edit.ts';
import { saveDocument } from './save.ts';
import { listVersions } from './repo.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { testContext, testUser } from '../testing.ts';

const DOC = `title: Shop   # the shop
nodes:
  - name: Shoppers
    type: users
  - id: azure
    name: Azure
    type: cloud
    children:
      # the API tier
      - name: Orders API
        type: api
        subtitle: ASP.NET 10
        facts: ["Owner: Platform"]
      - name: Orders DB
        type: database
relations:
  - { from: shoppers, to: orders-api, label: buys }
  - { id: writes, from: orders-api, to: orders-db, label: writes }
views:
  - id: context
    title: Context
    include: { tags: [context] }
`;

describe('applyEdits', () => {
  test('set changes a value and leaves every other line as written', () => {
    const out = applyEdits(DOC, [{ op: 'set', path: 'nodes.azure.children.orders-api.subtitle', value: 'ASP.NET 11' }]);
    expect(out).toBe(DOC.replace('ASP.NET 10', 'ASP.NET 11'));
  });

  test('a node is found by the slug of its name at any depth, and a list item by id or index', () => {
    const out = applyEdits(DOC, [
      { op: 'set', path: 'nodes.orders-db.subtitle', value: 'Postgres' },
      { op: 'set', path: 'relations.writes.label', value: 'stores' },
      { op: 'set', path: ['relations', 0, 'label'], value: 'orders' },
      { op: 'set', path: 'views.context.title', value: 'Who talks to whom' },
    ]);
    const m = parse(out);
    expect(m.nodes[1].children[1].subtitle).toBe('Postgres');
    expect(m.relations[0].label).toBe('orders');
    expect(m.relations[1].label).toBe('stores');
    expect(m.views[0].title).toBe('Who talks to whom');
  });

  test('add appends to a list, creates a missing list, and adds keys to a map', () => {
    const out = applyEdits(DOC, [
      { op: 'add', path: 'nodes.azure.children', value: { name: 'Cache', type: 'cache' } },
      { op: 'add', path: 'nodes.shoppers.tags', value: 'tier-1' },
      { op: 'add', path: 'nodes.orders-api.facts', value: 'Version: 1.2' },
      { op: 'add', path: 'views.context', value: { question: 'Who buys?' } },
    ]);
    const m = parse(out);
    expect(m.nodes[1].children.map((c: { name: string }) => c.name)).toEqual(['Orders API', 'Orders DB', 'Cache']);
    expect(m.nodes[0].tags).toEqual(['tier-1']);
    expect(m.nodes[1].children[0].facts).toEqual(['Owner: Platform', 'Version: 1.2']);
    expect(m.views[0].question).toBe('Who buys?');
  });

  test('remove deletes a key and a list item', () => {
    const out = applyEdits(DOC, [
      { op: 'remove', path: 'nodes.orders-api.subtitle' },
      { op: 'remove', path: 'relations.writes' },
    ]);
    const m = parse(out);
    expect(m.nodes[1].children[0].subtitle).toBeUndefined();
    expect(m.relations).toHaveLength(1);
  });

  test('comments survive', () => {
    const out = applyEdits(DOC, [{ op: 'add', path: 'nodes.azure.children', value: { name: 'Cache', type: 'cache' } }, { op: 'set', path: 'title', value: 'Store' }]);
    expect(out).toContain('# the API tier');
    expect(out).toContain('title: Store # the shop');
  });

  test('an edit inside a line the writer would reformat rewrites only that line', () => {
    const out = applyEdits(DOC, [{ op: 'set', path: 'relations.writes.label', value: 'stores' }]);
    expect(out).toBe(DOC.replace('{ id: writes, from: orders-api, to: orders-db, label: writes }', '{id: writes, from: orders-api, to: orders-db, label: stores}'));
  });

  test('later operations see earlier ones', () => {
    const out = applyEdits(DOC, [
      { op: 'add', path: 'nodes', value: { name: 'Queue', type: 'queue' } },
      { op: 'set', path: 'nodes.queue.subtitle', value: 'Service Bus' },
    ]);
    expect(parse(out).nodes[2]).toEqual({ name: 'Queue', type: 'queue', subtitle: 'Service Bus' });
  });

  test('a failing operation names its index and why', () => {
    expect(() => applyEdits(DOC, [{ op: 'set', path: 'title', value: 'X' }, { op: 'set', path: 'nodes.nope.subtitle', value: 'Y' }])).toThrow(/operation 1 \(set nodes.nope.subtitle\) failed: nodes has no item nope/);
    expect(() => applyEdits(DOC, [{ op: 'remove', path: 'nodes.shoppers.missing' }])).toThrow(/operation 0 .*nothing at missing/);
    expect(() => applyEdits(DOC, [{ op: 'set', path: 'relations.9', value: {} }])).toThrow(/has no item 9/);
    expect(() => applyEdits(DOC, [{ op: 'add', path: 'title', value: 'x' }])).toThrow(/holds a value/);
    expect(() => applyEdits(DOC, [{ op: 'add', path: 'views.context', value: { title: 'x' } }])).toThrow(/key title is already there/);
    expect(() => applyEdits(DOC, [{ op: 'set', path: 'title.x', value: 1 }])).toThrow(/title is a value/);
  });

  test('the default message lists the operations', () => {
    expect(describeEdits([{ op: 'set', path: 'title', value: 'x' }, { op: 'remove', path: ['relations', 0] }])).toBe('edit: set title; remove relations.0');
  });
});

describe('editDocument', () => {
  test('saves one version, merges a concurrent save, and saves nothing when an operation fails', async () => {
    const ctx = await testContext();
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const who = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
    const first = await saveDocument(ctx, { ...who, yaml: DOC });
    if (first.status !== 'saved') throw new Error('expected a save');
    const v1 = first.version.id;
    const other = await saveDocument(ctx, { ...who, documentId: first.document.id, yaml: DOC.replace('title: Shop', 'title: Store'), expectedVersionId: v1 });
    expect(other.status).toBe('saved');

    const edited = await editDocument(ctx, { ...who, document: first.document, expectedVersionId: v1, operations: [{ op: 'set', path: 'nodes.orders-db.subtitle', value: 'Postgres' }, { op: 'remove', path: 'relations.writes' }] });
    expect(edited.status).toBe('saved');
    if (edited.status !== 'saved') return;
    expect(edited.merged).toBe(true);
    expect(edited.version.message).toBe('edit: set nodes.orders-db.subtitle; remove relations.writes');
    expect(edited.version.yaml).toContain('title: Store');
    expect(edited.version.yaml).toContain('subtitle: Postgres');
    expect(edited.version.yaml).not.toContain('id: writes');

    const failed = editDocument(ctx, { ...who, document: first.document, operations: [{ op: 'set', path: 'title', value: 'Lost' }, { op: 'remove', path: 'nodes.ghost' }] });
    await expect(failed).rejects.toThrow(/operation 1/);
    const versions = await listVersions(ctx.db, first.document.id);
    expect(versions).toHaveLength(3);
    expect(versions[0]!.id).toBe(edited.version.id);
    await ctx.db.close();
  });
});
