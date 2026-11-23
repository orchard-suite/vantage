import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModelFromText, type Model, type SequenceStep } from '@vantage/model';
import { detectFormat, importDiagram, type ImportResult } from './index.ts';

const dir = join(import.meta.dir, '..', 'fixtures');
const fixture = (name: string): ImportResult => importDiagram(new Uint8Array(readFileSync(join(dir, name))), { filename: name });
const text = (name: string, body: string): ImportResult => importDiagram(new TextEncoder().encode(body), { filename: name });

/** Loads the produced YAML and fails on any error diagnostic. */
function loaded(r: ImportResult): Model {
  const { model, diagnostics } = loadModelFromText(r.yaml);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(r.report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return model!;
}

const flat = (steps: readonly SequenceStep[]): SequenceStep[] => steps.flatMap((s) => [s, ...flat(s.steps ?? []), ...flat(s.else ?? [])]);

describe('mermaid flowchart', () => {
  const r = fixture('checkout.mmd');
  const model = loaded(r);
  const view = model.views[0]!;
  if (view.kind !== 'relation') throw new Error('expected a relation view');
  const rel = (from: string, to: string) => view.relations.find((x) => x.from === from && x.to === to);

  test('nodes keep their labels as names, with slug ids and shape hints', () => {
    expect(model.nodes.get('storefront')!.name).toBe('Storefront');
    expect(model.nodes.get('orders-db')!.typeName).toBe('database');
    expect(model.nodes.get('paid')!.shape).toBe('diamond');
    expect(model.nodes.get('config')!.shape).toBe('hexagon');
    expect(model.nodes.get('event-stream')!.shape).toBe('pill');
  });

  test('subgraphs are nested containers', () => {
    expect(model.nodes.get('orders-db')!.parentId).toBe('data-tier');
    expect(model.nodes.get('cold-archive')!.parentId).toBe('data-tier');
    expect(model.nodes.get('blob-store')!.parentId).toBe('cold-archive');
    expect(view.arrange.find((a) => a.node === 'data-tier')?.direction).toBe('down');
  });

  test('every edge form becomes a relation', () => {
    expect(view.direction).toBe('right');
    expect(view.title).toBe('Checkout');
    expect(rel('shopper', 'storefront')!.label).toBe('browses');
    expect(rel('storefront', 'orders-api')!.label).toBe('places order');
    expect(rel('orders-api', 'order-queue')).toBeDefined();
    expect(rel('orders-api', 'audit-log')!.kind).toBe('async');
    expect(rel('orders-api', 'event-stream')).toMatchObject({ label: 'emits', kind: 'async' });
    expect(rel('orders-api', 'config')!.heads?.to).toBe('none');
    expect(rel('orders-api', 'redis')).toBeDefined();
    expect(rel('orders-db', 'blob-store')).toBeDefined();
  });

  test('unlabelled relations become hints and styling is counted', () => {
    expect(r.report.hints).toContain('relation orders-api -> order-queue has no label; give it a verb');
    expect(r.report.hints.some((h) => h.includes('shopper -> storefront'))).toBe(false);
    expect(r.report.warnings.some((w) => w.includes('1 classDef lines') && w.includes('1 linkStyle lines'))).toBe(true);
    expect(r.report.format).toBe('mermaid');
    expect(r.report.layout).toBe('auto');
    expect(r.report.originalName).toBe('checkout.original.mmd');
    expect(r.yaml).not.toContain('pins');
  });

  test('ids are stable for the same input', () => {
    expect(fixture('checkout.mmd').yaml).toBe(r.yaml);
  });
});

describe('mermaid sequence', () => {
  const r = fixture('login.mmd');
  const model = loaded(r);
  const view = model.views[0]!;
  if (view.kind !== 'sequence') throw new Error('expected a sequence view');
  const all = flat(view.steps);

  test('participants keep their aliases and actors are typed', () => {
    expect(view.title).toBe('Sign in');
    expect(view.participants).toEqual(['user', 'web-app', 'identity', 'd']);
    expect(model.nodes.get('user')!.typeName).toBe('actor');
    expect(model.nodes.get('d')!.typeName).toBe('database');
  });

  test('arrows map to sync, reply, and async', () => {
    expect(view.steps[0]).toMatchObject({ from: 'user', to: 'web-app', label: 'open sign-in' });
    expect(all.find((s) => s.label === 'code')!.kind).toBe('reply');
    expect(all.find((s) => s.label === 'write audit')!.kind).toBe('async');
  });

  test('notes and blocks come across; a second else nests an alt', () => {
    expect(all.find((s) => s.note !== undefined)).toMatchObject({ note: 'The user signs in with a passkey', over: ['user', 'identity'] });
    const alt = view.steps.find((s) => s.alt !== undefined)!;
    expect(alt.alt).toBe('code valid');
    expect(alt.else![0]!.alt).toBe('code expired');
    expect(alt.else![0]!.else![0]!.label).toBe('log failure');
    expect(view.steps.some((s) => s.loop === 'every 5 minutes')).toBe(true);
    expect(view.steps.find((s) => s.par !== undefined)!.steps!.length).toBe(2);
    expect(r.report.warnings.some((w) => w.includes('par audit'))).toBe(true);
  });
});

describe('plantuml', () => {
  test('a component diagram nests, aliases, and maps arrows', () => {
    const r = fixture('platform.puml');
    const model = loaded(r);
    const view = model.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    expect(view.title).toBe('Platform Components');
    expect(view.direction).toBe('right');
    expect(model.nodes.get('orders-api')!.parentId).toBe('aks-cluster');
    expect(model.nodes.get('aks-cluster')!.parentId).toBe('azure');
    expect(model.nodes.get('orders-api')!.subtitle).toBe('ASP.NET');
    expect(model.nodes.get('order-events')!.typeName).toBe('queue');
    expect(model.nodes.get('orders-db')!.typeName).toBe('database');
    expect(model.nodes.get('customer')!.typeName).toBe('actor');
    expect(model.nodes.get('payments-api')!.typeName).toBe('interface');
    expect(view.relations.find((x) => x.from === 'orders-api' && x.to === 'order-events')).toMatchObject({ label: 'publishes', kind: 'async' });
    expect(view.relations.find((x) => x.from === 'orders-api' && x.to === 'orders-db')!.label).toBe('reads and writes');
    expect(view.relations.find((x) => x.from === 'mailer')!.kind).toBe('async');
    expect(r.report.hints).toContain('relation orders-api -> payments-api has no label; give it a verb');
    expect(r.report.warnings.some((w) => w.includes('skinparam') && w.includes('!include'))).toBe(true);
  });

  test('a sequence diagram maps messages, blocks, notes, and return', () => {
    const r = fixture('pay.puml');
    const model = loaded(r);
    const view = model.views[0]!;
    if (view.kind !== 'sequence') throw new Error('expected a sequence view');
    expect(view.title).toBe('Pay for an order');
    expect(view.participants).toEqual(['shopper', 'orders-api', 'orders-db', 'events']);
    expect(model.nodes.get('orders-db')!.typeName).toBe('database');
    const all = flat(view.steps);
    expect(all.find((s) => s.label === 'order id')!.kind).toBe('reply');
    expect(all.find((s) => s.label === 'order paid')!.kind).toBe('async');
    expect(view.steps.find((s) => s.alt !== undefined)).toMatchObject({ alt: 'card accepted' });
    expect(all.find((s) => s.note !== undefined)!.over).toEqual(['orders-api', 'orders-db']);
    expect(view.steps[view.steps.length - 1]).toMatchObject({ from: 'orders-api', to: 'shopper', label: '201 Created', kind: 'reply' });
    expect(r.report.hints).toContain('message orders-api -> events has no label; give it a verb');
  });
});

describe('markdown', () => {
  test('every diagram block is a view titled from its heading, and shared boxes are one node', () => {
    const r = fixture('design.md');
    const model = loaded(r);
    expect(r.report.format).toBe('markdown');
    expect(model.views.map((v) => [v.title, v.kind])).toEqual([['Request flow', 'relation'], ['Payment sequence', 'sequence']]);
    expect(r.report.merged).toEqual(['Orders API (orders-api) is drawn by more than one diagram; kept once']);
    expect(r.report.hints[0]).toStartWith('Request flow: ');
    expect(r.report.originalName).toBe('design.original.md');
  });

  test('a Markdown file with no diagram blocks is refused', () => {
    expect(() => text('notes.md', '# Notes\n\nNo diagrams here.\n')).toThrow('no mermaid or plantuml blocks');
  });
});

describe('what is not imported warns and never fails', () => {
  test('an unsupported mermaid kind names itself', () => {
    const r = fixture('classes.mmd');
    loaded(r);
    expect(r.document.views).toEqual([]);
    expect(r.report.warnings).toEqual(['mermaid classDiagram is not imported; Vantage reads flowchart, sequenceDiagram, C4, and erDiagram']);
    expect(r.report.counts.dropped).toBe(1);
  });

  test('an unsupported plantuml kind names itself', () => {
    const r = text('c.puml', '@startuml\nclass Order\nclass Line\nOrder *-- Line\n@enduml\n');
    loaded(r);
    expect(r.report.warnings.some((w) => w.includes('PlantUML class diagram is not imported'))).toBe(true);
  });

  test('lines it cannot read are listed', () => {
    const r = text('odd.mmd', 'flowchart TD\n  a --> b\n  ??? what\n');
    loaded(r);
    expect(r.report.warnings).toContain('line not understood, skipped: ??? what');
  });
});

describe('mermaid C4 and erDiagram', () => {
  test('C4 elements are typed, boundaries contain, Rel labels', () => {
    const r = text('ctx.mmd', [
      'C4Container',
      'title Shop containers',
      'Person(shopper, "Shopper", "Buys things")',
      'System_Boundary(shop, "Shop") {',
      '  Container(api, "Orders API", "ASP.NET", "Takes orders")',
      '  ContainerDb(db, "Orders DB", "Azure SQL")',
      '}',
      'System_Ext(pay, "Stripe")',
      'Rel(shopper, api, "Places orders", "HTTPS")',
      'Rel(api, db, "Reads and writes")',
      'BiRel(api, pay, "Charges")',
      'UpdateLayoutConfig($c4ShapeInRow="3")',
    ].join('\n'));
    const model = loaded(r);
    expect(model.nodes.get('orders-api')).toMatchObject({ typeName: 'service', subtitle: 'ASP.NET', parentId: 'shop' });
    expect(model.nodes.get('orders-db')!.typeName).toBe('database');
    expect(model.nodes.get('stripe')!.typeName).toBe('external');
    const view = model.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    expect(view.title).toBe('Shop containers');
    expect(view.relations.find((x) => x.from === 'shopper')).toMatchObject({ label: 'Places orders', description: 'HTTPS' });
    expect(view.relations.find((x) => x.to === 'stripe')!.both).toBe(true);
  });

  test('ER entities keep attributes as facts and cardinality as crow feet', () => {
    const r = text('er.mmd', ['erDiagram', 'CUSTOMER ||--o{ ORDER : places', 'ORDER {', '  int id PK', '  string status', '}', 'ORDER ||--|{ LINE : contains'].join('\n'));
    const model = loaded(r);
    expect(model.nodes.get('order')!.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(['id: int PK', 'status: string']);
    const view = model.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    expect(view.relations.find((x) => x.label === 'places')!.heads).toEqual({ from: 'one', to: 'many' });
    expect(view.relations.find((x) => x.label === 'contains')!.heads).toEqual({ from: 'one', to: 'one-or-many' });
  });
});

describe('format detection', () => {
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
  test('extensions and content pick the text formats', () => {
    expect(detectFormat(bytes(''), 'a.mermaid')).toBe('mermaid');
    expect(detectFormat(bytes(''), 'a.iuml')).toBe('plantuml');
    expect(detectFormat(bytes(''), 'README.md')).toBe('markdown');
    expect(detectFormat(bytes('@startuml\nA -> B\n@enduml'), 'diagram.txt')).toBe('plantuml');
    expect(detectFormat(bytes('graph LR\n a --> b'), 'diagram.txt')).toBe('mermaid');
  });
});
