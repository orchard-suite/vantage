/** The clash rule and the departure gate, as pure functions of an edition's body (VAN-3019). */
import { describe, expect, test } from 'bun:test';
import { chainOf, hashBody, sharedScope, withConflicts, type ClashFacts } from './build.ts';
import { machineGate } from './gate.ts';
import { EMPTY_BODY, type EditionBody, type StandardLine } from './model.ts';
import { StandardSettingSchema } from './setting.ts';
import type { Scope } from '../scopes/repo.ts';

const tree = new Map<string, Scope>(
  [
    { id: 'acme', name: 'Acme', kind: 'organization', facets: [], profile: {} },
    { id: 'payments', name: 'Payments', kind: 'department', parent: 'acme', facets: [], profile: {} },
    { id: 'finance', name: 'Finance', kind: 'department', parent: 'acme', facets: [], profile: {} },
    { id: 'checkout', name: 'Checkout', kind: 'team', parent: 'payments', facets: [], profile: {} },
  ].map((s) => [s.id, s]),
);

const line = (record: string, from: string, binding: string, extra: Partial<StandardLine> = {}): StandardLine => ({ record, ref: record.toUpperCase(), title: record, area: 'Data', workspace: 'ws', from, path: [], position: { line: `${record} holds.`, binding, binds: ['people'], locked: false, reach: { below: true, facets: [], paths: [] }, enforced_by: [], checked_by: [] }, ...extra });

const body: EditionBody = { ...EMPTY_BODY, lines: [line('pay-1', 'payments', 'should'), line('fin-1', 'finance', 'must')] };
const facts = (clash: ClashFacts['clash'], ranked: string[] = []): ClashFacts => ({ clash, ranked, bindings: ['must', 'should', 'may'], chainOf: (k) => chainOf(k, tree) });
const open = [{ number: 1, scope: 'payments', lines: ['pay-1', 'fin-1'] as const }];

describe('the clash rule', () => {
  test('the nearest shared scope is the closest scope at or above both', () => {
    expect(sharedScope('checkout', 'finance', tree)).toBe('acme');
    expect(sharedScope('checkout', 'payments', tree)).toBe('payments');
    expect(sharedScope('checkout', 'nowhere', tree)).toBe('');
    expect(chainOf('checkout', tree)).toEqual(['checkout', 'payments', 'acme', '']);
  });

  test('hold keeps both; stricter holds the earlier binding word; ranked holds the first-ranked chain', async () => {
    expect(withConflicts(body, 'checkout', new Set(['payments', 'acme', '']), open, facts('hold')).conflicts).toEqual([{ conflict: 1, lines: ['PAY-1', 'FIN-1'], holds: 'both' }]);
    const stricter = withConflicts(body, 'payments', new Set(['acme', '']), open, facts('stricter'));
    expect(stricter.conflicts![0]!.holds).toBe('FIN-1');
    expect(stricter.lines.find((l) => l.record === 'pay-1')!.held).toBe(1);
    const ranked = withConflicts(body, 'payments', new Set(['acme', '']), open, facts('ranked', ['payments', 'finance']));
    expect(ranked.conflicts![0]!.holds).toBe('PAY-1');
    expect(ranked.lines.find((l) => l.record === 'fin-1')!.held).toBe(1);
    // Neither chain ranked: both hold.
    expect(withConflicts(body, 'payments', new Set(['acme', '']), open, facts('ranked', ['other'])).conflicts![0]!.holds).toBe('both');
  });

  test('a conflict acts only in its scope and below, and an edition with none keeps its hash', async () => {
    const above = withConflicts(body, 'acme', new Set(['']), open, facts('hold'));
    expect(above.conflicts).toBeUndefined();
    expect(await hashBody(above)).toBe(await hashBody(body));
  });
});

describe('the departure gate', () => {
  test('an edition whose line departs from another line in it, with no exception, is refused', () => {
    const departing: EditionBody = { ...EMPTY_BODY, lines: [line('pay-1', 'payments', 'should'), line('chk-1', 'checkout', 'must', { departs: ['pay-1'] })] };
    const setting = StandardSettingSchema.parse({});
    const problems = machineGate(departing, { setting, records: new Set(['pay-1', 'chk-1']), team: new Set(['ws']) });
    expect(problems).toEqual(['CHK-1: departs from PAY-1 with no exception in force (VAN-3020); grant one or change the record']);
  });
});
