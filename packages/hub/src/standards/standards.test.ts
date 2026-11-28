/** Records carry positions, and the hub builds each scope's standard and publishes it in editions (VAN-3018). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parse, stringify } from 'yaml';
import { testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';

const TREE = `source: hub
scopes:
  - id: acme
    name: Acme
    kind: organization
  - id: payments
    name: Payments
    kind: department
    parent: acme
    steward: bob@example.com
    facets: [moves-money]
  - id: finance
    name: Finance
    kind: department
    parent: acme
  - id: checkout
    name: Checkout
    kind: team
    parent: payments
workspaces:
  org: acme
  pay: payments
  fin: finance
`;

/** A record whose header carries `position`, or any other header field given. */
function record(title: string, header: Record<string, unknown>, category = 2): string {
  return `---\n${stringify({ title, status: 'accepted', category, decided: '2026-11-01', deciders: ['The maintainers'], ...header }, { lineWidth: 0 })}---\n\n## Context\n\nWhy it was needed.\n\n## Decision\n\nWhat was decided.\n\n## Consequences\n\nWhat follows.\n`;
}

const VAULT = { line: 'Every secret lives in the vault.', binding: 'must', binds: ['people', 'agents'] };
const PIN = `sha256:${'a'.repeat(64)}`;

/** The edition a scope's standard reads at now. */
const editionOf = (text: string): number => Number(/^edition: (\d+)$/m.exec(text)?.[1] ?? 0);

