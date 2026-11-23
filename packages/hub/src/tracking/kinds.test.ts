import { describe, expect, test } from 'bun:test';
import { parseDocumentText } from '@vantage/model';
import { kindOf } from './kinds.ts';

const kind = (block: string) => kindOf(parseDocumentText(`title: Slices\nkind:\n${block}views: []\n`).document!)!;

describe('a kind built on a shipped base', () => {
  test('adds its own labels to the base labels, and one it names again takes the base label place', () => {
    const k = kind(`  prefix: KS\n  name: Slices\n  base: roadmap-item\n  labels:\n    - { name: slice, type: number }\n    - { name: horizon, type: choice, choices: [now, later] }\n`);
    expect(k.labels.map((l) => l.name)).toEqual(['promised', 'slice', 'horizon']);
    expect(k.labels.find((l) => l.name === 'horizon')?.choices).toEqual(['now', 'later']);
  });

  test('with no labels of its own, it takes the base labels', () => {
    expect(kind(`  prefix: KS\n  name: Slices\n  base: roadmap-item\n`).labels.map((l) => l.name)).toEqual(['horizon', 'promised']);
  });
});
