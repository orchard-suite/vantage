/** Every line that reaches a scope applies; a record says how it stands against each; clashes become conflicts (VAN-3019). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { stringify } from 'yaml';
import { testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';

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
  chk: checkout
`;

const WORK = `title: Standard checks
kind: { prefix: SC, name: Standard checks, base: work-item }
views: []
`;

function record(title: string, header: Record<string, unknown>, category = 2): string {
  return `---\n${stringify({ title, status: 'accepted', category, decided: '2026-11-01', deciders: ['The maintainers'], ...header }, { lineWidth: 0 })}---\n\n## Context\n\nWhy it was needed.\n\n## Decision\n\nWhat was decided.\n\n## Consequences\n\nWhat follows.\n`;
}

const edition = (text: string): number => Number(/^edition: (\d+)$/m.exec(text)?.[1] ?? 0);

describe('inherited lines, refinements, departures, and conflicts', () => {
  let t: TestApp;
  let admin: Agent;
  let bob: Agent;
  const read = (address: string): Promise<string> => admin.call('vantage_read', { addresses: [address] });
  const checkout = async (): Promise<string> => `checkout@${edition(await read('standard/checkout'))}`;
  const items = async (): Promise<string> => admin.call('vantage_outline', { address: 'SC' });

  beforeAll(async () => {
    t = await testApp();
    admin = await agent(t, (await t.bearer('ada', { admin: true })).headers);
    bob = await agent(t, (await t.bearer('bob')).headers);
    for (const [name, prefix] of [['Org', 'ORG'], ['Pay', 'PAY'], ['Fin', 'FIN'], ['Chk', 'CHK']] as const) {
      await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name } });
      await admin.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: name.toLowerCase(), prefix, name: `${name} decisions` } });
    }
    await admin.call('vantage_write', { writes: [{ address: 'scopes', text: TREE }, { address: 'org/checks', text: WORK }] });
    await admin.call('vantage_write', {
      writes: [
        { address: 'ORG', text: record('Secrets live in one vault', { position: { line: 'Every secret lives in the vault.', binding: 'should', binds: ['systems'] } }) },
        { address: 'PAY', text: record('Settle weekly', { position: { line: 'Payments settle once a week.', binding: 'should', binds: ['people'] } }, 3) },
        { address: 'FIN', text: record('Reconcile daily', { position: { line: 'Every payment is reconciled daily.', binding: 'must', binds: ['people'], reach: { facets: ['moves-money'] } } }, 3) },
      ],
    });
  }, 30_000);
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('a record marks the lines it builds to, with the edition it read, and the edition must hold the line', async () => {
    const at = await checkout();
    expect(await admin.call('vantage_write', { writes: [{ address: 'CHK', text: record('Use the vault client', { inherits: [{ line: 'ORG-2001', stance: 'builds', edition: at }] }) }] })).toContain('created CHK-2001');
    expect(await read('CHK-2001')).toContain(`inherits:\n  - line: ORG-2001\n    stance: builds\n    edition: ${at}\n`);
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: record('Wrong scope', { inherits: [{ line: 'ORG-2001', stance: 'builds', edition: 'payments@1' }] }) }] })).text).toContain('this record is bound by standard/checkout');
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: record('Not there', { inherits: [{ line: 'CHK-2001', stance: 'builds', edition: at }] }) }] })).text).toContain('sets no line in standard/');
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: record('No such edition', { inherits: [{ line: 'ORG-2001', stance: 'builds', edition: 'checkout@99' }] }) }] })).text).toContain('no published edition 99');
  });

  test('a refinement is at least as strict, and the refined record shows it', async () => {
    const at = await checkout();
    const weaker = record('Vault where handy', { position: { line: 'Secrets may live in the vault.', binding: 'may', binds: ['systems'] }, inherits: [{ line: 'ORG-2001', stance: 'refines', edition: at }] });
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: weaker }] })).text).toContain('a refinement is at least as strict');
    const bare = record('Refine with no line', { inherits: [{ line: 'ORG-2001', stance: 'refines', edition: at }] });
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: bare }] })).text).toContain('carries a position');
    const stricter = record('Vault always', { position: { line: 'Every checkout secret lives in the vault, rotated monthly.', binding: 'must', binds: ['systems'] }, inherits: [{ line: 'ORG-2001', stance: 'refines', edition: at }] });
    expect(await admin.call('vantage_write', { writes: [{ address: 'CHK', text: stricter }] })).toContain('created CHK-2002');
    expect(await read('ORG-2001')).toContain('refined_by:\n  - CHK-2002');
    // Both lines stay in force: musts only grow.
    const std = await read('standard/checkout');
    expect(std).toContain('ORG-2001');
    expect(std).toContain('CHK-2002');
    // The other end is kept by the record that names it.
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'ORG-2001', old: 'refined_by:\n  - CHK-2002\n', new: '' }] })).text).toContain('refined_by is kept by the records that name this one');
    // A later position that weakens the line is checked again.
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'CHK-2002', old: 'binding: must', new: 'binding: may' }] })).text).toContain('a refinement is at least as strict');
  });

  test('a departure may be proposed, but is never accepted without an exception', async () => {
    const at = await checkout();
    const departs = { inherits: [{ line: 'ORG-2001', stance: 'departs', edition: at }] };
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: record('Keys in env', departs) }] })).text).toContain('no exception in force covers it');
    expect(await admin.call('vantage_write', { writes: [{ address: 'CHK', text: record('Keys in env', { ...departs, status: 'proposed' }) }] })).toContain('created CHK-2003');
    expect(await read('ORG-2001')).toContain('departed_by:\n  - CHK-2003');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'CHK-2003', old: 'status: proposed', new: 'status: accepted' }] })).text).toContain('VAN-3020');
    // An accepted record may not add a departure either.
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'CHK-2001', old: 'stance: builds', new: 'stance: departs' }] })).text).toContain('no exception in force covers it');
  });

  test('amends is a typed relation, shown on both records', async () => {
    expect(await admin.call('vantage_write', { writes: [{ address: 'ORG', text: record('Vault for build secrets too', { amends: ['ORG-2001'] }) }] })).toContain('created ORG-2002');
    expect(await read('ORG-2002')).toContain('amends:\n  - ORG-2001');
    expect(await read('ORG-2001')).toContain('amended_by:\n  - ORG-2002');
  });

  test('a clash becomes a conflict for the nearest shared scope; under hold both lines stand and the work waits', async () => {
    const pay = await read('standard/payments');
    expect(pay).toContain('FIN-3001');
    expect(pay).toContain('PAY-3001');
    const flagged = await admin.call('vantage_write', { writes: [{ address: 'conflicts', text: '---\nlines: [PAY-3001, FIN-3001]\nscope: payments\n---\n\nA weekly settlement cannot be reconciled daily.\n' }] });
    expect(flagged).toContain('flagged conflicts/1: PAY-3001 and FIN-3001 in payments, for the steward of acme (dee@example.com)');
    expect(await read('conflicts/1')).toContain('stewards:\n  - acme (dee@example.com)');
    expect(await admin.call('vantage_outline', { address: 'conflicts' })).toContain('conflicts/1  open  PAY-3001 and FIN-3001 in payments');
    const after = await read('standard/payments');
    expect(after).toContain('## Conflicts\n\n- conflicts/1: PAY-3001 and FIN-3001; both hold');
    // The same pair again is refused, and a line that does not reach the scope is too.
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'conflicts', text: '---\nlines: [FIN-3001, PAY-3001]\nscope: payments\n---\n\nAgain.\n' }] })).text).toContain('conflicts/1 already holds');
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'conflicts', text: '---\nlines: [PAY-3001, CHK-2002]\nscope: payments\n---\n\nNo.\n' }] })).text).toContain('sets no line in standard/payments');
    // Below the conflict's scope, accepting a record that marks either line waits for the ruling.
    const at = await checkout();
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'CHK', text: record('Settle on Fridays', { inherits: [{ line: 'PAY-3001', stance: 'builds', edition: at }] }) }] })).text).toContain('conflicts/1 holds beside FIN-3001');
  });

  test('the clash rule is a setting: stricter holds the earlier binding word', async () => {
    const settings = await read('standard');
    await admin.call('vantage_write', { writes: [{ address: 'standard', text: settings.slice(settings.indexOf('\n') + 1).replace('clash: hold', 'clash: stricter') }] });
    const pay = await read('standard/payments');
    expect(pay).toContain('- conflicts/1: PAY-3001 and FIN-3001; FIN-3001 holds until the ruling');
    expect(pay).toMatch(/PAY-3001, own; held back by conflicts\/1/);
    const back = await read('standard');
    await admin.call('vantage_write', { writes: [{ address: 'standard', text: back.slice(back.indexOf('\n') + 1).replace('clash: stricter', 'clash: hold') }] });
  });

  test('only the shared scope steward or an admin rules, and a ruled conflict leaves the editions', async () => {
    const text = await read('conflicts/1');
    const ruled = text.slice(text.indexOf('\n') + 1).replace('filed:', 'ruling: change\nnote: Payments settle daily now.\nfiled:');
    expect((await bob.attempt('vantage_write', { writes: [{ address: 'conflicts/1', text: ruled }] })).text).toContain('only the steward of acme (dee@example.com), or an admin, rules');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'conflicts/1', old: 'scope: payments', new: 'scope: checkout' }] })).text).toContain('scope stays as the hub keeps it');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'conflicts/1', old: 'filed:', new: 'ruling: change\nfiled:' }] })).text).toContain('a ruling carries a note');
    expect(await admin.call('vantage_patch', { edits: [{ address: 'conflicts/1', old: 'filed:', new: 'ruling: change\nnote: Payments settle daily now.\nfiled:' }] })).toContain('ruled conflicts/1: change');
    expect(await read('standard/payments')).not.toContain('## Conflicts');
    expect(await read('conflicts/1')).toContain('state: ruled');
  });

  test('with a checks kind named, the hub files the checking: new lines, changed lines a record marks, and conflicts', async () => {
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'standard', old: 'clash: hold', new: 'clash: hold\nchecks: NOPE' }] })).text).toContain('no kind NOPE');
    await admin.call('vantage_patch', { edits: [{ address: 'standard', old: 'clash: hold', new: 'clash: hold\nchecks: SC' }] });
    expect(await read('standard')).toContain('checks: SC');
    // A new line in its own scope is checked against the lines around it.
    await admin.call('vantage_write', { writes: [{ address: 'PAY', text: record('Refunds within a day', { position: { line: 'Refunds are paid within a day.', binding: 'must', binds: ['people'] } }, 3) }] });
    expect(await items()).toContain('Check PAY-3002, new in standard/payments@');
    // A changed line files a re-check for each record whose map marks it.
    await admin.call('vantage_patch', { edits: [{ address: 'ORG-2001', old: 'Every secret lives in the vault.', new: 'Every secret lives in the vault, never in a file.' }] });
    const list = await items();
    expect(list).toContain('Check CHK-2001 against ORG-2001, changed in standard/checkout@');
    expect(list).toContain('Check CHK-2002 against ORG-2001, changed in standard/checkout@');
    // An open check is not filed twice.
    await admin.call('vantage_patch', { edits: [{ address: 'ORG-2001', old: 'never in a file.', new: 'never in a file or a log.' }] });
    expect((await items()).match(/Check CHK-2001 against ORG-2001/g)).toHaveLength(1);
    // A conflict is filed for its steward.
    expect(await admin.call('vantage_write', { writes: [{ address: 'conflicts', text: '---\nlines: [PAY-3002, FIN-3001]\nscope: payments\n---\n\nRefunds paid before the daily reconcile.\n' }] })).toContain('filed SC-');
    expect(await items()).toContain('Rule on conflicts/2: PAY-3002 and FIN-3001 in payments');
  });
});
