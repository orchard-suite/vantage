/**
 * An agent's forms of the verbs (VAN-3010, VAN-2009): claim and renew are
 * forms of hold, finish of release, ask of move. A claim belongs to one
 * run. A second run is refused while the first claim lives, even when both
 * act for the same person; a call from the same run renews it.
 */
import type { AppContext } from '../context.ts';
import type { Db } from '../db/db.ts';
import { runOf, type Principal } from '../auth/principal.ts';
import { agentLabels } from '../auth/agents.ts';
import { HttpError, badRequest } from '../http.ts';
import { classOf } from './kinds.ts';
import { checkMove, membersOf, namedBy } from './gate.ts';
import { CLAIM_MINUTES, NOTE_MAX, RUN_TEXT_MAX, type Claim, type EventData, type ItemState, type RunRecord } from './state.ts';
import { findItem, requireWorker } from './access.ts';
import { requirePerson } from './apps.ts';
import { clockOf } from '../day.ts';
import { claimedBy, commit, repeat, type WriteAnswer } from './write.ts';

const live = (claim: ItemState['claim'], now = Date.now()): boolean => !!claim && Date.parse(claim.until) > now;
const until = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

/** Who holds a live claim, as a refusal names it: another person, or another run of the caller's own. */
async function holderText(tx: Db, p: Principal, c: Claim): Promise<string> {
  if (c.userId !== p.userId) return 'another person';
  const agent = c.agentId ? (await agentLabels(tx, [c.agentId])).get(c.agentId) : undefined;
  return `another run of yours${agent ? ` (${agent})` : ''}`;
}

/**
 * Takes an item for a set time (VAN-3010). Two claims on one
 * item cannot both hold: the row lock and the feed lock order them, and the
 * second finds the first. A claim past its end holds nothing; the next
 * claim lets the lapsed claimant go first.
 */
export async function claim(ctx: AppContext, p: Principal, ref: string, minutes: number | undefined, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'a claim');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  requireWorker(f, members);
  const mins = Math.min(Math.max(1, minutes ?? CLAIM_MINUTES), 240);
  return commit({ ctx, p, key }, f.item.id, async (tx, before) => {
    const s = before!;
    const named = (x: ItemState): ReturnType<typeof namedBy> => namedBy(f.kind.definition, x, members);
    if (s.class === 'done' || s.class === 'parked') throw new HttpError(409, `${s.key} is ${s.state}; there is no work to claim`);
    if (s.claim && live(s.claim) && !claimedBy(s.claim, p)) throw new HttpError(409, `${s.key} is claimed by ${await holderText(tx, p, s.claim)} until ${clockOf(s.claim.until)}; vantage_queue offers it again when the claim runs out`);
    const events: { id: string; data: EventData }[] = [];
    if (s.claim && !live(s.claim) && s.claim.userId !== p.userId) events.push({ id: s.id, data: { type: 'released', userId: s.claim.userId } });
    events.push({ id: s.id, data: { type: 'claimed', userId: p.userId, until: until(mins), agentId: p.agent?.id ?? null, run: runOf(p) } });
    return { events, line: `${s.key} is claimed by you for ${mins} minutes; any call you make on it renews the claim`, key: s.key, named };
  });
}

/** Keeps a claim alive. The bridge sends it while its session lives; the claiming run's own calls renew too. */
export async function renew(ctx: AppContext, p: Principal, ref: string, key: string | undefined): Promise<WriteAnswer> {
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const f = await findItem(ctx, p, ref);
  const members = await membersOf(ctx.db, p.orgId, f.kind.definition);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    if (!s.claim || !claimedBy(s.claim, p)) throw new HttpError(409, `you hold no claim on ${s.key}; take one with claim`);
    return { events: [{ id: s.id, data: { type: 'renewed', until: until(CLAIM_MINUTES) } }], line: `${s.key} is claimed by you for ${CLAIM_MINUTES} more minutes`, key: s.key, named: (x) => namedBy(f.kind.definition, x, members) };
  });
}

export interface FinishInput {
  /** The state to move to, through the gate. */
  readonly move?: string | undefined;
  readonly run: RunRecord;
}

