/**
 * Agents (VAN-2009): an agent is its own principal, acting for one
 * person. Its row names the person, the name it goes by, the client it came
 * through, and the machine or runtime it runs on. A device-flow token and
 * an OAuth grant each name one. Disconnecting it ends its tokens and its
 * grants at once. Its reach is its person's reach, never more.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';

export interface AgentRow {
  readonly id: string;
  readonly org_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly client: string;
  readonly host: string | null;
  readonly created_at: Date;
  readonly revoked_at: Date | null;
}

/** An agent as the person sees it: with when it last called the hub. */
export interface AgentListed extends AgentRow {
  readonly last_used_at: Date | null;
}

export interface NewAgent {
  readonly orgId: string;
  readonly userId: string;
  readonly name: string;
  readonly client: string;
  readonly host?: string | null | undefined;
}

const clean = (s: string, max: number): string => s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export async function createAgent(db: Db, a: NewAgent): Promise<AgentRow> {
  const id = `agt_${randomId(12)}`;
  const host = a.host ? clean(a.host, 120) : '';
  await db.query('insert into agents (id, org_id, user_id, name, client, host) values ($1, $2, $3, $4, $5, $6)', [id, a.orgId, a.userId, clean(a.name, 120) || 'an agent', clean(a.client, 200) || 'unknown', host || null]);
  return (await agentById(db, id))!;
}

export async function agentById(db: Db, id: string): Promise<AgentRow | undefined> {
  return maybe<AgentRow>(db, 'select * from agents where id = $1', [id]);
}

/** How an agent reads to people: its name, and the machine it runs on. */
export function agentLabel(a: Pick<AgentRow, 'name' | 'host'>): string {
  return a.host && !a.name.endsWith(` on ${a.host}`) ? `${a.name} on ${a.host}` : a.name;
}

/** The agents acting for a person that are not disconnected, newest first. */
export async function listAgents(db: Db, userId: string): Promise<AgentListed[]> {
  return db.query<AgentListed>(
    `select a.*, greatest((select max(t.last_used_at) from tokens t where t.agent_id = a.id), (select max(g.last_used_at) from oauth_grants g where g.agent_id = a.id)) as last_used_at
       from agents a where a.user_id = $1 and a.revoked_at is null order by a.created_at desc`,
    [userId],
  );
}

/** Disconnects an agent: its tokens and its grants end now. `userId` null is an admin. */
export async function revokeAgent(db: Db, orgId: string, id: string, userId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = userId === null
      ? await tx.query('update agents set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null returning id', [orgId, id])
      : await tx.query('update agents set revoked_at = now() where org_id = $1 and id = $2 and user_id = $3 and revoked_at is null returning id', [orgId, id, userId]);
    if (!rows.length) return false;
    await tx.query('update oauth_grants set revoked_at = now() where agent_id = $1 and revoked_at is null', [id]);
    await tx.query('update tokens set revoked_at = now() where agent_id = $1 and revoked_at is null', [id]);
    return true;
  });
}

/** Each agent's label by id, for history and cards. */
export async function agentLabels(db: Db, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db.query<{ id: string; name: string; host: string | null }>('select id, name, host from agents where id = any($1::text[])', [want]);
  return new Map(rows.map((r) => [r.id, agentLabel(r)]));
}
