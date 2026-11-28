/** The gate's rules about who makes a move: an approval never by its asker, a move for people never by an agent (VAN-2009). */
import { describe, expect, test } from 'bun:test';
import { parseDocumentText } from '@vantage/model';
import { kindOf } from './kinds.ts';
import { checkMove, openMoves, type Caller } from './gate.ts';
import type { ItemState } from './state.ts';

const def = kindOf(parseDocumentText(`title: Payouts
kind: { prefix: PAY, name: Payouts, lifecycle: flow }
views:
  - id: flow
    kind: lifecycle
    title: How a payout moves
    states:
      - { id: asked, text: Asked, class: not-started }
      - { id: paid, text: Paid, class: done }
      - { id: held, text: Held, class: parked }
    moves:
      - { from: asked, to: paid, label: pay, who: [author], people: true }
      - { from: asked, to: held, label: hold, who: [author] }
`).document!)!;

const item = (over: Partial<ItemState> = {}): ItemState => ({
  id: 'i1', orgId: 'o', kindId: 'k', workspaceId: 'w', number: 1, key: 'PAY-1', ref: null, title: 'Pay the vendor', state: 'asked', class: 'not-started',
  askerId: 'someone', holders: [], labels: {}, revision: null, bodyId: null, links: [], claim: null, owner: null, delegate: null, scope: null, workedBy: [], rank: null, position: 1, events: 1, notes: 0, files: 0, runs: 0,
  stateSince: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const person: Caller = { userId: 'ada', teamIds: [], role: 'author', agent: false };
const agentForAda: Caller = { ...person, agent: true };

describe('the gate judges the person, and a move for people refuses the agent', () => {
  test('people: true lets the person make the move and refuses an agent acting for them, naming the moves it may make', () => {
    expect(checkMove(def, item(), 'paid', person, new Map(), {}).ok).toBe(true);
    const refused = checkMove(def, item(), 'paid', agentForAda, new Map(), {});
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.why).toContain('pay is for people only');
    expect(refused.open.map((o) => o.to)).toEqual(['held']);
    expect(openMoves(def, item(), agentForAda, new Map()).map((o) => o.to)).toEqual(['held']);
    expect(openMoves(def, item(), person, new Map()).find((o) => o.to === 'paid')?.people).toBe(true);
  });
});
