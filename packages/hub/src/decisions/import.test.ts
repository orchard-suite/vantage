import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alternativesFrom, isRecordFile, mapStatus, numbersIn, parseRecord } from './import.ts';

const DIR = join(import.meta.dir, 'fixtures');
const file = (name: string) => ({ path: `docs/decisions/${name}`, text: readFileSync(join(DIR, name), 'utf8') });

describe('reading Markdown decision records', () => {
  test('a record with a metadata table keeps its number, dates, makers, status, and sections', () => {
    const r = parseRecord(file('2001-agents-sign-in-through-the-hub.md'));
    expect(r.number).toBe(2001);
    expect(r.title).toBe('Agents sign in through the hub');
    expect(r.decidedOn).toBe('2026-03-02');
    expect(r.updatedOn).toBe('2026-04-10');
    expect(r.deciders).toEqual(['Avery Example', 'Sam Sample']);
    expect(r.status).toBe('superseded');
    expect(r.supersededBy).toEqual([2002]);
    expect(r.related).toEqual([1001]);
    expect(r.context).toBe('Agents need a key. Keys in files leak.');
    expect(r.alternatives.map((a) => a.option)).toEqual(['Shared service key', 'No sign-in']);
    expect(r.decision).toContain('### Verification');
    expect(r.notes).toContain('kept under Decision, as headings of their own: Verification');
  });

  test('a MADR record reads its front matter, bullet options, and consequences under the outcome', () => {
    const r = parseRecord(file('2002-agents-use-device-codes.md'));
    expect(r.number).toBe(2002);
    expect(r.title).toBe('Agents use device codes');
    expect(r.status).toBe('accepted');
    expect(r.decidedOn).toBe('2026-05-01');
    expect(r.deciders).toEqual(['Avery Example', 'Sam Sample']);
    expect(r.alternatives).toEqual([
      { option: 'Pasted tokens', rejected: 'they go stale.' },
      { option: 'Browser redirect', rejected: 'agents run with no browser.' },
    ]);
    expect(r.decision).toBe('Agents sign in with a device code.');
    expect(r.consequences).toBe('Good, because nothing is pasted.');
  });

  test('a Nygard record reads its date line; an unknown status and missing makers are reported', () => {
    const r = parseRecord(file('0003-record-decisions.md'));
    expect(r.number).toBe(3);
    expect(r.title).toBe('Record architecture decisions');
    expect(r.decidedOn).toBe('2025-01-15');
    expect(r.status).toBe('deprecated');
    expect(r.notes.some((n) => n.includes('"Rejected"'))).toBe(true);
    expect(r.notes).toContain('no decision makers found; name them on the record');
  });

  test('an index, a template, and a non-Markdown file are not records', () => {
    expect(readdirSync(DIR).filter(isRecordFile).sort()).toEqual(['0003-record-decisions.md', '2001-agents-sign-in-through-the-hub.md', '2002-agents-use-device-codes.md', 'notes-without-number.md']);
    expect(isRecordFile('docs/adr/diagram.png')).toBe(false);
  });

  test('citations in text, statuses, and alternatives that do not split', () => {
    expect(numbersIn('see ADR-0007, [x](1002-foo.md) and adr 12').sort((a, b) => a - b)).toEqual([7, 12, 1002]);
    expect(mapStatus('Approved').status).toBe('accepted');
    expect(mapStatus('Draft').status).toBe('proposed');
    // A record that replaces another says so in its status line; it still stands.
    expect(mapStatus('Accepted. Supersedes [ADR-5020](5020-x.md).').status).toBe('accepted');
    expect(mapStatus('Superseded by [ADR-5046](5046-x.md)').status).toBe('superseded');
    expect(mapStatus('Replaced by ADR-0009').status).toBe('superseded');
    const notes: string[] = [];
    expect(alternativesFrom('We looked at a few things and none fit.', notes)).toEqual([{ option: 'Alternatives as recorded', rejected: 'We looked at a few things and none fit.' }]);
    expect(notes).toHaveLength(1);
  });

  test('a record keeps its lead, status note, related prose, references, and one alternative per bullet', () => {
    const text = [
      '# SHOP-2001: Orders go through one queue',
      '',
      '| | |',
      '|---|---|',
      '| **Decision Date** | 2026-03-02 |',
      '| **Decision Maker** | Avery Example |',
      '',
      'This record sets how orders reach the warehouse.',
      '',
      '## Status',
      '',
      'Accepted. Revisit when a second warehouse opens.',
      '',
      '## Context',
      '',
      'Orders arrive from three shops.',
      '',
      '## Decision',
      '',
      'One queue takes every order.',
      '',
      '## Alternatives Considered',
      '',
      '- **A queue per shop.** Rejected because the warehouse reads one place.',
      '- **Direct calls.** Rejected because a slow warehouse stalls checkout.',
      '- **Nightly batch.** Rejected because orders wait a day.',
      '',
      '## Related',
      '',
      '- SHOP-2002 sets the queue retention.',
      '- [The warehouse runbook](https://example.com/runbook)',
      '',
      '## References',
      '',
      '- [Queue sizing notes](https://example.com/sizing)',
    ].join('\n');
    const r = parseRecord({ path: 'docs/decisions/orders-queue.md', text }, 'SHOP');
    expect(r.title).toBe('Orders go through one queue');
    expect(r.number).toBe(2001);
    expect(r.status).toBe('accepted');
    expect(r.decidedOn).toBe('2026-03-02');
    expect(r.context).toBe('This record sets how orders reach the warehouse.\n\nOrders arrive from three shops.\n\n### Status\n\nRevisit when a second warehouse opens.');
    expect(r.alternatives).toEqual([
      { option: 'A queue per shop', rejected: 'Rejected because the warehouse reads one place.' },
      { option: 'Direct calls', rejected: 'Rejected because a slow warehouse stalls checkout.' },
      { option: 'Nightly batch', rejected: 'Rejected because orders wait a day.' },
    ]);
    expect(r.related).toEqual([2002]);
    expect(r.decision).toContain('### Related\n\n- SHOP-2002 sets the queue retention.\n- [The warehouse runbook](https://example.com/runbook)');
    expect(r.decision).toContain('### References\n\n- [Queue sizing notes](https://example.com/sizing)');
  });

  test('a status that only names its successor or its day leaves no note', () => {
    const r = parseRecord({ path: 'docs/decisions/0009-x.md', text: '# ADR-0009: X\n\n## Status\n\nSuperseded by [ADR-0010](0010-y.md) on 2026-04-01\n\n## Context\n\nWhy.\n' });
    expect(r.title).toBe('X');
    expect(r.context).toBe('Why.');
    expect(r.supersededBy).toEqual([10]);
  });
});
