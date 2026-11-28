/** Exceptions are hub records granted by the steward of the line they bend (VAN-3020). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { stringify } from 'yaml';
import { testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';
import { TOOL_DOOR } from '@vantage/mcp';
import { DEFAULT_ORG } from '../auth/authenticate.ts';
import { dayOf } from '../day.ts';
import { endException } from './exception-write.ts';

const TREE = `source: hub
scopes:
  - id: acme
    name: Acme
    kind: organization
    steward: dee@example.com
  - id: payments
    name: Payments
    kind: department
    parent: acme
    steward: bob@example.com
  - id: checkout
    name: Checkout
    kind: team
    parent: payments
workspaces:
  org: acme
  pay: payments
  chk: checkout
`;

const WORK = `title: Standard checks
kind: { prefix: SC, name: Standard checks, base: work-item }
views: []
`;

function record(title: string, header: Record<string, unknown>, category = 2): string {
  return `---\n${stringify({ title, status: 'accepted', category, decided: '2026-11-01', deciders: ['The maintainers'], ...header }, { lineWidth: 0 })}---\n\n## Context\n\nWhy it was needed.\n\n## Decision\n\nWhat was decided.\n\n## Consequences\n\nWhat follows.\n`;
}

const plus = (days: number): string => new Date(Date.parse(`${dayOf()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function ask(line: string, scope: string, ends: string, records: string[] = []): string {
  return `---\n${stringify({ line, covers: { scope, ...(records.length ? { records } : {}) }, safeguard: 'Keys rotate weekly and are read only by the build.', ends }, { lineWidth: 0 })}---\n\nThe vault client is not ready for the checkout runtime.\n`;
}

describe('exceptions', () => {
  let t: TestApp;
  let admin: Agent;
  let bob: Agent;
  let dee: Agent;
  const read = (address: string): Promise<string> => admin.call('vantage_read', { addresses: [address] });
  const edition = async (scope: string): Promise<string> => `${scope}@${/^edition: (\d+)$/m.exec(await read(`standard/${scope}`))![1]}`;
  const setting = async (from: string, to: string): Promise<void> => void (await admin.call('vantage_patch', { edits: [{ address: 'standard', old: from, new: to }] }));

  beforeAll(async () => {
    t = await testApp();
    admin = await agent(t, (await t.bearer('ada', { admin: true })).headers);
    bob = await agent(t, (await t.bearer('bob')).headers);
    dee = await agent(t, (await t.bearer('dee')).headers);
    for (const [name, prefix] of [['Org', 'ORG'], ['Pay', 'PAY'], ['Chk', 'CHK']] as const) {
      await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name } });
      await admin.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: name.toLowerCase(), prefix, name: `${name} decisions` } });
      const ws = (await t.ctx.db.query<{ id: string }>('select id from workspaces where slug = $1', [name.toLowerCase()]))[0]!.id;
      for (const who of ['bob', 'dee']) {
        const user = (await t.ctx.db.query<{ id: string }>("select id from users where email = $1", [`${who}@example.com`]))[0]!.id;
        await t.ctx.db.query('insert into grants (id, org_id, workspace_id, role, subject_kind, subject_id) values ($1, $2, $3, $4, $5, $6)', [`g-${ws}-${who}`, DEFAULT_ORG, ws, 'author', 'user', user]);
      }
    }
    await admin.call('vantage_write', { writes: [{ address: 'scopes', text: TREE }, { address: 'org/checks', text: WORK }] });
    await admin.call('vantage_write', {
      writes: [
        { address: 'ORG', text: record('Secrets live in one vault', { position: { line: 'Every secret lives in the vault.', binding: 'must', binds: ['systems'], enforced_by: ['policy:deny-plain-secrets'], checked_by: [] } }) },
        { address: 'ORG', text: record('Keys are never exported', { position: { line: 'No key leaves its vault.', binding: 'must', binds: ['systems'], locked: true } }) },
      ],
    });
    await setting('clash: hold', 'clash: hold\nchecks: SC');
    const at = await edition('checkout');
    await admin.call('vantage_write', { writes: [{ address: 'CHK', text: record('Keys in the build', { status: 'proposed', inherits: [{ line: 'ORG-2001', stance: 'departs', edition: at }] }) }] });
  }, 30_000);
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test("anyone who may author asks; only the line's steward grants, never the one who asked", async () => {
    const asked = await bob.call('vantage_write', { writes: [{ address: 'exceptions', text: ask('ORG-2001', 'checkout', plus(30), ['CHK-2001']) }] });
    expect(asked).toContain('asked for exceptions/1: ORG-2001 in checkout');
    expect(asked).toContain('for the steward of acme (dee@example.com) to grant');
    const text = await read('exceptions/1');
    expect(text).toMatch(/^id: exception:[0-9A-Z]{26}$/m);
    expect(text).toContain('state: requested');
    expect(text).toContain('steward: acme (dee@example.com)');
    expect(await admin.call('vantage_outline', { address: 'SC' })).toContain('Grant or refuse exceptions/1');
    expect((await bob.attempt('vantage_patch', { edits: [{ address: 'exceptions/1', old: 'state: requested', new: 'state: granted' }] })).text).toContain('only the steward of acme');
    // An admin acts for any steward, but the rule keeps who grants apart from who asked.
    await admin.call('vantage_write', { writes: [{ address: 'exceptions', text: ask('ORG-2001', 'payments', plus(10)) }] });
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'exceptions/2', old: 'state: requested', new: 'state: granted' }] })).text).toContain('keeps who grants apart from who asked');
    // Its end may not run past the longest the rule allows.
    expect((await dee.attempt('vantage_patch', { edits: [{ address: 'exceptions/1', old: `ends: ${plus(30)}`, new: `ends: ${plus(400)}` }, { address: 'exceptions/1', old: 'state: requested', new: 'state: granted' }] })).text).toContain('runs past the longest');
    expect(await dee.call('vantage_patch', { edits: [{ address: 'exceptions/1', old: 'state: requested', new: 'state: granted' }] })).toContain('granted exceptions/1');
    const granted = await read('exceptions/1');
    expect(granted).toContain('asked_by: bob@example.com');
    expect(granted).toContain('granted_by: dee@example.com');
  });

  test('a granted exception lets the departing record be accepted, and the edition carries it as pressure on its line', async () => {
    expect(await admin.call('vantage_patch', { edits: [{ address: 'CHK-2001', old: 'status: proposed', new: 'status: accepted' }] })).toContain('saved CHK-2001');
    const std = await read('standard/checkout');
    expect(std).toContain('ORG-2001, from payments < acme; enforced by policy:deny-plain-secrets; bent by 1 exception');
    expect(std).toMatch(/## Exceptions\n\n- exceptions\/1 \(exception:[0-9A-Z]{26}\): ORG-2001 bends in checkout for CHK-2001, until/);
    expect(await admin.call('vantage_outline', { address: 'exceptions' })).toContain('in force per line: ORG-2001 1');
    // An exception elsewhere in the tree does not reach here, and one for another record does not cover this one.
    expect(await read('standard/payments')).not.toContain('## Exceptions');
  });

  test('the steward renews within the rule, and revokes; a departure the exception covered is filed to be checked again', async () => {
    expect(await dee.call('vantage_patch', { edits: [{ address: 'exceptions/1', old: `ends: ${plus(30)}`, new: `ends: ${plus(60)}` }] })).toContain(`renewed exceptions/1 until ${plus(60)}`);
    await setting('exceptions:\n  rules: {}', 'exceptions:\n  rules:\n    organization:\n      renews: false');
    expect((await dee.attempt('vantage_patch', { edits: [{ address: 'exceptions/1', old: `ends: ${plus(60)}`, new: `ends: ${plus(90)}` }] })).text).toContain('does not renew');
    expect(await dee.call('vantage_patch', { edits: [{ address: 'exceptions/1', old: 'state: granted', new: 'state: revoked' }] })).toContain('revoked exceptions/1');
    expect(await read('standard/checkout')).not.toContain('## Exceptions');
    expect(await admin.call('vantage_outline', { address: 'SC' })).toContain('Check CHK-2001: exceptions/1 no longer covers its departure from ORG-2001');
    expect((await dee.attempt('vantage_patch', { edits: [{ address: 'exceptions/1', old: 'state: revoked', new: 'state: granted' }] })).text).toContain('is revoked; ask for a new one');
  });

  test('a locked line takes an exception only from the scope the estate names', async () => {
    expect((await bob.attempt('vantage_write', { writes: [{ address: 'exceptions', text: ask('ORG-2002', 'checkout', plus(5)) }] })).text).toContain('is locked, and the estate names no scope');
    await setting('exceptions:\n  rules:', 'exceptions:\n  locked_by: payments\n  rules:');
    expect(await admin.call('vantage_write', { writes: [{ address: 'exceptions', text: ask('ORG-2002', 'checkout', plus(5)) }] })).toContain('for the steward of payments (bob@example.com), which grants on locked lines,');
    expect((await dee.attempt('vantage_patch', { edits: [{ address: 'exceptions/3', old: 'state: requested', new: 'state: granted' }] })).text).toContain('is locked');
    expect(await bob.call('vantage_patch', { edits: [{ address: 'exceptions/3', old: 'state: requested', new: 'state: granted' }] })).toContain('granted exceptions/3');
  });

  test('at its end the hub ends it and asks its steward to renew it or let the line hold', async () => {
    await t.ctx.db.query('update standard_exceptions set ends = $3::date where org_id = $1 and number = $2', [DEFAULT_ORG, 3, plus(-1)]);
    expect(await endException(t.ctx, DEFAULT_ORG, 3, plus(-1))).toBe('ended');
    expect(await read('exceptions/3')).toContain('state: ended');
    expect(await admin.call('vantage_outline', { address: 'SC' })).toContain(`exceptions/3 ended on ${plus(-1)}`);
    // A job for an end that has moved does nothing.
    expect(await endException(t.ctx, DEFAULT_ORG, 1, plus(-1))).toBe('moved');
    // Granting queues the end for the day after the last.
    const queued = await t.ctx.db.query<{ n: number }>("select count(*)::int as n from jobs where kind = 'exception-end' and payload->>'number' = '1'");
    expect(queued[0]!.n).toBeGreaterThan(0);
  });

  test('an import brings exceptions in from other stores; one that lacks its terms arrives incomplete for the steward', async () => {
    const entries = [
      { store: 'policy', ref: 'exemption/keys-in-build', line: 'ORG-2001', scope: 'checkout', things: ['cloud:/accounts/acme/vaults/build'], reason: 'The build agent cannot reach the vault yet.', safeguard: 'The key is scoped to one pipeline.', owner: 'dee@example.com', ends: plus(20) },
      { store: 'git', ref: 'waivers.yaml#3', line: 'ORG-2001', scope: 'payments', reason: 'An old waiver.' },
    ];
    const dry = await admin.call(TOOL_DOOR, { tool: 'vantage_exceptions_import', arguments: { entries, dryRun: true } });
    expect(dry).toContain('Would import 2 exceptions');
    const done = await admin.call(TOOL_DOOR, { tool: 'vantage_exceptions_import', arguments: { entries } });
    expect(done).toContain('-> granted: ORG-2001 in checkout until');
    expect(done).toContain('-> incomplete: ORG-2001 in payments, lacks an owner, an end as exceptions/5');
    expect(await admin.call(TOOL_DOOR, { tool: 'vantage_exceptions_import', arguments: { entries } })).toContain('Imported 0 exceptions; 2 already here');
    expect(await read('exceptions/4')).toContain('source:\n  store: policy\n  ref: exemption/keys-in-build');
    expect(await admin.call('vantage_outline', { address: 'SC' })).toContain('Complete exceptions/5 from git');
  });

  test('deploy code reads the exceptions in force as JSON, with what enforces the line and when each ends', async () => {
    const me = await t.bearer('ada', { admin: true });
    const r = await t.json('/api/v1/exceptions?inForce=true', { headers: me.headers });
    expect(r.status).toBe(200);
    const list = r.body['exceptions'] as { id: string; number: number; line: { ref: string; enforcedBy: string[] }; covers: { things: string[] }; ends: string }[];
    const policy = list.find((e) => e.number === 4)!;
    expect(policy.id).toMatch(/^exception:/);
    expect(policy.line).toEqual(expect.objectContaining({ ref: 'ORG-2001', enforcedBy: ['policy:deny-plain-secrets'] }));
    expect(policy.covers.things).toEqual(['cloud:/accounts/acme/vaults/build']);
    expect(policy.ends).toBe(plus(20));
    expect(list.some((e) => e.number === 1)).toBe(false);
  });

  test('a conflict ruled exception names one in force that bends one of its lines', async () => {
    await admin.call('vantage_write', { writes: [{ address: 'conflicts', text: '---\nlines: [ORG-2001, ORG-2002]\nscope: checkout\n---\n\nA key the build reads must leave the vault.\n' }] });
    expect((await dee.attempt('vantage_patch', { edits: [{ address: 'conflicts/1', old: 'filed:', new: 'ruling: exception\nexception: exceptions/1\nnote: The build keeps its key.\nfiled:' }] })).text).toContain('is not an exception in force');
    expect(await dee.call('vantage_patch', { edits: [{ address: 'conflicts/1', old: 'filed:', new: 'ruling: exception\nexception: exceptions/4\nnote: The build keeps its key.\nfiled:' }] })).toContain('ruled conflicts/1: exception');
  });
});
