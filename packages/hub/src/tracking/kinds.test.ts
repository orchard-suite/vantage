import { describe, expect, test } from 'bun:test';
import { parseDocumentText } from '@vantage/model';
import { kindOf } from './kinds.ts';

const kind = (block: string) => kindOf(parseDocumentText(`title: Slices\nkind:\n${block}views: []\n`).document!)!;

describe('a kind built on a shipped base', () => {
  test('adds its own labels to the base labels, and one it names again takes the base label place', () => {
    const k = kind(`  prefix: KS\n  name: Slices\n  base: roadmap-item\n  labels:\n    - { name: slice, type: number }\n    - { name: horizon, type: choice, choices: [now, later] }\n`);
    expect(k.labels.map((l) => l.name)).toEqual(['promised', 'start', 'end', 'slice', 'horizon']);
    expect(k.labels.find((l) => l.name === 'horizon')?.choices).toEqual(['now', 'later']);
  });

  test('with no labels of its own, it takes the base labels', () => {
    expect(kind(`  prefix: KS\n  name: Slices\n  base: roadmap-item\n`).labels.map((l) => l.name)).toEqual(['horizon', 'promised', 'start', 'end']);
  });
});

describe('a kind built on another kind', () => {
  const team = kind(`  prefix: SW\n  name: Shop work\n  base: work-item\n  labels: [{ name: area, type: text }]\n  roles: { reviewer: [lead@example.com] }\n  parts: [SW]\n`);
  const on = (block: string) => kindOf(parseDocumentText(`title: Checkout\nkind:\n${block}views: []\n`).document!, team)!;

  test('adds to the kind as it adds to a shipped one, and ends its chain at the shipped kind', () => {
    const k = on(`  prefix: CW\n  name: Checkout work\n  base: SW\n  labels: [{ name: area, type: choice, choices: [till, web] }]\n  parts: [CW]\n`);
    expect(k.labels.map((l) => l.name)).toEqual(['due', 'size', 'area']);
    expect(k.labels.find((l) => l.name === 'area')?.type).toBe('choice');
    expect(k.roles).toEqual({ reviewer: ['lead@example.com'] });
    expect(k.parts).toEqual(['SW', 'CW']);
    expect(k.root).toBe('work-item');
    expect(k.drawnIn).toEqual({ view: 'lifecycle', shipped: 'work-item' });
    expect(k.moves).toEqual(team.moves);
  });

  test('a base that is no kind the hub has is refused', () => {
    expect(() => kind(`  prefix: CW\n  name: Checkout work\n  base: SW\n`)).toThrow('builds on SW, which is neither a shipped kind');
  });
});
