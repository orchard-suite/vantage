import { afterEach, describe, expect, test } from 'bun:test';
import { testApp, type TestApp } from '../testing.ts';
import { silentLogger } from '../log.ts';
import { kindByPrefix } from './kinds.ts';
import { relayKinds } from './register.ts';
import { move, put } from './write.ts';

/** A team's work, built on the shipped work item, with a label and a role of its own. */
const BASE = `title: Shop work
kind:
  prefix: SW
  name: Shop work
  base: work-item
  labels: [{ name: area, type: choice, choices: [api, web] }]
  roles: { reviewer: [lead@example.com] }
  parts: [SW]
views: []
`;

/** A kind drawn from scratch, with a lifecycle of its own and no base. */
const DRAWN = (extra = '') => `title: Requests
kind: { prefix: REQ, name: Requests, base: work-item, labels: [{ name: cost, type: number }], lifecycle: flow }
views:
  - id: flow
    kind: lifecycle
    title: How a request moves
    states:
      - { id: asked, text: Asked, class: not-started }
${extra}      - { id: done, text: Done, class: done }
    moves:
      - { from: asked, to: done, label: finish }
`;

const opened: TestApp[] = [];
afterEach(async () => {
  for (const t of opened.splice(0)) await t.ctx.db.close();
});

async function seeded() {
  const t = await testApp();
  opened.push(t);
  const ada = await t.bearer('ada');
  const bob = await t.bearer('bob');
  const wsOf = async (h: Record<string, string>) => ((await t.json('/api/v1/workspaces', { headers: h })).body['workspaces'] as { slug: string }[])[0]!.slug;
  const adaWs = await wsOf(ada.headers);
  const bobWs = await wsOf(bob.headers);
  const save = async (who: { headers: Record<string, string> }, ws: string, yaml: string, slug?: string) => {
    const r = slug ? await t.json(`/api/v1/workspaces/${ws}/documents/${slug}`, { method: 'PUT', headers: who.headers, body: JSON.stringify({ yaml }) }) : await t.json(`/api/v1/workspaces/${ws}/documents`, { method: 'POST', headers: who.headers, body: JSON.stringify({ yaml }) });
    return { status: r.status, message: String(r.body['message'] ?? r.body['error'] ?? JSON.stringify(r.body)), slug: (r.body['document'] as { slug?: string } | undefined)?.slug ?? '' };
  };
  const base = await save(ada, adaWs, BASE);
  expect(base.status).toBe(201);
  const grant = async () => {
    const id = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [adaWs]))[0]!.id;
    await t.ctx.db.query("insert into grants (id, org_id, workspace_id, subject_kind, subject_id, role) values ('g1', $1, $2, 'user', $3, 'viewer')", [ada.principal.orgId, id, bob.principal.userId]);
  };
  const def = async (prefix: string) => (await kindByPrefix(t.ctx.db, ada.principal.orgId, prefix))!.definition;
  return { t, ada, bob, adaWs, bobWs, save, grant, def, baseSlug: base.slug };
}

describe('a kind built on another kind', () => {
  test('takes its labels, roles, parts, and lifecycle, from a workspace the writer can read', async () => {
    const s = await seeded();
    const yaml = `title: Checkout work\nkind:\n  prefix: CW\n  name: Checkout work\n  base: SW\n  labels: [{ name: points, type: number }]\n  roles: { tester: [team:qa] }\nviews: []\n`;
    // Bob cannot open Ada's workspace, so her kind is no base of his.
    const hidden = await s.save(s.bob, s.bobWs, yaml);
    expect(hidden.status).toBe(400);
    expect(hidden.message).toContain('builds on SW, which is no kind you can read');
    await s.grant();
    expect((await s.save(s.bob, s.bobWs, yaml)).status).toBe(201);
    const cw = await s.def('CW');
    expect(cw.base).toBe('SW');
    expect(cw.root).toBe('work-item');
    expect(cw.labels.map((l) => l.name)).toEqual(['due', 'size', 'area', 'points']);
    expect(Object.keys(cw.roles).sort()).toEqual(['reviewer', 'tester']);
    expect(cw.parts).toEqual(['SW']);
    expect(cw.drawnIn).toEqual({ view: 'lifecycle', shipped: 'work-item' });
    expect(cw.states.map((x) => x.id)).toEqual((await s.def('SW')).states.map((x) => x.id));
  });

  test('a chain of bases that ends at a kind built on nothing is refused', async () => {
    const s = await seeded();
    expect((await s.save(s.ada, s.adaWs, DRAWN().replace("base: work-item, ", ""))).status).toBe(201);
    // A kind that builds on nothing ends no chain at a shipped kind.
    const loose = await s.save(s.ada, s.adaWs, `title: Small requests\nkind: { prefix: SR, name: Small requests, base: REQ }\nviews: []\n`);
    expect(loose.status).toBe(400);
    expect(loose.message).toContain('whose chain ends at REQ, which builds on nothing');
  });

  test('a loop of bases is refused', async () => {
    const s = await seeded();
    expect((await s.save(s.ada, s.adaWs, `title: Checkout work\nkind: { prefix: CW, name: Checkout work, base: SW }\nviews: []\n`)).status).toBe(201);
    const loop = await s.save(s.ada, s.adaWs, BASE.replace('base: work-item', 'base: CW'), s.baseSlug);
    expect(loop.status).toBe(400);
    expect(loop.message).toContain('SW builds on CW builds on SW is a loop');
    const self = await s.save(s.ada, s.adaWs, BASE.replace('base: work-item', 'base: SW'), s.baseSlug);
    expect(self.message).toContain('is a loop');
  });
});

