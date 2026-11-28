import { describe, expect, test } from 'bun:test';
import { TOOL_DOOR } from '@vantage/mcp';
import { agent } from '../mcp/testing.ts';
import { seeded } from './test-kit.ts';
import type { Decision } from './types.ts';

/** A registry with a record marked superseded that names no successor (LEGACY-2001), its replacement (LEGACY-2002), and a record with a successor (LEGACY-2003 by LEGACY-2004). */
async function hub() {
  const { t, me, ws } = await seeded();
  const a = await agent(t, me.headers);
  const door = (tool: string, args: Record<string, unknown>): Promise<string> => a.call(TOOL_DOOR, { tool, arguments: args });
  await door('vantage_registries', { action: 'create', workspace: ws.slug, prefix: 'LEGACY', name: 'Legacy' });
  const file = (n: number, title: string, status: string, extra = ''): { path: string; text: string } => ({ path: `docs/decisions/${n}-x.md`, text: `# ADR-${n}: ${title}\n\n## Status\n\n${status}${extra}\n\n## Context\n\nA.\n\n## Decision\n\nB.\n` });
  await door('vantage_decision_import', {
    registry: 'LEGACY',
    files: [file(2001, 'Orders leave the suite', 'Superseded'), file(2002, 'Orders join the suite', 'Accepted'), file(2003, 'Old queue', 'Superseded by ADR-2004'), file(2004, 'New queue', 'Accepted'), file(2005, 'Still standing', 'Accepted')],
  });
  const record = async (ref: string): Promise<Decision> => (await t.json(`/api/v1/decisions/${ref}`, { headers: me.headers })).body['decision'] as Decision;
  return { t, me, a, record };
}

describe('a superseded record names its successor', () => {
  test('a patch of superseded_by links both records, and the successor gains its back link', async () => {
    const { a, record } = await hub();
    expect((await record('LEGACY-2001')).supersededBy).toBeNull();
    const saved = await a.call('vantage_patch', { edits: [{ address: 'LEGACY-2001', old: 'status: superseded', new: 'status: superseded\nsuperseded_by: LEGACY-2002' }] });
    expect(saved).toContain('saved LEGACY-2001 (supersededBy)');
    expect((await record('LEGACY-2001')).supersededBy?.ref).toBe('LEGACY-2002');
    expect((await record('LEGACY-2002')).supersedes?.ref).toBe('LEGACY-2001');
    expect(await a.call('vantage_read', { addresses: ['LEGACY-2002'] })).toContain('supersedes: LEGACY-2001');
    // Both records keep a revision that says so.
    expect((await a.call(TOOL_DOOR, { tool: 'vantage_history', arguments: { address: 'LEGACY-2002' } })).split('\n')[0]).toContain('supersedes LEGACY-2001');
  });

  test('the successor may name it instead, with supersedes', async () => {
    const { a, record } = await hub();
    await a.call('vantage_patch', { edits: [{ address: 'LEGACY-2002', old: 'status: accepted', new: 'status: accepted\nsupersedes: LEGACY-2001' }] });
    expect((await record('LEGACY-2001')).supersededBy?.ref).toBe('LEGACY-2002');
    expect((await record('LEGACY-2001')).status).toBe('superseded');
    expect((await record('LEGACY-2002')).supersedes?.ref).toBe('LEGACY-2001');
  });

  test('an accepted record is marked superseded and linked in one write; status alone is refused', async () => {
    const { a, record } = await hub();
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'LEGACY-2005', old: 'status: accepted', new: 'status: superseded' }] })).text).toContain('superseded_by');
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'LEGACY-2005', old: 'status: accepted', new: 'status: accepted\nsuperseded_by: LEGACY-2002' }] })).text).toContain('status: superseded with superseded_by');
    await a.call('vantage_patch', { edits: [{ address: 'LEGACY-2005', old: 'status: accepted', new: 'status: superseded\nsuperseded_by: LEGACY-2002' }] });
    expect((await record('LEGACY-2005')).status).toBe('superseded');
    expect((await record('LEGACY-2005')).supersededBy?.ref).toBe('LEGACY-2002');
    // From the successor's side, the old record must already be superseded.
    expect((await a.attempt('vantage_patch', { edits: [{ address: 'LEGACY-2004', old: 'supersedes: LEGACY-2003', new: 'supersedes: LEGACY-2002' }] })).text).toContain('stays');
  });

  test('a link once set stays, and the refusal says so', async () => {
    const { a, record } = await hub();
    const moved = await a.attempt('vantage_patch', { edits: [{ address: 'LEGACY-2003', old: 'superseded_by: LEGACY-2004', new: 'superseded_by: LEGACY-2002' }] });
    expect(moved.text).toContain('superseded_by: LEGACY-2004 stays');
    const dropped = await a.attempt('vantage_patch', { edits: [{ address: 'LEGACY-2003', old: 'superseded_by: LEGACY-2004\n', new: '' }] });
    expect(dropped.text).toContain('never changed or taken off');
    // Named from the other side, the old record keeps its successor.
    const stolen = await a.attempt('vantage_patch', { edits: [{ address: 'LEGACY-2002', old: 'status: accepted', new: 'status: accepted\nsupersedes: LEGACY-2003' }] });
    expect(stolen.text).toContain('LEGACY-2003 is already superseded by LEGACY-2004; it keeps that successor');
    expect((await record('LEGACY-2003')).supersededBy?.ref).toBe('LEGACY-2004');
  });

  test('the successor is a record of the same registry, not the record itself, and no loop forms', async () => {
    const { t, me, a } = await hub();
    const patch = (ref: string, body: Record<string, unknown>) => t.json(`/api/v1/decisions/${ref}`, { method: 'PATCH', headers: me.headers, body: JSON.stringify(body) });
    await t.json('/api/v1/registries/SHOP/decisions', { method: 'POST', headers: me.headers, body: JSON.stringify({ title: 'Elsewhere', category: 2, deciders: ['Avery Example'], decidedOn: '2026-11-01', context: 'A.', decision: 'B.', consequences: 'C.' }) });
    expect(((await patch('LEGACY-2001', { supersededBy: 'SHOP-2001' })).body['error'] as string)).toContain('another registry');
    expect(((await patch('LEGACY-2001', { supersededBy: 'LEGACY-2001' })).body['error'] as string)).toContain('cannot supersede itself');
    expect(((await patch('LEGACY-2001', { supersededBy: 'LEGACY-9001' })).body['error'] as string)).toContain('not found');
    // LEGACY-2005 is marked superseded by LEGACY-2001; then LEGACY-2001 may not be superseded by LEGACY-2005.
    expect((await patch('LEGACY-2005', { status: 'superseded', supersededBy: 'LEGACY-2001' })).status).toBe(200);
    expect(((await patch('LEGACY-2001', { supersededBy: 'LEGACY-2005' })).body['error'] as string)).toContain('leads back to LEGACY-2001');
    // A new record is never written with a link: it supersedes through the supersede tool.
    const text = `---\ntitle: New\nstatus: accepted\ncategory: 2\ndecided: 2026-11-01\ndeciders: [Avery Example]\nsupersedes: LEGACY-2001\n---\n\n## Context\n\nA.\n\n## Decision\n\nB.\n\n## Consequences\n\nC.\n`;
    expect((await a.attempt('vantage_write', { writes: [{ address: 'LEGACY', text }] })).text).toContain('vantage_decision_supersede');
  });
});