/** Ends a run in one call: its run record, its move, and letting the item go, each its own event. */
export async function finish(ctx: AppContext, p: Principal, ref: string, input: FinishInput, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'finishing a run');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const r = input.run;
  if (!r.summary.trim()) throw badRequest('a run record says what the run did');
  if (r.summary.length > RUN_TEXT_MAX || (r.handoff?.length ?? 0) > RUN_TEXT_MAX) throw badRequest(`a run summary and a handoff note are at most ${RUN_TEXT_MAX} characters each; attach a longer account as a file`);
  if (r.proof.length > 20 || r.proof.some((x) => x.length > 300)) throw badRequest('a run names at most 20 pieces of proof, each a short address or link');
  const f = await findItem(ctx, p, ref);
  const def = f.kind.definition;
  const members = await membersOf(ctx.db, p.orgId, def);
  const mine = !!f.item.claim && claimedBy(f.item.claim, p);
  // The claimant may finish what it took, even when its move already left the state the role was named on.
  if (!mine) requireWorker(f, members);
  return commit({ ctx, p, key }, f.item.id, async (tx, before) => {
    const s = before!;
    if (s.claim && live(s.claim) && !claimedBy(s.claim, p)) throw new HttpError(409, `${s.key} is claimed by ${await holderText(tx, p, s.claim)} until ${clockOf(s.claim.until)}; the run that holds it finishes it`);
    const events: { id: string; data: EventData }[] = [{ id: s.id, data: { type: 'ran', run: { summary: r.summary.trim(), proof: r.proof, ...(r.handoff?.trim() ? { handoff: r.handoff.trim() } : {}), ...(r.seconds !== undefined ? { seconds: r.seconds } : {}), ...(r.cost ? { cost: r.cost } : {}) } } }];
    let moved = '';
    if (input.move && input.move !== s.state) {
      const gate = checkMove(def, s, input.move, f.caller, members, { note: r.summary });
      if (!gate.ok) throw new HttpError(409, `${s.key} did not finish: ${gate.why}`, { open: gate.open });
      events.push({ id: s.id, data: { type: 'moved', from: s.state, to: input.move, class: classOf(def, input.move)!, note: r.summary.trim() } });
      moved = `, moved ${s.state} → ${input.move}`;
    }
    if (s.holders.includes(p.userId) || s.claim?.userId === p.userId) events.push({ id: s.id, data: { type: 'released', userId: p.userId } });
    return { events, line: `${s.key} run recorded${moved}, and released`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
}

/** Asks a person on the item: it moves to the state where its lifecycle waits for an answer, carrying the question. */
export async function ask(ctx: AppContext, p: Principal, ref: string, question: string, key: string | undefined): Promise<WriteAnswer> {
  requirePerson(p, 'asking on an item');
  const again = await repeat(ctx, p, key);
  if (again) return again;
  const q = question.trim();
  if (!q) throw badRequest('a question has words');
  if (q.length > NOTE_MAX) throw badRequest(`a question is at most ${NOTE_MAX} characters`);
  const f = await findItem(ctx, p, ref);
  const def = f.kind.definition;
  const members = await membersOf(ctx.db, p.orgId, def);
  return commit({ ctx, p, key }, f.item.id, async (_tx, before) => {
    const s = before!;
    const waits = def.states.filter((x) => x.waits).map((x) => x.id);
    const to = def.moves.find((m) => m.from === s.state && waits.includes(m.to))?.to;
    if (!to) throw new HttpError(409, `${s.key}'s lifecycle draws no move from ${s.state} to a state that waits for a person; note the question instead`);
    const gate = checkMove(def, s, to, f.caller, members, { note: q });
    if (!gate.ok) throw new HttpError(409, `${s.key} did not move: ${gate.why}`, { open: gate.open });
    return { events: [{ id: s.id, data: { type: 'moved', from: s.state, to, class: classOf(def, to)!, note: q, question: true } }], line: `${s.key} waits in ${to} for an answer`, key: s.key, named: (x) => namedBy(def, x, members) };
  });
}
