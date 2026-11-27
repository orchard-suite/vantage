/** Find across the hub answers inside the disk budget: records first, personal workspaces left out, every hit linked, a miss counted (VAN-5008). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SAMPLE_YAML, testApp, type TestApp } from '../testing.ts';
import { agent, type Agent } from '../mcp/testing.ts';

const RECORD = `---
title: Apps sign in through one identity provider
status: accepted
category: 2
decided: 2026-11-01
deciders: [The maintainers]
---

## Context

Each app kept its own accounts.

## Decision

Every app signs in through the one identity provider. Apps sign in with a short lived token.

## Consequences

One place to turn an account off.
`;

// The index learns a page's words when the worker draws it; a description gives the index the words here.
const WITH_PAGE = `${SAMPLE_YAML.replace('description: Takes orders', 'description: Apps sign in before they buy')}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
`;

const PAGE = '# Guide\n\nApps sign in before they call the Shop API.\n';
const SCRATCH = `# Scratch\n\n${Array.from({ length: 20 }, (_, i) => `Apps sign in idea ${i}.`).join('\n')}\n`;

describe('find across the hub', () => {
  let t: TestApp;
  let a: Agent;
  let mine: string;
  beforeAll(async () => {
    t = await testApp();
    a = await agent(t, (await t.bearer('ada')).headers);
    await a.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Platform' } });
    await a.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: 'platform', prefix: 'PLAT', name: 'Platform decisions' } });
    await a.call('vantage_write', { writes: [{ address: 'PLAT', text: RECORD }] });
    await a.call('vantage_write', { writes: [{ address: 'platform/shop', text: WITH_PAGE }, { address: 'platform/shop/pages/guide.md', text: PAGE }] });
    const saved = await a.call('vantage_write', { writes: [{ address: '~/scratch', text: WITH_PAGE }, { address: '~/scratch/pages/guide.md', text: SCRATCH }] });
    mine = /saved (\S+)\/scratch version/.exec(saved)![1]!;
  });
  afterAll(async () => {
    await t.ctx.db.close();
  });

  test('records come before documents, and each thing is linked once above its lines', async () => {
    const found = await a.call('vantage_find', { query: 'apps sign in' });
    const lines = found.split('\n');
    const record = lines.findIndex((l) => l.startsWith('PLAT-2001:'));
    const page = lines.findIndex((l) => l.startsWith('platform/shop/pages/guide.md:'));
    expect(record).toBeGreaterThan(0);
    expect(page).toBeGreaterThan(record);
    expect(lines).toContain('PLAT-2001  http://hub.test/w/platform/decisions/PLAT-2001');
    expect(lines).toContain('platform/shop  http://hub.test/w/platform/shop');
    expect(lines).toContain('platform/shop/pages/guide.md:3: Apps sign in before they call the Shop API.');
    expect(lines.filter((l) => l.includes('http://hub.test/w/platform/decisions/PLAT-2001'))).toHaveLength(1);
  });

  test('a personal workspace is left out unless the search names it', async () => {
    expect(await a.call('vantage_find', { query: 'apps sign in' })).not.toContain(`${mine}/scratch`);
    const named = await a.call('vantage_find', { query: 'apps sign in', in: '~' });
    expect(named).toContain(`${mine}/scratch/pages/guide.md:3: Apps sign in idea 0.`);
    expect(named).toContain(`http://hub.test/w/${mine}/scratch`);
  });

  test('a miss answers counts per thing and the call that reads more, never loose lines', async () => {
    const missed = await a.call('vantage_find', { query: 'how do apps sign in' });
    const lines = missed.split('\n');
    expect(lines[0]).toMatch(/^no line holds every word in \d+ things \(best matches, no personal workspaces\); some words are in:$/);
    expect(lines[1]).toBe('PLAT-2001: 2 lines with apps, sign  http://hub.test/w/platform/decisions/PLAT-2001');
    expect(lines).toContain('platform/shop: 1 line with apps, sign  http://hub.test/w/platform/shop');
    expect(lines).toContain('platform/shop/pages/guide.md: 1 line with apps, sign  http://hub.test/w/platform/shop');
    expect(lines.at(-1)).toBe('more: vantage_outline PLAT-2001 and read a part, or vantage_find fewer words in: PLAT-2001');
    expect(missed).not.toMatch(/:\d+: /);
    expect(missed).not.toContain('scratch');
  });

  test('count answers each thing with its link', async () => {
    const counted = await a.call('vantage_find', { query: 'apps sign in', count: true });
    expect(counted.split('\n')[1]).toBe('PLAT-2001: 2  http://hub.test/w/platform/decisions/PLAT-2001');
  });
});
