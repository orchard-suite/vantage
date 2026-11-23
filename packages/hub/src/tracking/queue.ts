/**
 * The queue an agent asks (docs/decisions/3010): what it may pick up, given
 * what it can do. It answers cards and addresses with their sizes, never
 * text, and the last handoff note, which is short enough to come along.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { maybe } from '../db/db.ts';
import { reachOf } from './access.ts';
import type { KindDef } from './kinds.ts';

/** One item an agent may take, with what to read first. */
export interface QueueCard {
  readonly key: string;
  readonly title: string;
  readonly state: string;
  readonly kind: string;
  readonly read: readonly string[];
  readonly handoff?: string;
}

/**
 * Items not done or parked, not waiting for a person, not under another
 * live claim, in workspaces the caller writes or waiting on a role the
 * caller holds. Oldest first, so nothing starves.
 */
export async function queue(ctx: AppContext, p: Principal, opts: { kinds?: readonly string[]; limit?: number } = {}): Promise<{ cards: QueueCard[]; total: number }> {
  const reach = await reachOf(ctx, p);
  const authored = [...reach.roles].filter(([, r]) => r === 'author').map(([w]) => w);
  const params: unknown[] = [p.orgId, authored, p.userId, [...p.teamIds]];
  let kinds = '';
  if (opts.kinds?.length) {
    params.push(opts.kinds.map((k) => k.toUpperCase()));
    kinds = ` and k.prefix = any($${params.length}::text[])`;
  }
  const where = `i.org_id = $1 and i.class in ('not-started', 'in-progress')${kinds}
      and (i.claim_until is null or i.claim_until < now() or i.claim_user = $3)
      and not exists (select 1 from jsonb_array_elements(k.definition -> 'states') st where st ->> 'id' = i.state and coalesce((st ->> 'waits')::boolean, false))
      and (i.workspace_id = any($2::text[]) or exists (select 1 from item_named n where n.item_id = i.id and n.why like 'role:%' and ((n.subject_kind = 'user' and n.subject_id = $3) or (n.subject_kind = 'team' and n.subject_id = any($4::text[])))))`;
  const total = Number((await ctx.db.query<{ n: number }>(`select count(*)::int as n from items i join item_kinds k on k.id = i.kind_id where ${where}`, params))[0]?.n ?? 0);
  const limit = Math.min(Math.max(1, opts.limit ?? 5), 20);
  const rows = await ctx.db.query<{ id: string; key: string; title: string; state: string; prefix: string; files: number; definition: KindDef; document_id: string }>(
    `select i.id, i.key, i.title, i.state, k.prefix, i.files, k.definition, k.document_id from items i join item_kinds k on k.id = i.kind_id where ${where} order by i.updated_at asc, i.key limit ${limit}`,
    params,
  );
  const cards: QueueCard[] = [];
  for (const r of rows) {
    const read: string[] = [`${r.key} (its card and body)`];
    const page = r.definition.states.find((s) => s.id === r.state)?.page;
    if (page) {
      const doc = await maybe<{ ws: string; slug: string; attachments: { path: string; size: number }[]; version: string }>(ctx.db, 'select w.slug as ws, d.slug, v.attachments, v.id as version from documents d join workspaces w on w.id = d.workspace_id join versions v on v.id = d.head_version_id where d.id = $1', [r.document_id]);
      const a = doc?.attachments.find((x) => x.path === page);
      if (doc && a) read.push(`${doc.ws}/${doc.slug}/${page} (how to work in ${r.state}, ${a.size} bytes, version ${doc.version})`);
    }
    if (r.files) read.push(`${r.key}#files (${r.files})`);
    const last = await maybe<{ data: { run: { handoff?: string } } }>(ctx.db, "select data from item_events where item_id = $1 and type = 'ran' order by position desc limit 1", [r.id]);
    cards.push({ key: r.key, title: r.title, state: r.state, kind: r.prefix, read, ...(last?.data.run.handoff ? { handoff: last.data.run.handoff } : {}) });
  }
  return { cards, total };
}

/** A queue answer as an agent reads it: one card a few lines long, and the call that takes one. */
export function queueText(q: { cards: readonly QueueCard[]; total: number }): string {
  if (!q.cards.length) return 'nothing to pick up: every item you may take is done, waiting for a person, or claimed';
  const lines = [`${q.total} item${q.total === 1 ? '' : 's'} you may pick up, oldest first:`];
  for (const c of q.cards) {
    lines.push('', `${c.key}  ${c.state}  ${c.title}`, `  read first: ${c.read.join('; ')}`);
    if (c.handoff) lines.push(`  last handoff: ${c.handoff}`);
  }
  lines.push('', 'take one: vantage_item {"actions":[{"item":"<key>","claim":true}]}');
  return lines.join('\n');
}
