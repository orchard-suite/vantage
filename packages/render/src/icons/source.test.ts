import { describe, expect, test } from 'bun:test';
import { BUILTIN_TYPES, PROFILES } from '@vantage/model';
import { FileIconSource } from './source.ts';

describe('icon packs', () => {
  const icons = new FileIconSource();

  test('every icon a built-in or profile type names is shipped', () => {
    const named = [...BUILTIN_TYPES.values(), ...[...PROFILES.values()].flatMap((p) => [...p.types.values()])].flatMap((t) => (t.icon ? [`${t.name}: ${t.icon}`] : []));
    expect(named.filter((n) => !icons.has(n.slice(n.indexOf(': ') + 2)))).toEqual([]);
  });
});
