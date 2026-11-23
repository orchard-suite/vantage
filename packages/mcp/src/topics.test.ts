import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DIAGNOSTIC_TOPICS } from '@vantage/model';
import { guideTopics } from './guide-text.ts';

const PACKAGES = join(import.meta.dir, '..', '..');
/** Where a problem with a document is raised: the engine, and the hub's check of a version. */
const SOURCES = ['model/src', 'layout/src', 'server/src', 'hub/src/render', 'hub/src/documents'];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('an error teaches', () => {
  test('every code an agent can be answered has a guide topic, and the guide has that topic', () => {
    const codes = new Set<string>();
    for (const dir of SOURCES) {
      for (const file of files(join(PACKAGES, dir))) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/(?:\.(?:error|warn|info)\(|code: )'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)) codes.add(m[1]!);
      }
    }
    expect(codes.size).toBeGreaterThan(25);
    expect([...codes].filter((c) => !DIAGNOSTIC_TOPICS[c]).sort()).toEqual([]);
    const topics = new Set(guideTopics());
    expect([...new Set(Object.values(DIAGNOSTIC_TOPICS))].filter((t) => !topics.has(t)).sort()).toEqual([]);
  });
});
