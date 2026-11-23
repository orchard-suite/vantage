import { describe, expect, test } from 'bun:test';
import { BatchSchema } from '../../batch.ts';
import { keptStore } from '../../kept.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { gitConnector, GitConfigSchema, repositoryHost } from './git.ts';

const detail = (sha: string, date: string, title: string, files: { filename: string; patch?: string }[]) => ({ sha, commit: { message: `${title}\n\nbody`, committer: { date } }, files });

function api() {
  return fixtureFetch('', [
    { match: /repos\/acme\/shop$/, json: { default_branch: 'main' } },
    { match: 'repos/acme/shop/commits?sha=main', json: [{ sha: 'ccc3333' }, { sha: 'bbb2222' }, { sha: 'aaa1111' }] },
    { match: 'commits/aaa1111', json: detail('aaa1111', '2026-11-01T10:00:00Z', 'feat(orders): start', [{ filename: 'src/orders/api.ts', patch: '@@ -0,0 +1 @@\n+start' }]) },
    { match: 'commits/bbb2222', json: detail('bbb2222', '2026-11-02T10:00:00Z', 'docs: readme', [{ filename: 'README.md' }]) },
    { match: 'commits/ccc3333', json: detail('ccc3333', '2026-11-03T10:00:00Z', 'fix(orders): retry', [{ filename: 'src/orders/api.ts', patch: `@@ -1 +1 @@\n${'+x'.repeat(3000)}` }]) },
  ]);
}

describe('git connector', () => {
  test('reads the default branch oldest first, with each commit\'s files and cut diffs, as a valid batch', async () => {
    const f = api();
    const config = GitConfigSchema.parse({ token: 'T', repositories: ['acme/shop'] });
    const [batch] = await drain(gitConnector.discover(testContext(config, f.fetch, { T: 'ghs' })));
    expect(BatchSchema.safeParse(batch).success).toBe(true);
    const changes = batch!.changes![0]!;
    expect([changes.repository, changes.branch, changes.head]).toEqual(['github.com/acme/shop', 'main', 'ccc3333']);
    expect(changes.commits.map((c) => [c.sha, c.title, c.files.map((x) => x.path)])).toEqual([
      ['aaa1111', 'feat(orders): start', ['src/orders/api.ts']],
      ['bbb2222', 'docs: readme', ['README.md']],
      ['ccc3333', 'fix(orders): retry', ['src/orders/api.ts']],
    ]);
    expect(changes.commits[2]!.files[0]!.patch!.endsWith('cut at 4000 characters')).toBe(true);
    expect(f.calls.every((c) => c.headers.authorization === 'Bearer ghs')).toBe(true);
  });

  test('reads a commit once: the next run takes it from what it kept, and paths narrow the files', async () => {
    const kept = keptStore();
    const config = GitConfigSchema.parse({ repositories: ['acme/shop'], branch: 'main', paths: ['src/'] });
    await drain(gitConnector.discover({ ...testContext(config, api().fetch), kept }));
    const again = api();
    const [batch] = await drain(gitConnector.discover({ ...testContext(config, again.fetch), kept: keptStore(kept.entries()) }));
    expect(again.calls.map((c) => c.url)).toEqual(['https://api.github.com/repos/acme/shop/commits?sha=main&per_page=100&page=1']);
    expect(batch!.changes![0]!.commits.map((c) => c.files.length)).toEqual([1, 0, 1]);
  });

  test('names a repository by the host people use', () => {
    expect(repositoryHost('https://api.github.com')).toBe('github.com');
    expect(repositoryHost('https://git.example.com/api/v3')).toBe('git.example.com');
  });
});
