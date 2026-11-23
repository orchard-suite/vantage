import { describe, expect, test } from 'bun:test';
import { rewriteDocumentText, rewriteRecordText, type Move } from './rewrite.ts';

const sameRegistry: Move = { fromRegistry: 'r1', fromPrefix: 'SHOP', fromNumber: 2001, toRegistry: 'r1', toPrefix: 'SHOP', toNumber: 1004 };
const otherRegistry: Move = { fromRegistry: 'r1', fromPrefix: 'SHOP', fromNumber: 2001, toRegistry: 'r2', toPrefix: 'PAY', toNumber: 2002 };

describe('citation rewrites', () => {
  test('a document rewrites the qualified citation and nothing that only looks like it', () => {
    const text = 'decisions: [SHOP-2001, SHOP-2002]\n[[decision:SHOP-2001]] [why](decision:SHOP-2001) XSHOP-2001 SHOP-20011 adr:01JD3K5Q9W8X2Y4Z6A7B8C9D0E';
    expect(rewriteDocumentText(text, sameRegistry)).toBe('decisions: [SHOP-1004, SHOP-2002]\n[[decision:SHOP-1004]] [why](decision:SHOP-1004) XSHOP-2001 SHOP-20011 adr:01JD3K5Q9W8X2Y4Z6A7B8C9D0E');
  });

  test('within a registry, local and qualified citations follow the new number', () => {
    expect(rewriteRecordText('ADR-2001, SHOP-2001, ADR-2002, ORG-2001', sameRegistry, { registry: 'r1', self: false })).toBe('ADR-1004, SHOP-1004, ADR-2002, ORG-2001');
    expect(rewriteRecordText('This is ADR-2001; see ADR-2002.', sameRegistry, { registry: 'r1', self: true })).toBe('This is ADR-1004; see ADR-2002.');
  });

  test('across registries, a local citation never changes meaning', () => {
    // A record left behind cites the moved one by its new qualified citation.
    expect(rewriteRecordText('Builds on ADR-2001 and ADR-2003.', otherRegistry, { registry: 'r1', self: false })).toBe('Builds on PAY-2002 and ADR-2003.');
    // The moved record qualifies what it left behind and keeps citing itself locally.
    expect(rewriteRecordText('This is ADR-2001; it leans on ADR-2003 and PAY-1001.', otherRegistry, { registry: 'r1', self: true })).toBe('This is ADR-2002; it leans on SHOP-2003 and PAY-1001.');
    // A record in another registry only ever cited it qualified.
    expect(rewriteRecordText('See SHOP-2001, not ADR-2001.', otherRegistry, { registry: 'r3', self: false })).toBe('See PAY-2002, not ADR-2001.');
  });
});
