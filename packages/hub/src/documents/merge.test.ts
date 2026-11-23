import { describe, expect, test } from 'bun:test';
import { mergeYaml, unifiedDiff } from './merge.ts';

const base = 'title: A\nnodes:\n  - name: One\n  - name: Two\nviews: []\n';

describe('merge', () => {
  test('merges edits to different lines', () => {
    const theirs = base.replace('title: A', 'title: B');
    const ours = base.replace('name: Two', 'name: Three');
    const m = mergeYaml(base, theirs, ours);
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.text).toBe('title: B\nnodes:\n  - name: One\n  - name: Three\nviews: []\n');
  });

  test('reports a conflict on the same line', () => {
    const m = mergeYaml(base, base.replace('title: A', 'title: B'), base.replace('title: A', 'title: C'));
    expect(m.ok).toBe(false);
    if (!m.ok) {
      expect(m.conflicts).toBe(1);
      expect(m.preview).toContain('<<<<<<< yours');
    }
  });

  test('unified diff names both sides', () => {
    const d = unifiedDiff('v1', base, 'v2', base.replace('title: A', 'title: B'));
    expect(d).toContain('--- v1');
    expect(d).toContain('+title: B');
  });
});
