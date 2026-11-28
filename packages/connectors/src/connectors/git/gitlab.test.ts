import { describe, expect, test } from 'bun:test';
import { BatchSchema } from '../../batch.ts';
import { keptStore } from '../../kept.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { gitConnector, GitConfigSchema, gitlabHost } from './git.ts';

const dir = `${import.meta.dir}/fixtures`;
const project = 'projects/acme%2Fplatform%2Frelay';

function api(base = 'https://gitlab.com/api/v4') {
  return fixtureFetch(dir, [
    { match: `${base}/${project}/repository/commits?ref_name=main`, file: 'gitlab-commits.json' },
    { match: /commits\/a1a1[0-9a-f]+\/diff/, file: 'gitlab-diff-a1.json' },
    { match: /commits\/b2b2[0-9a-f]+\/diff/, file: 'gitlab-diff-b2.json' },
    { match: /commits\/c3c3[0-9a-f]+\/diff/, file: 'gitlab-diff-c3.json' },
    { match: new RegExp(`${base.replace(/[.]/g, '\\.')}/${project}$`), file: 'gitlab-project.json' },
  ]);
}

describe('git connector on GitLab', () => {
  test('reads a nested project on gitlab.com with its token as PRIVATE-TOKEN, oldest first, with files, diffs, and Work trailers', async () => {
    const f = api();
    const config = GitConfigSchema.parse({ forge: 'gitlab', token: 'GITLAB_TOKEN', repositories: ['acme/platform/relay'] });
    const [batch] = await drain(gitConnector.discover(testContext(config, f.fetch, { GITLAB_TOKEN: 'glpat-test' })));
    expect(BatchSchema.safeParse(batch).success).toBe(true);
    const changes = batch!.changes![0]!;
    expect([changes.repository, changes.branch, changes.head]).toEqual(['gitlab.com/acme/platform/relay', 'main', 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3']);
    expect(changes.commits.map((c) => [c.sha.slice(0, 4), c.at, c.title, c.files.map((x) => x.path), c.work])).toEqual([
      ['a1a1', '2026-11-01T10:00:00.000Z', 'feat(relay): start', ['src/hooks.ts'], undefined],
      ['b2b2', '2026-11-02T10:00:00.000Z', 'docs(relay): readme', ['README.md'], undefined],
      ['c3c3', '2026-11-03T10:00:00.000Z', 'fix(relay): retry a dropped hook', ['src/hooks.ts', 'src/retry.ts'], ['SW-12', 'PLAN-3']],
    ]);
    expect(changes.commits[2]!.files[0]!.patch).toContain('+export const retries = 3;');
    expect(changes.commits[2]!.files[1]!.patch).toBeUndefined();
    expect(f.calls.every((c) => c.headers['private-token'] === 'glpat-test' && c.headers.authorization === undefined)).toBe(true);
    expect(f.calls.map((c) => c.url.replace('https://gitlab.com/api/v4/', ''))).toEqual([
      project,
      `${project}/repository/commits?ref_name=main&per_page=100&page=1`,
      `${project}/repository/commits/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1/diff?per_page=100&page=1`,
      `${project}/repository/commits/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2/diff?per_page=100&page=1`,
      `${project}/repository/commits/c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3/diff?per_page=100&page=1`,
    ]);
  });

  test('a value in a Work trailer that is no item key is logged, never guessed', async () => {
    const config = GitConfigSchema.parse({ forge: 'gitlab', token: 'T', repositories: ['acme/platform/relay'] });
    const ctx = testContext(config, api().fetch, { T: 'glpat' });
    await drain(gitConnector.discover(ctx));
    expect(ctx.log.records.some((e) => e.message === 'git work trailer is not an item key' && JSON.stringify(e.fields).includes('someday'))).toBe(true);
  });

  test('a self-hosted server is read at its own API and names its projects under its own host; a kept commit is not read again', async () => {
    const base = 'https://git.example.com/api/v4';
    const kept = keptStore();
    const config = GitConfigSchema.parse({ forge: 'gitlab', url: base, token: 'T', repositories: ['acme/platform/relay'], branch: 'main' });
    const [first] = await drain(gitConnector.discover({ ...testContext(config, api(base).fetch, { T: 'glpat' }), kept }));
    expect(first!.changes![0]!.repository).toBe('git.example.com/acme/platform/relay');
    const again = api(base);
    const [second] = await drain(gitConnector.discover({ ...testContext(config, again.fetch, { T: 'glpat' }), kept: keptStore(kept.entries()) }));
    expect(again.calls.map((c) => c.url)).toEqual([`${base}/${project}/repository/commits?ref_name=main&per_page=100&page=1`]);
    expect(second!.changes![0]!.commits[2]!.work).toEqual(['SW-12', 'PLAN-3']);
  });

  test('GitLab signs in with a token only, and names a host with its port', () => {
    expect(GitConfigSchema.safeParse({ forge: 'gitlab', app: { id: '1', privateKey: 'K' }, repositories: ['acme/relay'] }).success).toBe(false);
    expect(GitConfigSchema.safeParse({ repositories: ['acme/platform/relay'] }).success).toBe(false);
    expect(gitlabHost('https://gitlab.com/api/v4')).toBe('gitlab.com');
    expect(gitlabHost('https://git.example.com:8443/api/v4')).toBe('git.example.com:8443');
  });
});
