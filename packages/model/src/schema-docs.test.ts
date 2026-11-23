import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from './load.ts';
import { pathMatches, staleTies } from './evidence.ts';

const BASE = `title: T
nodes:
  - name: Api
views:
  - { id: guide, kind: doc, title: Guide, text: "## Buy {#buy}\\n\\nThe [[api]]." }
`;
const codes = (yaml: string): string[] => loadModelFromText(yaml).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

describe('the docs block, artifacts, and evidence', () => {
  test('a clean contract, artifact, and tie load with no errors', () => {
    expect(codes(`${BASE}docs: { kind: system, repository: github.com/acme/shop, pages: [guide], checks: [evidence] }\nartifacts:\n  - { file: artifacts/SPEC.md }\nevidence:\n  - { to: api, files: [src/], commit: abc1234 }\n  - { to: guide#buy, files: [src/a.ts], commit: abc1234 }\n`)).toEqual([]);
  });

  test('a page the contract asks for, an artifact outside its folder, and a tie to nothing are errors', () => {
    expect(codes(`${BASE}docs: { pages: [runbook] }\nartifacts:\n  - { file: SPEC.md }\nevidence:\n  - { to: gone, files: [../x], commit: abc1234 }\n`)).toEqual(['docs-page-missing', 'artifact-path', 'evidence-unknown-target', 'evidence-path']);
  });

  test('paths match exactly, by folder, and by pattern', () => {
    expect(pathMatches('src/', 'src/a/b.ts')).toBe(true);
    expect(pathMatches('src/*.ts', 'src/a.ts')).toBe(true);
    expect(pathMatches('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(pathMatches('src/**/*.ts', 'src/a/b.ts')).toBe(true);
    expect(pathMatches('README.md', 'docs/README.md')).toBe(false);
  });

  test('a tie is stale when a later commit touches its files, and unknown when its commit is out of the history', () => {
    const commits = [{ sha: 'aaa1111', files: [{ path: 'src/a.ts' }] }, { sha: 'bbb2222', files: [{ path: 'src/a.ts' }, { path: 'x.md' }] }];
    const ties = [{ to: 'api', files: ['src/'], commit: 'aaa1111' }, { to: 'b', files: ['x.md'], commit: 'bbb2222' }, { to: 'c', files: ['src/'], commit: 'fff9999' }];
    expect(staleTies(ties, commits).map((s) => [s.tie.to, s.why, s.commits.map((c) => c.sha)])).toEqual([['api', 'changed', ['bbb2222']], ['c', 'unknown', ['aaa1111', 'bbb2222']]]);
  });
});
