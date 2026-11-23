import { describe, expect, test } from 'bun:test';
import { citableRef, isRegistryPrefix, localRef, machineRef, parseDecisionRef, qualifiedRef } from './decision-ref.ts';
import { loadModelFromText } from './load.ts';

describe('decision citations', () => {
  test('reads the three forms', () => {
    expect(parseDecisionRef('SHOP-2001')).toEqual({ kind: 'qualified', prefix: 'SHOP', number: 2001 });
    expect(parseDecisionRef('ADR-0007')).toEqual({ kind: 'local', number: 7 });
    expect(parseDecisionRef('adr:01JD3K5Q9W8X2Y4Z6A7B8C9D0E')).toEqual({ kind: 'machine', id: '01JD3K5Q9W8X2Y4Z6A7B8C9D0E' });
  });

  test('refuses what is none of them', () => {
    for (const bad of ['shop-2001', 'SHOP-201', 'SHOP-20011', 'S-2001', 'adr:not-a-ulid', '2001', '']) expect(parseDecisionRef(bad)).toBeUndefined();
  });

  test('a document cites the qualified or machine form, never the local one', () => {
    expect(citableRef('ADR-2001')).toBeUndefined();
    expect(citableRef('ORG-0003')).toBeDefined();
  });

  test('writes four digits and refuses ADR as a prefix', () => {
    expect(qualifiedRef('ORG', 3)).toBe('ORG-0003');
    expect(localRef(2001)).toBe('ADR-2001');
    expect(machineRef('01JD3K5Q9W8X2Y4Z6A7B8C9D0E')).toBe('adr:01JD3K5Q9W8X2Y4Z6A7B8C9D0E');
    expect(isRegistryPrefix('ADR')).toBe(false);
    expect(isRegistryPrefix('SHOP')).toBe(true);
    expect(isRegistryPrefix('shop')).toBe(false);
  });

  test('a box carries the records it cites, and a bad citation is an error at its path', () => {
    const ok = loadModelFromText('nodes:\n  - { name: Orders API, decisions: [SHOP-2001, SHOP-2001, ORG-0003] }\n');
    expect(ok.model?.nodes.get('orders-api')?.decisions).toEqual(['SHOP-2001', 'ORG-0003']);
    const bad = loadModelFromText('nodes:\n  - { name: Orders API, decisions: [ADR-2001] }\n');
    const d = bad.diagnostics.find((x) => x.code === 'bad-decision-ref');
    expect(d?.severity).toBe('error');
    expect(d?.path).toBe('nodes[0].decisions[0]');
  });
});
