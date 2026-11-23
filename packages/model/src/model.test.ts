import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from './load.ts';
import { documentJsonSchema } from './json-schema.ts';

const sample = `
title: Shop
nodes:
  - name: Shoppers
    type: users
  - id: azure
    name: Azure
    type: cloud
    children:
      - name: Web App
        type: web
      - name: Orders API
        type: api
        subtitle: ASP.NET
      - name: Orders DB
        type: database
relations:
  - from: web-app
    to: orders-api
    label: calls
    tags: [requests]
  - from: orders-api
    to: orders-db
    label: reads and writes
    kind: data
    tags: [data]
views:
  - id: context
    title: Context
    relations:
      - from: shoppers
        to: [web-app]
        label: shops with
    include: { tags: [requests] }
  - id: everything
    title: Everything
    extends: context
    include: { tags: [data] }
  - id: checkout
    kind: sequence
    title: Checkout
    steps:
      - from: shoppers
        to: web-app
        label: submit cart
        steps:
          - from: web-app
            to: orders-api
            label: POST /orders
            reply: 201
  - id: empty
    title: Empty
`;

describe('model', () => {
  test('resolves nodes, ids by slug, relations and views', () => {
    const { model, diagnostics } = loadModelFromText(sample);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model).toBeDefined();
    const m = model!;
    expect([...m.nodes.keys()]).toEqual(['shoppers', 'azure', 'web-app', 'orders-api', 'orders-db']);
    expect(m.nodes.get('orders-api')!.parentId).toBe('azure');
    expect(m.nodes.get('orders-db')!.shape).toBe('cylinder');
    expect(m.relations).toHaveLength(2);
    const ctx = m.views[0]!;
    expect(ctx.kind).toBe('relation');
    if (ctx.kind !== 'relation') throw new Error();
    expect(ctx.relations.map((r) => `${r.from}>${r.to}`)).toEqual(['web-app>orders-api', 'shoppers>web-app']);
    const all = m.views[1]!;
    if (all.kind !== 'relation') throw new Error();
    expect(all.relations).toHaveLength(3);
    expect(diagnostics.find((d) => d.code === 'view-without-relations')?.line).toBe(51);
  });

  test('reports unknown references with lines and hints', () => {
    const { diagnostics } = loadModelFromText(`
nodes:
  - name: A
views:
  - id: v
    title: V
    relations:
      - from: A
        to: Bee
`);
    const err = diagnostics.find((d) => d.code === 'unknown-node');
    expect(err?.message).toContain('Bee');
    expect(err?.line).toBe(9);
    expect(err?.path).toBe('views[0].relations[0].to');
  });

  test('rejects unknown keys with a location', () => {
    const { diagnostics } = loadModelFromText(`
nodes:
  - name: A
    colour: red
`);
    expect(diagnostics[0]?.code).toBe('schema');
    expect(diagnostics[0]?.line).toBe(3);
  });

  test('emits a JSON schema', () => {
    const schema = documentJsonSchema();
    expect(schema['type']).toBe('object');
    expect(JSON.stringify(schema)).toContain('"views"');
  });
});

describe('bind and provenance', () => {
  test('carry through from the document to the model node', () => {
    const doc = `
title: Bound
nodes:
  - id: relay
    name: Relay
    type: service
    bind: kubectl:deployment:relay/relay
    provenance: { source: kubectl, sourceId: deployment:relay/relay, observed: "2026-10-28T10:00:00Z", url: https://hub.example.test/e/1 }
  - name: Plain
`;
    const { model } = loadModelFromText(doc, 'bound.yaml');
    if (!model) throw new Error('expected a model');
    const relay = model.nodes.get('relay');
    expect(relay?.bind).toBe('kubectl:deployment:relay/relay');
    expect(relay?.provenance?.source).toBe('kubectl');
    expect(relay?.provenance?.observed).toBe('2026-10-28T10:00:00Z');
    expect(model.nodes.get('plain')?.bind).toBeUndefined();
    expect(model.nodes.get('plain')?.provenance).toBeUndefined();
  });

  test('bind and provenance appear in the JSON Schema', () => {
    const json = JSON.stringify(documentJsonSchema());
    expect(json).toContain('"bind"');
    expect(json).toContain('"provenance"');
  });
});

describe('composition', () => {
  test('a composed view keeps what any parent draws', () => {
    const { model } = loadModelFromText(`
nodes:
  - name: Users
  - name: Admin
  - id: cloud
    name: Cloud
    children:
      - name: Web
      - name: Repo
relations:
  - { from: users, to: web, tags: [ingress] }
  - { from: admin, to: repo, tags: [delivery] }
views:
  - id: ingress
    title: Ingress
    include: { tags: [ingress] }
    collapse: [cloud]
    hide: [admin]
  - id: delivery
    title: Delivery
    include: { tags: [delivery] }
    hide: [users]
  - id: front
    title: Front
    include: { tags: [ingress] }
    collapse: [cloud]
  - id: page
    title: Page
    extends: [ingress, delivery]
  - id: high
    title: High
    extends: [ingress, front]
  - id: own
    title: Own
    extends: [ingress, delivery]
    hide: [admin]
`);
    const view = (id: string) => {
      const v = model!.views.find((x) => x.id === id)!;
      if (v.kind !== 'relation') throw new Error();
      return v;
    };
    expect(view('page').hide).toEqual([]);
    expect(view('page').collapse).toEqual([]);
    expect(view('high').collapse).toEqual(['cloud']);
    expect(view('own').hide).toEqual(['admin']);
  });
});
