import { describe, expect, test } from 'bun:test';
import { DocumentSchema, resolveModel, type NodeOutput, type RelationView } from '@vantage/model';
import type { Batch } from './batch.ts';
import { expandObserved } from './observe.ts';
import { emptyObserved, mergeObserved } from './observed.ts';

// Two hypervisors with two VMs each, a bare server, a node on every machine,
// pods on the nodes, and two volumes with copies on two nodes each.
const batch: Batch = {
  source: 'lab',
  observed: '2026-10-31T10:00:00Z',
  entities: [
    { id: 'host:a', type: 'host', name: 'host-a', facts: { health: 'green' } },
    { id: 'host:b', type: 'host', name: 'host-b', facts: { health: 'amber' } },
    { id: 'vm:1', type: 'vm', name: 'vm-m1', parent: 'host:a', facts: {} },
    { id: 'vm:2', type: 'vm', name: 'vm-w1', parent: 'host:a', facts: {} },
    { id: 'vm:3', type: 'vm', name: 'vm-m2', parent: 'host:b', facts: {} },
    { id: 'vm:4', type: 'vm', name: 'vm-empty', parent: 'host:b', facts: {} },
    { id: 'machine:build-box', type: 'machine', name: 'build-box', facts: {} },
    { id: 'machine:laptop', type: 'machine', name: 'laptop', facts: {} },
    { id: 'node:m1', type: 'node', name: 'master-1', parent: 'vm:1', facts: { roles: ['etcd', 'control-plane'] } },
    { id: 'node:w1', type: 'node', name: 'worker-1', parent: 'vm:2', facts: { roles: ['worker'], health: 'red' } },
    { id: 'node:m2', type: 'node', name: 'master-2', parent: 'vm:3', facts: { roles: ['etcd'] } },
    { id: 'node:m3', type: 'node', name: 'master-3', parent: 'machine:build-box', facts: { roles: ['etcd'] } },
    { id: 'pod:a', type: 'pod', name: 'web-1', parent: 'node:w1', facts: {} },
    { id: 'pod:b', type: 'pod', name: 'web-2', parent: 'node:w1', facts: {} },
    { id: 'pod:c', type: 'pod', name: 'db-1', parent: 'node:m2', facts: {} },
    { id: 'vol:data', type: 'volume', name: 'data', facts: {} },
    { id: 'vol:logs', type: 'volume', name: 'logs', facts: {} },
  ],
  relations: [
    { from: 'vol:data', to: 'node:w1', label: 'nodes' },
    { from: 'vol:data', to: 'node:m2', label: 'nodes' },
    { from: 'vol:logs', to: 'node:w1', label: 'nodes' },
    { from: 'vol:logs', to: 'node:m1', label: 'nodes' },
    { from: 'pod:a', to: 'pod:c', label: 'calls' },
  ],
};
const model = mergeObserved(emptyObserved(), batch).model;

const doc = DocumentSchema.parse({
  title: 'Lab',
  nodes: [
    {
      id: 'lab',
      name: 'The lab',
      observe: {
        source: 'lab',
        types: ['host', 'machine', 'vm', 'node', 'pod'],
        prune: ['machine'],
        names: { vm: 'VM' },
        health: 'health',
        relations: ['calls'],
        group: 'Lab',
        view: { title: 'Where things run' },
        failure: {
          domains: ['host', 'machine'],
          quorum: { type: 'node', fact: 'roles', contains: 'etcd', name: 'etcd' },
          copies: { type: 'volume', relation: 'nodes' },
        },
      },
    },
  ],
});

const find = (nodes: readonly NodeOutput[], id: string): NodeOutput | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
};

