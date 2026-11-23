import { describe, expect, test } from 'bun:test';
import { runConnector } from '../../run.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { jiraConnector, JiraConfigSchema } from './jira.ts';

const dir = `${import.meta.dir}/fixtures`;

function site() {
  return fixtureFetch(dir, [
    { match: /search\/jql#labels-2/, file: 'search-labels-2.json' },
    { match: /search\/jql#labels/, file: 'search-labels-1.json' },
    { match: /search\/jql#components/, file: 'search-components.json' },
  ]);
}

/** Routes the recorded search by what the body asks, since every page posts to one URL. */
function routed() {
  const f = site();
  const fetch: typeof f.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { jql: string; nextPageToken?: string };
    const tag = body.jql.includes('INC') ? 'components' : body.nextPageToken === 'page-2' ? 'labels-2' : 'labels';
    return f.fetch(`${String(input)}#${tag}`, init);
  };
  return { fetch, calls: f.calls };
}

const config = JiraConfigSchema.parse({
  url: 'https://example.atlassian.net/',
  email: 'user@example.com',
  token: 'JIRA_TOKEN',
  pageSize: 2,
  severities: { P1: 'critical' },
  mappings: [
    { jql: 'project = OPS AND statusCategory != Done', label: 'svc:', key: 'catalog:k8s-deployment:{value}' },
    { jql: 'project = INC AND statusCategory != Done', field: 'components', fact: 'service', kind: 'incident' },
  ],
});

describe('jira connector', () => {
  test('posts each JQL to the v3 search, follows the page token, and signs with basic auth', async () => {
    const f = routed();
    const ctx = testContext(config, f.fetch, { JIRA_TOKEN: 'secret' });
    const batches = await drain(jiraConnector.discover(ctx));
    expect(batches).toHaveLength(2);
    expect(f.calls.map((c) => c.url.split('#')[0])).toEqual(Array(3).fill('https://example.atlassian.net/rest/api/3/search/jql'));
    expect(f.calls.every((c) => c.method === 'POST' && c.headers.authorization === `Basic ${btoa('user@example.com:secret')}`)).toBe(true);
    const bodies = f.calls.map((c) => JSON.parse(c.body!) as { jql: string; maxResults: number; nextPageToken?: string; fields: string[] });
    expect(bodies.map((b) => b.nextPageToken)).toEqual([undefined, 'page-2', undefined]);
    expect(bodies[0]!.maxResults).toBe(2);
    expect(bodies[2]!.fields).toContain('components');
    expect(batches.every((b) => b.partial && b.entities.length === 0)).toBe(true);
  });

  test('names the thing by label prefix and points at an observed key, one item per name', async () => {
    const [labels] = await drain(jiraConnector.discover(testContext(config, routed().fetch, { JIRA_TOKEN: 's' })));
    expect(labels!.items).toEqual([
      { id: 'OPS-101', kind: 'issue', title: 'OPS-101 Relay drops long-lived connections', url: 'https://example.atlassian.net/browse/OPS-101', severity: 'critical', status: 'In Progress', updated: '2026-10-28T08:15:00.000Z', target: { key: 'catalog:k8s-deployment:relay' } },
      { id: 'OPS-102', kind: 'issue', title: 'OPS-102 Rotate the shop database password', url: 'https://example.atlassian.net/browse/OPS-102', severity: 'medium', status: 'To Do', updated: '2026-10-27T16:00:00.000Z', target: { key: 'catalog:k8s-deployment:shop-db' } },
      { id: 'OPS-102', kind: 'issue', title: 'OPS-102 Rotate the shop database password', url: 'https://example.atlassian.net/browse/OPS-102', severity: 'medium', status: 'To Do', updated: '2026-10-27T16:00:00.000Z', target: { key: 'catalog:k8s-deployment:shop-api' } },
    ]);
  });

  test('names the thing by a list field and points at a fact, with the mapping kind and a configured priority', async () => {
    const ctx = testContext(config, routed().fetch, { JIRA_TOKEN: 's' });
    const [, components] = await drain(jiraConnector.discover(ctx));
    expect(components!.items?.map((i) => [i.kind, i.severity, i.target])).toEqual([
      ['incident', 'critical', { fact: 'service', value: 'relay' }],
      ['incident', 'critical', { fact: 'service', value: 'shop-api' }],
    ]);
  });

  test('warns about issues that name nothing, and sends a bearer token without an email', async () => {
    const f = routed();
    const { email: _e, ...rest } = config;
    const ctx = testContext({ ...rest, mappings: [config.mappings[0]!] }, f.fetch, { JIRA_TOKEN: 's' });
    await drain(jiraConnector.discover(ctx));
    expect(f.calls[0]!.headers.authorization).toBe('Bearer s');
    expect(ctx.log.records.find((r) => r.message === 'jira issues name nothing')?.fields).toMatchObject({ issues: 1, by: 'label svc:' });
  });

  test('runConnector folds the mappings into one full batch of items', async () => {
    const run = await runConnector(jiraConnector, testContext<unknown>(config, routed().fetch, { JIRA_TOKEN: 's' }), 'ops-jira');
    expect(run.batch.partial).toBeUndefined();
    expect(run.batch.source).toBe('ops-jira');
    expect(run.batch.items).toHaveLength(5);
  });

  test('a mapping names its thing and its pointer exactly once', () => {
    const base = { url: 'https://example.atlassian.net', token: 't' };
    expect(JiraConfigSchema.safeParse({ ...base, mappings: [{ jql: 'x', label: 'a:', field: 'b', fact: 'c' }] }).success).toBe(false);
    expect(JiraConfigSchema.safeParse({ ...base, mappings: [{ jql: 'x', label: 'a:' }] }).success).toBe(false);
    expect(JiraConfigSchema.safeParse({ ...base, mappings: [{ jql: 'x', label: 'a:', fact: 'c' }] }).success).toBe(true);
  });
});
