/**
 * Modules' apps (VAN-2005). An admin registers an OAuth client
 * with the kinds it works and the workspace its kinds live in. Under its
 * app role a module reads its kinds whole, puts items and publishes their
 * labels, links them, and loads its kinds files; it never holds an item and
 * never makes a move a lifecycle gives a person. A person's act comes with
 * the person's own token.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { requireAdmin, requireWorkspace } from '../authz.ts';
import { randomId } from '../crypto.ts';
import { badRequest, forbidden } from '../http.ts';
import { audit } from '../audit.ts';

export interface AppRow {
  readonly id: string;
  readonly org_id: string;
  readonly client_id: string;
  readonly name: string;
  readonly workspace_id: string;
  readonly kinds: readonly string[];
}

export async function appOf(db: Db, orgId: string, clientId: string): Promise<AppRow | undefined> {
  return maybe<AppRow>(db, 'select * from item_apps where org_id = $1 and client_id = $2', [orgId, clientId]);
}

/** The app a module principal stands for; refused when no admin registered its client. */
export async function requireApp(ctx: AppContext, p: Principal): Promise<AppRow> {
  if (!p.module) throw forbidden('only a module app works as an app');
  const app = await appOf(ctx.db, p.orgId, p.module.clientId);
  if (!app) throw forbidden(`no admin has registered client ${p.module.clientId} as a module; register it with POST /api/v1/apps`);
  return app;
}

/** Throws unless the principal is a person or an agent: an app holds nothing and makes no person's move. */
export function requirePerson(p: Principal, what: string): void {
  if (p.module) throw forbidden(`${what} is for a person or an agent; a module makes a person's act with the person's own token, and its own work with its app`);
}

export interface AppInput {
  readonly clientId: string;
  readonly name: string;
  readonly workspace: string;
  readonly kinds: readonly string[];
}

/** Registers a module's client, or changes what it may work. Admins only. */
export async function registerApp(ctx: AppContext, p: Principal, input: AppInput): Promise<AppRow> {
  requireAdmin(p);
  const ws = await requireWorkspace(ctx.db, p, input.workspace, 'author');
  const kinds = [...new Set(input.kinds.map((k) => k.toUpperCase()))];
  if (kinds.some((k) => !/^[A-Z][A-Z0-9]{1,11}$/.test(k))) throw badRequest('kinds are prefixes: VAN, FORMS');
  if (!input.clientId.trim() || !input.name.trim()) throw badRequest('an app has a client id and a name');
  const existing = await appOf(ctx.db, p.orgId, input.clientId);
  const id = existing?.id ?? randomId();
  await ctx.db.query(
    `insert into item_apps (id, org_id, client_id, name, workspace_id, kinds, created_by) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (org_id, client_id) do update set name = excluded.name, workspace_id = excluded.workspace_id, kinds = excluded.kinds`,
    [id, p.orgId, input.clientId, input.name.trim(), ws.id, JSON.stringify(kinds), p.userId],
  );
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: p.userId, what: existing ? 'app.update' : 'app.register', surface: p.surface, target: `app:${input.clientId}`, details: { name: input.name, kinds } });
  return (await appOf(ctx.db, p.orgId, input.clientId))!;
}

export async function listApps(ctx: AppContext, p: Principal): Promise<AppRow[]> {
  requireAdmin(p);
  return ctx.db.query<AppRow>('select * from item_apps where org_id = $1 order by name', [p.orgId]);
}