describe('observe where', () => {
  const only = (where: Record<string, string | string[]>) =>
    expandObserved(DocumentSchema.parse({ title: 'Lab', nodes: [{ id: 'lab', name: 'The lab', observe: { source: 'lab', types: ['host', 'vm', 'node', 'pod'], where } }] }), model).nodes[0]!;

  test('keeps the boxes whose facts match, and what holds them', () => {
    const lab = only({ health: 'red' });
    expect(lab.children?.map((c) => c.name)).toEqual(['host-a']);
    expect(find(lab.children ?? [], 'lab.host.a')?.children?.map((c) => c.name)).toEqual(['vm-w1']);
    expect(find(lab.children ?? [], 'lab.node.w1')).toBeDefined();
    expect(find(lab.children ?? [], 'lab.pod.a')).toBeUndefined();
  });

  test('matches any listed value, case-insensitively, and every key', () => {
    expect(only({ health: ['RED', 'amber'] }).children?.map((c) => c.name)).toEqual(['host-a', 'host-b']);
    expect(only({ health: 'amber', roles: 'etcd' }).children ?? []).toEqual([]);
  });
});

describe('expandObserved', () => {
  const out = expandObserved(doc, model);
  const lab = out.nodes[0]!;

  test('nests entities by their nearest drawn ancestor, sorted by name, and binds each one', () => {
    expect(lab.children?.map((c) => c.name)).toEqual(['build-box', 'host-a', 'host-b']);
    const hostA = find(out.nodes, 'lab.host.a')!;
    expect(hostA.bind).toBe('lab:host:a');
    expect(hostA.children?.map((c) => c.name)).toEqual(['vm-m1', 'vm-w1']);
    expect(find(out.nodes, 'lab.node.w1')?.children?.map((c) => c.name)).toEqual(['web-1', 'web-2']);
  });

  test('drops a pruned type that holds nothing, but keeps one that does', () => {
    expect(find(out.nodes, 'lab.machine.laptop')).toBeUndefined();
    expect(find(out.nodes, 'lab.machine.build-box')?.children?.map((c) => c.name)).toEqual(['master-3']);
  });

  test('counts what is inside in the order of the types, and colors red and amber health', () => {
    expect(find(out.nodes, 'lab.host.a')?.subtitle).toBe('2 VMs, 2 nodes, 2 pods');
    expect(find(out.nodes, 'lab.host.b')?.color).toBe('amber');
    expect(find(out.nodes, 'lab.node.w1')?.color).toBe('red');
    expect(find(out.nodes, 'lab.host.a')?.color).toBeUndefined();
  });

  test('draws the asked relations between generated boxes', () => {
    expect(out.relations).toEqual([expect.objectContaining({ from: ['lab.pod.a'], to: ['lab.pod.c'], label: 'calls' })]);
  });

  test('adds a placement view that starts closed below the open levels', () => {
    const v = out.views.find((x) => x.id === 'lab-placement') as RelationView;
    expect(v.title).toBe('Where things run');
    expect(v.group).toBe('Lab');
    expect(v.include?.subtree).toEqual(['lab']);
    expect(v.collapse?.sort()).toEqual(['lab.node.m2', 'lab.node.w1']);
  });

  test('adds a view per failure domain that tints it and says what its loss costs', () => {
    const v = out.views.find((x) => x.id === 'lab-if-host.a') as RelationView;
    expect(v.title).toBe('If host-a goes down');
    expect(v.group).toBe('Lab / Failure domains');
    expect(v.highlights).toEqual([{ nodes: ['lab.host.a'], style: 'tint', color: 'red', label: 'goes down' }]);
    const text = v.annotations?.map((a) => a.text);
    expect(text).toEqual([
      'Takes down 2 VMs, 2 nodes, 2 pods.',
      'etcd keeps 2 of 3 members, losing master-1: it still has a majority.',
      '1 volume loses every copy: logs.',
      '1 volume keeps one copy: data.',
    ]);
    expect(v.annotations?.[0]?.at).toBe('lab.host.a');
    expect(out.views.map((x) => x.id)).toEqual(['lab-placement', 'lab-if-machine.build-box', 'lab-if-host.a', 'lab-if-host.b']);
  });

  test('says when a group loses its majority', () => {
    const two = expandObserved(
      DocumentSchema.parse({ nodes: [{ id: 'lab', name: 'Lab', observe: { source: 'lab', types: ['host', 'vm', 'node'], failure: { domains: ['host'], quorum: { type: 'node', fact: 'roles', contains: 'etcd' } } } }] }),
      mergeObserved(emptyObserved(), { ...batch, entities: batch.entities.filter((e) => e.id !== 'node:m3') }).model,
    );
    const v = two.views.find((x) => x.id === 'lab-if-host.a') as RelationView;
    expect(v.annotations?.map((a) => a.text)).toContain('quorum drops to 1 of 2 members: it loses its majority and stops.');
  });

  test('draws a VM and the node of the same name as one box that still counts and fails as both', () => {
    const twin = mergeObserved(emptyObserved(), {
      source: 'lab',
      observed: '2026-10-31T10:00:00Z',
      entities: [
        { id: 'host:a', type: 'host', name: 'host-a', facts: {} },
        { id: 'vm:9', type: 'vm', name: 'worker-9', parent: 'host:a', facts: {} },
        { id: 'node:9', type: 'node', name: 'worker-9', parent: 'vm:9', facts: { health: 'red' } },
        { id: 'pod:x', type: 'pod', name: 'x', parent: 'node:9', facts: {} },
      ],
      relations: [],
    }).model;
    const d = expandObserved(
      DocumentSchema.parse({ nodes: [{ id: 'lab', name: 'Lab', observe: { source: 'lab', types: ['host', 'vm', 'node', 'pod'], health: 'health', failure: { domains: ['vm'] } } }] }),
      twin,
    );
    const box = find(d.nodes, 'lab.vm.9')!;
    expect(box.bind).toBe('lab:node:9');
    expect(box.color).toBe('red');
    expect(box.children?.map((c) => c.name)).toEqual(['x']);
    expect(find(d.nodes, 'lab.host.a')?.subtitle).toBe('1 vm, 1 node, 1 pod');
    expect(d.views.map((v) => v.id)).toEqual(['lab-if-vm.9']);
    expect((d.views[0] as RelationView).annotations?.[0]?.text).toBe('Takes down 1 node, 1 pod.');
  });

  test('the result resolves and lays out as an ordinary document', () => {
    const m = resolveModel(out);
    expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  test('leaves a document without observe blocks as it was', () => {
    const plain = DocumentSchema.parse({ nodes: [{ id: 'a', name: 'A' }] });
    expect(expandObserved(plain, model)).toEqual(plain);
  });
});

// Products in pillars: one product consumes another's API through a
// relation, another one only links to a third.
describe('expandObserved relation arrows', () => {
  const webBatch: Batch = {
    source: 'cat',
    observed: '2026-11-01T10:00:00Z',
    entities: [
      { id: 'pillar:catalog', type: 'pillar', name: 'Catalog', facts: {} },
      { id: 'pillar:agents', type: 'pillar', name: 'Agents', facts: {} },
      { id: 'pillar:empty', type: 'pillar', name: 'Quiet', facts: {} },
      { id: 'product:hub', type: 'product', name: 'Hub', parent: 'pillar:catalog', facts: {} },
      { id: 'product:feed', type: 'product', name: 'Feed', parent: 'pillar:catalog', facts: {} },
      { id: 'product:board', type: 'product', name: 'Board', parent: 'pillar:agents', facts: {} },
      { id: 'product:alone', type: 'product', name: 'Alone', parent: 'pillar:empty', facts: {} },
    ],
    relations: [
      { from: 'product:feed', to: 'product:hub', label: 'consumes' },
      { from: 'product:board', to: 'product:hub', label: 'will_consume' },
      { from: 'product:alone', to: 'product:feed', label: 'mentions' },
    ],
  };
  const webModel = mergeObserved(emptyObserved(), webBatch).model;
  const expand = (relations: unknown[]) =>
    expandObserved(DocumentSchema.parse({ title: 'Web', nodes: [{ id: 'web', name: 'Web', observe: { source: 'cat', types: ['pillar', 'product'], relations } }] }), webModel);
  const names = (n: NodeOutput | undefined): string[] => (n?.children ?? []).flatMap((c) => [c.name ?? '', ...names(c)]);

  test('a relation entry with a color draws its arrows in that color', () => {
    const out = expand([{ label: 'will_consume', color: 'amber' }, 'consumes']);
    expect(out.relations).toEqual([
      expect.objectContaining({ from: ['web.product.feed'], to: ['web.product.hub'], label: 'consumes', tags: ['observed.web'] }),
      expect.objectContaining({ from: ['web.product.board'], to: ['web.product.hub'], label: 'will_consume', color: 'amber', tags: ['observed.web'] }),
    ]);
    expect(out.relations?.[0]).not.toHaveProperty('color');
  });

  test('only keeps just the boxes its arrows touch and what holds them', () => {
    const out = expand([{ label: 'consumes', only: true }, { label: 'will_consume', color: 'amber', only: true }, 'mentions']);
    expect(names(out.nodes[0]).sort()).toEqual(['Agents', 'Board', 'Catalog', 'Feed', 'Hub']);
    expect(out.relations?.map((r) => r.label)).toEqual(['consumes', 'will_consume']);
  });

  test('the string form draws plain arrows and keeps every box', () => {
    const out = expand(['consumes', 'will_consume', 'mentions']);
    expect(names(out.nodes[0]).sort()).toEqual(['Agents', 'Alone', 'Board', 'Catalog', 'Feed', 'Hub', 'Quiet']);
    expect(out.relations?.map((r) => r.label)).toEqual(['consumes', 'will_consume', 'mentions']);
    expect(out.relations?.some((r) => r.color !== undefined)).toBe(false);
  });

  test('the view the block adds draws its arrows', () => {
    const out = expandObserved(
      DocumentSchema.parse({ title: 'Web', nodes: [{ id: 'web', name: 'Web', observe: { source: 'cat', types: ['pillar', 'product'], relations: [{ label: 'consumes', color: 'teal' }], view: { title: 'Web' } } }] }),
      webModel,
    );
    const view = resolveModel(out).views.find((v) => v.id === 'web-placement');
    if (view?.kind !== 'relation') throw new Error('no placement view');
    expect(view.relations.map((r) => r.label)).toEqual(['consumes']);
  });
});

describe('observe nest', () => {
  // One source, three trees: a subscription holds groups that hold apps; a repository holds services that hold apps; an environment holds apps.
  const estate = mergeObserved(emptyObserved(), {
    source: 'orrery',
    observed: '2026-10-31T10:00:00Z',
    entities: [
      { id: 'sub:main', type: 'subscription', name: 'Main', facts: {} },
      { id: 'rg:prod', type: 'group', name: 'rg-prod', parent: 'sub:main', facts: {} },
      { id: 'repo:shop', type: 'repository', name: 'shop', facts: {} },
      { id: 'svc:auth', type: 'service', name: 'auth', facts: {} },
      { id: 'svc:web', type: 'service', name: 'web', facts: {} },
      { id: 'env:prod', type: 'environment', name: 'prod', facts: {} },
      { id: 'env:test', type: 'environment', name: 'test', facts: {} },
      { id: 'app:auth-prod', type: 'app', name: 'auth-prod', parent: 'rg:prod', facts: {} },
      { id: 'app:auth-test', type: 'app', name: 'auth-test', parent: 'rg:prod', facts: {} },
      { id: 'app:web-prod', type: 'app', name: 'web-prod', parent: 'rg:prod', facts: {} },
      { id: 'app:loose', type: 'app', name: 'loose', parent: 'rg:prod', facts: {} },
      { id: 'db:shop', type: 'database', name: 'shop-db', parent: 'rg:prod', facts: {} },
      { id: 'unresolved:legacy.example.net', type: 'unresolved', name: 'legacy.example.net', facts: { health: 'amber' } },
    ],
    relations: [
      { from: 'rg:prod', to: 'sub:main', label: 'subscription', tags: ['subscription'] },
      { from: 'svc:auth', to: 'repo:shop', label: 'repository', tags: ['repository'] },
      { from: 'svc:web', to: 'repo:shop', label: 'repository', tags: ['repository'] },
      { from: 'app:auth-prod', to: 'svc:auth', label: 'service', tags: ['service'] },
      { from: 'app:auth-test', to: 'svc:auth', label: 'service', tags: ['service'] },
      { from: 'app:web-prod', to: 'svc:web', label: 'service', tags: ['service'] },
      { from: 'app:auth-prod', to: 'env:prod', label: 'environment', tags: ['environment'] },
      { from: 'app:web-prod', to: 'env:prod', label: 'environment', tags: ['environment'] },
      { from: 'app:auth-test', to: 'env:test', label: 'environment', tags: ['environment'] },
      { from: 'app:auth-prod', to: 'db:shop', label: 'sql', kind: 'data', tags: ['sw_connection'], description: 'Evidence: setting, telemetry. Calls in 7 days: 2,043.' },
      { from: 'app:web-prod', to: 'unresolved:legacy.example.net', label: 'http', tags: ['sw_connection'] },
    ],
  }).model;
  const tree = (observe: Record<string, unknown>) => expandObserved(DocumentSchema.parse({ title: 'Shop', nodes: [{ id: 'shop', name: 'Shop', observe: { source: 'orrery', ...observe } }] }), estate);
  const shape = (nodes: readonly NodeOutput[] | undefined): unknown[] => (nodes ?? []).map((n) => (n.children?.length ? { [n.name]: shape(n.children) } : n.name));

  test('without nest, boxes sit inside their observed parent: the physical tree', () => {
    expect(shape(tree({ types: ['subscription', 'group', 'app'] }).nodes[0]?.children)).toEqual([{ Main: [{ 'rg-prod': ['auth-prod', 'auth-test', 'loose', 'web-prod'] }] }]);
  });

  test('nest by relation draws the logical tree from the same source, through a type nested in turn', () => {
    const out = tree({ types: ['repository', 'service', 'app'], nest: { service: 'repository', app: 'service' } });
    expect(shape(out.nodes[0]?.children)).toEqual(['loose', { shop: [{ auth: ['auth-prod', 'auth-test'] }, { web: ['web-prod'] }] }]);
  });

  test('nest by environment, skipping a nested ancestor that is not drawn', () => {
    expect(shape(tree({ types: ['environment', 'app'], nest: { app: 'environment' } }).nodes[0]?.children)).toEqual(['loose', { prod: ['auth-prod', 'web-prod'] }, { test: ['auth-test'] }]);
    expect(shape(tree({ types: ['repository', 'app'], nest: { service: 'repository', app: 'service' } }).nodes[0]?.children)).toEqual(['loose', { shop: ['auth-prod', 'auth-test', 'web-prod'] }]);
  });

  test('an edge drawn by its tag carries its label and description, and runs to an unresolved stub drawn amber', () => {
    const out = tree({ types: ['environment', 'app', 'database', 'unresolved'], nest: { app: 'environment' }, health: 'health', relations: ['sw_connection'] });
    expect(out.relations?.map((r) => [r.from[0], r.to[0], r.label, r.description])).toEqual([
      ['shop.app.auth-prod', 'shop.db.shop', 'sql', 'Evidence: setting, telemetry. Calls in 7 days: 2,043.'],
      ['shop.app.web-prod', 'shop.unresolved.legacy.example.net', 'http', undefined],
    ]);
    expect(find(out.nodes, 'shop.unresolved.legacy.example.net')?.color).toBe('amber');
  });
});