describe('standards built from positions', () => {
  let t: TestApp;
  let admin: Agent;
  let bob: Agent;
  let cy: Agent;
  const read = (address: string): Promise<string> => admin.call('vantage_read', { addresses: [address] });

  beforeAll(async () => {
    t = await testApp();
    admin = await agent(t, (await t.bearer('ada', { admin: true })).headers);
    bob = await agent(t, (await t.bearer('bob')).headers);
    cy = await agent(t, (await t.bearer('cy')).headers);
    for (const [name, prefix] of [['Org', 'ORG'], ['Pay', 'PAY'], ['Fin', 'FIN'], ['Plat', 'PLAT']] as const) {
      await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name } });
      await admin.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: name.toLowerCase(), prefix, name: `${name} decisions` } });
    }
    await admin.call('vantage_write', { writes: [{ address: 'scopes', text: TREE }] });
  });
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('a record states its position in its text; a word off the estate list and the retired alignment are refused', async () => {
    expect(await admin.call('vantage_write', { writes: [{ address: 'ORG', text: record('Secrets live in one vault', { position: VAULT }) }] })).toContain('ORG-2001');
    const text = await read('ORG-2001');
    expect(text).toContain('position:\n  line: Every secret lives in the vault.\n  binding: must\n  binds:\n    - people\n    - agents\n');
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'ORG', text: record('Shall', { position: { ...VAULT, binding: 'shall' } }) }] })).text).toContain(`position.binding "shall" is not on the estate's list: must, should, may`);
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'ORG', text: record('Old', { alignment: { stance: 'follows', rule: 'R-1' } }) }] })).text).toContain('alignment is retired');
  });

  test("each scope's standard holds what reaches it, grouped by area, with the path that brought each line in", async () => {
    await admin.call('vantage_write', {
      writes: [
        { address: 'PLAT', text: record('Logs go to one place', { position: { line: 'Every service logs to one place.', binding: 'should', binds: ['systems'] } }, 6) },
        { address: 'PAY', text: record('Cards stay out of logs', { position: { line: 'Card numbers never reach a log.', binding: 'must', binds: ['systems'], reach: { below: false } } }) },
        { address: 'FIN', text: record('Payments reconcile daily', { position: { line: 'Every payment is reconciled daily.', binding: 'must', binds: ['people'], reach: { facets: ['moves-money'] } } }) },
      ],
    });
    const checkout = await read('standard/checkout');
    expect(checkout).toContain('standard: checkout\nname: Checkout\nkind: team\n');
    expect(checkout).toContain('\n## Security\n\n');
    expect(checkout).toContain('\n- must (people, agents): Every secret lives in the vault. ORG-2001, from payments < acme\n');
    expect(checkout).toContain('- must (people): Every payment is reconciled daily. FIN-2001, by facet moves-money from payments < finance; facets moves-money');
    expect(checkout).toContain('\n## Operations\n\n- should (systems): Every service logs to one place. PLAT-6001, from payments < acme < estate\n');
    expect(checkout).not.toContain('PAY-2001');
    const payments = await read('standard/payments');
    expect(payments).toContain('Card numbers never reach a log. PAY-2001, own; this scope only');
    expect(payments).toContain('FIN-2001, by facet moves-money from finance');
    const estate = await read('standard/estate');
    expect(estate).toContain('PLAT-6001, own');
    expect(estate).not.toContain('ORG-2001');
    const security = await read('standard/payments#security');
    expect(security).toContain('ORG-2001');
    expect(security).not.toContain('PLAT-6001');
    expect(await admin.call('vantage_outline', { address: 'standard' })).toContain('\n        checkout  Checkout  edition ');
  });

  test('an edition is fixed: a change publishes the next one with what changed, and the last stays readable', async () => {
    const before = await read('standard/payments');
    const n = editionOf(before);
    const held = /version (\S+)/.exec(before)![1]!;
    expect(await admin.call('vantage_read', { addresses: ['standard/payments'], held: { 'standard/payments': held } })).toContain('unchanged');
    await admin.call('vantage_patch', { edits: [{ address: 'ORG-2001', old: 'line: Every secret lives in the vault.', new: 'line: Every secret lives in the one vault.' }] });
    const after = await read('standard/payments');
    expect(editionOf(after)).toBe(n + 1);
    expect(after).toMatch(/^hash: sha256:[0-9a-f]{64}$/m);
    expect(after).toContain(`## Changes from edition ${n}\n\n- changed ORG-2001: Every secret lives in the one vault.`);
    expect(await read(`standard/payments@${n}`)).toContain('Every secret lives in the vault.');
    expect(await admin.call('vantage_outline', { address: 'standard/payments' })).toContain(`standard/payments@${n}  `);
  });

  test('a page that cites a line travels with it as a procedure', async () => {
    const yaml = 'title: Runbook\nnodes:\n  - name: Vault\n    type: database\nviews:\n  - id: secrets\n    kind: doc\n    title: Secrets\n    file: pages/secrets.md\n';
    await admin.call('vantage_write', { writes: [{ address: 'org/runbook', text: yaml }, { address: 'org/runbook/pages/secrets.md', text: '# Secrets\n\nRotate keys as [[decision:ORG-2001]] says.\n' }] });
    expect(await read('standard/checkout')).toContain('## Procedures\n\n- org/runbook/pages/secrets.md (Secrets): ORG-2001');
  });

  test('the machine gate refuses a check no pack covers; an adopted pack lets it through and reaches down', async () => {
    const n = editionOf(await read('standard/acme'));
    await admin.call('vantage_patch', { edits: [{ address: 'ORG-2001', old: '    - agents\n', new: '    - agents\n  checked_by:\n    - secrets.vault-only\n' }] });
    expect(await admin.call('vantage_outline', { address: 'standard/acme' })).toContain(`edition ${n + 1} refused by the machine gate: ORG-2001: checked by secrets.vault-only, but no pack secrets reaches this scope`);
    expect(editionOf(await read('standard/acme'))).toBe(n);
    const packs = `packs:\n  acme:\n    - pack: secrets\n      version: 1.0.0\n      hash: ${PIN}\n      origin: starter\n      parameters: { days: 30 }\n`;
    expect(await admin.call('vantage_patch', { edits: [{ address: 'standard', old: 'packs: {}\n', new: packs }] })).toContain('acme adopts secrets');
    const checkout = await read('standard/checkout');
    expect(checkout).toContain('checked by secrets.vault-only');
    expect(checkout).toContain(`## Packs\n\n- secrets 1.0.0 ${PIN} starter, on, from acme; parameters days 30`);
    expect(editionOf(await read('standard/acme'))).toBe(n + 1);
  });

  test("a scope's steward keeps its packs, and a pack that already reaches it is refused by the gate", async () => {
    const settings = parse((await read('standard')).replace(/^=== .*\n/, '')) as { packs: Record<string, unknown[]> };
    settings.packs['payments'] = [{ pack: 'secrets', version: '1.0.0', hash: PIN, origin: 'estate' }];
    expect((await cy.attempt('vantage_write', { writes: [{ address: 'standard', text: stringify(settings) }] })).text).toContain('only the steward of payments or an admin');
    expect(await bob.call('vantage_write', { writes: [{ address: 'standard', text: stringify(settings) }] })).toContain('payments adopts secrets');
    expect(await admin.call('vantage_outline', { address: 'standard/payments' })).toContain('pack secrets reaches from acme and payments');
    delete settings.packs['payments'];
    expect(await bob.call('vantage_write', { writes: [{ address: 'standard', text: stringify(settings) }] })).toContain('payments adopts no pack');
  });

  test('a withheld word keeps an edition from publishing', async () => {
    await admin.call('vantage_patch', { edits: [{ address: 'standard', old: 'withhold: []', new: 'withhold: [one vault]' }] });
    const n = editionOf(await read('standard/payments'));
    await admin.call('vantage_patch', { edits: [{ address: 'PAY-2001', old: 'Card numbers never reach a log.', new: 'Card numbers never reach a log or a trace.' }] });
    expect(await admin.call('vantage_outline', { address: 'standard/payments' })).toContain('the edition holds "one vault", a word that may not leave the estate');
    expect(editionOf(await read('standard/payments'))).toBe(n);
    await admin.call('vantage_patch', { edits: [{ address: 'standard', old: 'withhold:\n  - one vault', new: 'withhold: []' }] });
    expect(editionOf(await read('standard/payments'))).toBe(n + 1);
    expect(await admin.call('vantage_outline', { address: 'standard/payments' })).not.toContain('refused');
  });

  test("with the steward gate on, a scope's own change waits for its steward while a change from above publishes at once", async () => {
    await admin.call('vantage_patch', { edits: [{ address: 'standard', old: 'steward_gate: false', new: 'steward_gate: true' }] });
    await admin.call('vantage_write', { writes: [{ address: 'PAY', text: record('Refunds need two people', { position: { line: 'A refund needs two people.', binding: 'must', binds: ['people'] } }) }] });
    expect(await admin.call('vantage_outline', { address: 'standard/payments' })).toMatch(/edition \d+ waits for the steward/);
    expect(await read('standard/payments')).not.toContain('PAY-2002');
    expect(await read('standard/checkout')).not.toContain('PAY-2002');

    await admin.call('vantage_patch', { edits: [{ address: 'ORG-2001', old: 'in the one vault.', new: 'in the vault.' }] });
    expect(await read('standard/payments')).toContain('in the one vault.');
    const acme = await admin.call('vantage_tool', { tool: 'vantage_standard_publish', arguments: { scope: 'acme' } });
    expect(acme).toMatch(/^published standard\/acme edition \d+; built on it: .*payments edition \d+/);
    const payments = await read('standard/payments');
    expect(payments).toContain('Every secret lives in the vault. ORG-2001');
    expect(payments).not.toContain('PAY-2002');

    expect((await cy.attempt('vantage_tool', { tool: 'vantage_standard_publish', arguments: { scope: 'payments' } })).text).toContain('only the steward of payments (bob@example.com) or an admin');
    expect(await bob.call('vantage_tool', { tool: 'vantage_standard_publish', arguments: { scope: 'payments' } })).toContain('published standard/payments edition');
    expect(await read('standard/payments')).toContain('A refund needs two people. PAY-2002, own');
    expect(await read('standard/checkout')).toContain('A refund needs two people. PAY-2002, from payments');
    expect((await bob.attempt('vantage_tool', { tool: 'vantage_standard_publish', arguments: { scope: 'payments' } })).text).toContain('no edition of payments waits for its steward');
    await admin.call('vantage_patch', { edits: [{ address: 'standard', old: 'steward_gate: true', new: 'steward_gate: false' }] });
  });

  test("a scope's standard is built, never written, and its address is the hub's own", async () => {
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'standard/payments', text: '# mine' }] })).text).toContain('is built from records and is never written');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'standard/payments', old: 'own', new: 'mine' }] })).text).toContain('is built from records and is never written');
    expect((await admin.attempt('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Standard' } })).text).toContain('workspace slug standard is an address of the hub itself');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: '  - id: finance', new: '  - id: estate' }] })).text).toContain('the scope id estate names the whole estate');
    expect((await admin.attempt('vantage_read', { addresses: ['standard/nowhere'] })).text).toContain('no scope nowhere');
  });

  test('REST reads a scope standard with its edition, and the settings', async () => {
    const me = await t.bearer('bob');
    const got = await t.json('/api/v1/standards/checkout', { headers: me.headers });
    expect(got.status).toBe(200);
    const edition = got.body['edition'] as { version: number; state: string; manifest: { scope: string; builds_on: { scope: string }[] }; body: { lines: { ref: string }[] } };
    expect(edition.state).toBe('published');
    expect(edition.manifest.scope).toBe('checkout');
    expect(edition.manifest.builds_on.map((b) => b.scope)).toContain('payments');
    expect(edition.body.lines.map((l) => l.ref)).toContain('PAY-2002');
    expect(String(got.body['text'])).toContain('standard: checkout');
    expect((await t.json('/api/v1/standards', { headers: me.headers })).body).toMatchObject({ bindings: ['must', 'should', 'may'], steward_gate: false });
  });
});
