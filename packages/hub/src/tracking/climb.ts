/**
 * What an agent reads before it starts, past its card and its state's page
 * (VAN-3026): the item's parent and each roadmap item above it, every
 * decision the item and that chain link, and the edition of the standard
 * that binds the item's scope. Each is an address with its size, never its
 * text. The chain and the records are capped so a queue card stays small,
 * and a capped list names the read that goes on.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { accessibleWorkspaces } from '../authz.ts';
import { maybe } from '../db/db.ts';
import { bindingOf } from '../standards/inherit.ts';
import { scopeKey, scopeName } from '../standards/model.ts';
import { editionOf, hasStandards } from '../standards/repo.ts';
import { STANDARD, standardText } from '../standards/text.ts';

/** The most items above an item a card names. */
export const CLIMB_MAX = 4;
/** The most records a card names. */
export const RECORDS_MAX = 6;

/** What a queue reads once for all its cards. */
export interface ClimbReach {
  readonly workspaces: ReadonlySet<string>;
  readonly standards: boolean;
}

export async function climbReach(ctx: AppContext, p: Principal): Promise<ClimbReach> {
  return { workspaces: new Set((await accessibleWorkspaces(ctx.db, p)).map((w) => w.id)), standards: await hasStandards(ctx.db, p.orgId) };
}

interface Rung {
  readonly id: string;
  readonly key: string;
  readonly parent_id: string | null;
  readonly workspace_id: string;
  readonly bytes: number | null;
}

const bytesOf = (n: number | null): string => `${n ?? 0} bytes`;

/** The read-first lines past the card and the state's page, for one item. */
export async function climb(ctx: AppContext, p: Principal, reach: ClimbReach, item: { readonly id: string; readonly parentId: string | null; readonly workspaceId: string; readonly scope: string | null }): Promise<string[]> {
  const out: string[] = [];
  const chain: Rung[] = [];
  const seen = new Set([item.id]);
  let next = item.parentId;
  while (next && !seen.has(next)) {
    seen.add(next);
    const r = await maybe<Rung>(ctx.db, 'select i.id, i.key, i.parent_id, i.workspace_id, octet_length(b.text) as bytes from items i left join item_bodies b on b.id = i.body_id where i.id = $1 and i.org_id = $2', [next, p.orgId]);
    // An item above in a workspace the caller cannot open ends the climb: its key is not theirs to read.
    if (!r || !reach.workspaces.has(r.workspace_id)) break;
    if (chain.length === CLIMB_MAX) {
      out.push(`more above ${chain[chain.length - 1]!.key}: vantage_read ${r.key}, whose card names its parent`);
      break;
    }
    out.push(`${r.key} (${chain.length ? `above ${chain[chain.length - 1]!.key}` : 'its parent'}, body ${bytesOf(r.bytes)})`);
    chain.push(r);
    next = r.parent_id;
  }
  // The item's own records first, then each rung's, nearest first; a record two of them link is named once, by the nearest.
  const linkers = [item.id, ...chain.map((r) => r.id)];
  const rows = await ctx.db.query<{ id: string; ref: string; by: string; workspace_id: string; bytes: number }>(
    `select d.id, g.prefix || '-' || lpad(d.number::text, 4, '0') as ref, i.key as by, g.workspace_id,
       octet_length(d.title) + octet_length(d.context) + octet_length(d.decision) + octet_length(d.consequences) + octet_length(d.alternatives::text) as bytes
     from item_links l join items i on i.id = l.item_id join decisions d on d.id = l.target join decision_registries g on g.id = d.registry_id
     where l.rel = 'decision' and l.item_id = any($1::text[]) order by array_position($1::text[], i.id), g.prefix, d.number`,
    [linkers],
  );
  const records = rows.filter((r, i) => reach.workspaces.has(r.workspace_id) && rows.findIndex((x) => x.id === r.id) === i);
  const own = chain.length ? new Set(chain.map((c) => c.key)) : new Set<string>();
  for (const r of records.slice(0, RECORDS_MAX)) out.push(`${r.ref} (decision${own.has(r.by) ? ` linked by ${r.by}` : ''}, ${bytesOf(r.bytes)})`);
  const cut = records.slice(RECORDS_MAX);
  if (cut.length) out.push(`${cut.length} more decision${cut.length === 1 ? '' : 's'}: vantage_read ${[...new Set(cut.map((r) => `${r.by}#links`))].join(', ')}`);
  if (reach.standards) out.push(await standardLine(ctx, p, item));
  return out;
}

/** The edition that binds the item's scope: its own scope, or its workspace's. */
async function standardLine(ctx: AppContext, p: Principal, item: { readonly workspaceId: string; readonly scope: string | null }): Promise<string> {
  const name = item.scope ?? scopeName(await bindingOf(ctx.db, p.orgId, item.workspaceId));
  const e = await editionOf(ctx.db, p.orgId, scopeKey(name));
  if (!e) return `${STANDARD}/${name} (the standard for its scope, no edition published yet)`;
  const size = new TextEncoder().encode(standardText({ name, title: e.manifest.name, kind: e.manifest.kind }, e)).length;
  return `${STANDARD}/${name}@${e.version} (the standard for its scope, ${size} bytes)`;
}
