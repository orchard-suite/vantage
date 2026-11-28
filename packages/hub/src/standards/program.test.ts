/** A workspace names its owner and the program it serves: its owner's chain and the program's own lines bind it (VAN-3017, VAN-3019). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { stringify } from 'yaml';
import { testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';
import { scopesFromCatalog } from '../scopes/catalog.ts';
import { FACET_MAX } from '../decisions/types.ts';
import type { ObservedModel } from '@vantage/connectors';

const TREE = `source: hub
scopes:
  - id: acme
    name: Acme
    kind: organization
  - id: platform
    name: Platform engineering
    kind: department
    parent: acme
    steward: pat@example.com
  - id: development
    name: Development
    kind: department
    parent: acme
  - id: portfolio
    name: Portfolio
    kind: division
    parent: acme
  - id: program:ledger
    name: Ledger program
    kind: program
    parent: portfolio
    steward: lee@example.com
    profile:
      description: Keeps the ledger.
workspaces:
  org: acme
  plat: platform
  dev: development
  port: portfolio
  ledger: program:ledger
  infra: { owner: platform, program: "program:ledger" }
  app: { owner: development, program: "program:ledger" }
`;

function record(title: string, header: Record<string, unknown>, category = 1): string {
  return `---\n${stringify({ title, status: 'accepted', category, decided: '2026-11-01', deciders: ['The maintainers'], ...header }, { lineWidth: 0 })}---\n\n## Context\n\nWhy.\n\n## Decision\n\nWhat.\n\n## Consequences\n\nWhat follows.\n`;
}

const position = (line: string, binding = 'must') => ({ position: { line, binding, binds: ['systems'] } });

describe('a program is a second axis', () => {
  let t: TestApp;
  let admin: Agent;
  let pat: Agent;
  const read = (address: string): Promise<string> => admin.call('vantage_read', { addresses: [address] });

  beforeAll(async () => {
    t = await testApp();
    admin = await agent(t, (await t.bearer('ada', { admin: true })).headers);
    pat = await agent(t, (await t.bearer('pat')).headers);
    for (const [name, prefix] of [['Org', 'ORG'], ['Plat', 'PLAT'], ['Dev', 'DEV'], ['Port', 'PORT'], ['Ledger', 'LEDG'], ['Infra', 'INFRA'], ['App', 'APP']] as const) {
      await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name } });
      await admin.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: name.toLowerCase(), prefix, name: `${name} decisions` } });
    }
    await admin.call('vantage_write', { writes: [{ address: 'scopes', text: TREE }] });
    await admin.call('vantage_write', {
      writes: [
        { address: 'ORG', text: record('One identity provider', position('Every app signs in through one identity provider.')) },
        { address: 'PLAT', text: record('Infrastructure is code', position('Every cloud resource is written as code.')) },
        { address: 'DEV', text: record('Every change is tested', position('Every change ships with a test.')) },
        { address: 'PORT', text: record('Programs report monthly', position('Every program reports its risks monthly.')) },
        { address: 'LEDG', text: record('Ledger data stays in region', position('Ledger data never leaves its region.')) },
      ],
    });
  }, 30_000);
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('the tree names a workspace by its owner and its program, and keeps the plain form for an owner alone', async () => {
    const text = await read('scopes');
    expect(text).toContain('  infra:\n    owner: platform\n    program: program:ledger\n');
    expect(text).toContain('  plat: platform\n');
    const ws = await admin.call('vantage_outline', { address: 'infra' });
    expect(ws).toContain('scope: platform (department) < acme (organization)');
    expect(ws).toContain('serves program: program:ledger (Ledger program)');
    expect(ws).toContain('program profile: description (own, 17 chars); vantage_read scopes/program:ledger');
    expect(ws).toContain('bound by: standard/platform+program:ledger');
    expect(await admin.call('vantage_outline', { address: 'scopes' })).toContain('served by app, infra');
    expect((await admin.attempt('vantage_patch', { edits: [{ address: 'scopes', old: '  plat: platform\n', new: '  plat: { owner: platform, program: platform }\n' }] })).text).toContain('names platform as its owner and its program');
  });

  test("two workspaces of one program get their own department's lines and the same program lines, never the program's ancestors'", async () => {
    const infra = await read('standard/platform+program:ledger');
    const app = await read('standard/development+program:ledger');
    for (const s of [infra, app]) {
      expect(s).toContain('ORG-1001');
      expect(s).toMatch(/Ledger data never leaves its region\. LEDG-1001, through program program:ledger/);
      expect(s).not.toContain('PORT-1001');
    }
    expect(infra).toContain('PLAT-1001');
    expect(infra).not.toContain('DEV-1001');
    expect(app).toContain('DEV-1001');
    expect(app).not.toContain('PLAT-1001');
    expect(infra).toContain('name: Platform engineering, serving Ledger program');
    // The program's own standard still takes its ancestors' lines; only the axis through it does not.
    expect(await read('standard/program:ledger')).toContain('PORT-1001');
  });

  test("a record in a workspace that serves a program marks its lines against that workspace's edition", async () => {
    const at = `platform+program:ledger@${/^edition: (\d+)$/m.exec(await read('standard/platform+program:ledger'))![1]}`;
    expect(await admin.call('vantage_write', { writes: [{ address: 'INFRA', text: record('Region-pinned buckets', { inherits: [{ line: 'LEDG-1001', stance: 'builds', edition: at }, { line: 'PLAT-1001', stance: 'builds', edition: at }] }) }] })).toContain('created INFRA-1001');
    const platOnly = `platform@${/^edition: (\d+)$/m.exec(await read('standard/platform'))![1]}`;
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'INFRA', text: record('Wrong edition', { inherits: [{ line: 'PLAT-1001', stance: 'builds', edition: platOnly }] }) }] })).text).toContain('bound by standard/platform+program:ledger');
  });

  test("a program line that clashes with an owner's line is a conflict for both stewards, and either rules", async () => {
    const flagged = await admin.call('vantage_write', { writes: [{ address: 'conflicts', text: '---\nlines: [LEDG-1001, PLAT-1001]\nscope: platform+program:ledger\n---\n\nThe code that writes resources runs in one region only.\n' }] });
    expect(flagged).toContain('for the stewards of program:ledger (lee@example.com) and platform (pat@example.com)');
    expect(await read('standard/platform+program:ledger')).toContain('## Conflicts');
    // A conflict in one workspace's edition leaves the other workspace of the program alone.
    expect(await read('standard/development+program:ledger')).not.toContain('## Conflicts');
    expect(await pat.call('vantage_patch', { edits: [{ address: 'conflicts/1', old: 'filed:', new: 'ruling: narrow\nnote: The rule binds only resources that hold risk data.\nfiled:' }] })).toContain('ruled conflicts/1: narrow');
  });
});

describe('one facet limit', () => {
  test("a line names a facet as long as a scope may carry, and a longer one is refused on both sides", async () => {
    const t = await testApp();
    const admin = await agent(t, (await t.bearer('ada', { admin: true })).headers);
    await admin.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Org' } });
    await admin.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: 'org', prefix: 'ORG', name: 'Org decisions' } });
    const facet = `software:prg-${'0123456789abcdef'.repeat(2)}-0123-4567`;
    expect(facet.length).toBeGreaterThan(40);
    const tree = `source: hub\nscopes:\n  - id: acme\n    name: Acme\n    kind: organization\n    facets: ["${facet}"]\n`;
    await admin.call('vantage_write', { writes: [{ address: 'scopes', text: tree }] });
    expect(await admin.call('vantage_write', { writes: [{ address: 'ORG', text: record('Teams reach their programs', { position: { line: 'Every software team reviews its program.', binding: 'must', binds: ['people'], reach: { facets: [facet] } } }) }] })).toContain('created ORG-1001');
    const long = 'x'.repeat(FACET_MAX + 1);
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'scopes', text: tree.replace(facet, long) }] })).text).toContain(`a facet is at most ${FACET_MAX} characters`);
    expect((await admin.attempt('vantage_write', { writes: [{ address: 'ORG', text: record('Too long', { position: { line: 'No.', binding: 'must', binds: ['people'], reach: { facets: [long] } } }) }] })).text).toContain('reach.facets');
    await t.ctx.db.close();
  });

  test('a catalog facet past the limit is kept aside, not on the scope', () => {
    const at = '2026-11-01T00:00:00Z';
    const model: ObservedModel = { entities: { a: { key: 'c:acme', source: 'c', id: 'acme', type: 'organization', name: 'Acme', facts: { facets: ['short', 'y'.repeat(FACET_MAX + 5)] }, tags: [], firstObserved: at, observed: at, provenance: { source: 'c', sourceId: 'acme', observed: at } } }, relations: {} };
    const [scope] = scopesFromCatalog(model, { connector: 'platform/catalog', kinds: ['organization'], steward: {}, facets: 'facets' }, []);
    expect(scope!.facets).toEqual(['short']);
    expect(scope!.refusedFacets).toEqual(['y'.repeat(FACET_MAX + 5)]);
  });
});