describe('a change to a base reaches every kind built on it', () => {
  const CW = `title: Checkout work\nkind: { prefix: CW, name: Checkout work, base: SW }\nviews: []\n`;
  const TW = `title: Till work\nkind: { prefix: TW, name: Till work, base: CW }\nviews: []\n`;

  test('a label the base gains reaches the kinds built on it, down the chain', async () => {
    const s = await seeded();
    for (const y of [CW, TW]) expect((await s.save(s.ada, s.adaWs, y)).status).toBe(201);
    expect((await s.save(s.ada, s.adaWs, BASE.replace('choices: [api, web] }', 'choices: [api, web] }, { name: risk, type: text }'), s.baseSlug)).status).toBe(200);
    expect((await s.def('CW')).labels.map((l) => l.name)).toContain('risk');
    expect((await s.def('TW')).labels.map((l) => l.name)).toContain('risk');
    expect(await relayKinds(s.t.ctx.db, silentLogger)).toBe(0);
  });

  test('a change that drops a state an item of a dependent kind is in is refused, naming the kind and the item', async () => {
    const s = await seeded();
    const p = s.ada.principal;
    expect((await s.save(s.ada, s.adaWs, DRAWN('      - { id: review, text: In review, class: in-progress }\n').replace('to: done, label: finish }', 'to: review, label: send }\n      - { from: review, to: done, label: finish }'))).status).toBe(201);
    expect((await s.save(s.ada, s.adaWs, `title: Big requests\nkind: { prefix: BR, name: Big requests, base: REQ }\nviews: []\n`)).status).toBe(201);
    expect((await s.def('BR')).drawnIn).toEqual({ view: 'flow', kind: 'REQ' });
    await put(s.t.ctx, p, { kind: 'BR', title: 'A new till' }, 'p1');
    await move(s.t.ctx, p, 'BR-1', { to: 'review' }, 'm1');
    const slug = (await s.t.ctx.db.query<{ slug: string }>("select d.slug from documents d join item_kinds k on k.document_id = d.id where k.prefix = 'REQ'"))[0]!.slug;
    const r = await s.save(s.ada, s.adaWs, DRAWN(), slug);
    expect(r.status).toBe(400);
    expect(r.message).toContain('kind BR has 1 item(s) in state review (BR-1)');
    expect((await s.def('REQ')).states.map((x) => x.id)).toContain('review');
  });

  test('a change that drops a label a dependent kind relies on is refused, and so is dropping the base', async () => {
    const s = await seeded();
    const needs = `title: Costed requests\nkind: { prefix: CR, name: Costed requests, base: REQ, lifecycle: flow }\nviews:\n  - id: flow\n    kind: lifecycle\n    title: How it moves\n    states:\n      - { id: asked, text: Asked, class: not-started }\n      - { id: done, text: Done, class: done }\n    moves:\n      - { from: asked, to: done, label: finish, needs: [label:cost] }\n`;
    expect((await s.save(s.ada, s.adaWs, DRAWN())).status).toBe(201);
    expect((await s.save(s.ada, s.adaWs, needs)).status).toBe(201);
    const slug = (await s.t.ctx.db.query<{ slug: string }>("select d.slug from documents d join item_kinds k on k.document_id = d.id where k.prefix = 'REQ'"))[0]!.slug;
    const r = await s.save(s.ada, s.adaWs, DRAWN().replace(', labels: [{ name: cost, type: number }]', ''), slug);
    expect(r.status).toBe(400);
    expect(r.message).toContain('kind CR: the move from asked to done needs label cost, which kind CR does not have');
    const gone = await s.save(s.ada, s.adaWs, 'title: Requests\nviews: []\n', slug);
    expect(gone.status).toBe(400);
    expect(gone.message).toContain('kinds CR build on REQ, so it keeps its kind block');
  });
});
