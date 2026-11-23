/**
 * vantage_item: the actions on tracked items, many in one call. Each
 * action commits alone through the tracking verbs every door calls, with a
 * key the door makes when the caller brings none, and answers one line.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ITEM, QUEUE, ROADMAP_IMPORT } from '@vantage/mcp';
import { importRoadmap } from '../tracking/import.ts';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { randomId } from '../crypto.ts';
import { badRequest } from '../http.ts';
import { ask, attach, claim, finish, hold, link, move, note, release, renew, type WriteAnswer } from '../tracking/write.ts';
import { queue, queueText } from '../tracking/queue.ts';
import { guardFor, refusalText, text } from './run.ts';

interface Action {
  readonly item: string;
  readonly move?: string | undefined;
  readonly note?: string | undefined;
  readonly revision?: string | undefined;
  readonly hold?: string | undefined;
  readonly release?: string | undefined;
  readonly link?: { rel: string; target: string } | undefined;
  readonly unlink?: { rel: string; target: string } | undefined;
  readonly attach?: { name: string; data: string; contentType?: string | undefined } | undefined;
  readonly claim?: boolean | number | undefined;
  readonly renew?: boolean | undefined;
  readonly finish?: { move?: string | undefined; summary: string; proof?: string[] | undefined; handoff?: string | undefined; seconds?: number | undefined; cost?: { amount: number; currency: string; tokens?: number | undefined } | undefined } | undefined;
  readonly ask?: string | undefined;
  readonly key?: string | undefined;
}

/** Runs one action: exactly one of move, hold, release, link, unlink, attach, or a note alone. */
export async function runAction(ctx: AppContext, p: Principal, a: Action): Promise<WriteAnswer> {
  const key = a.key ?? randomId();
  const verbs = (['move', 'hold', 'release', 'link', 'unlink', 'attach', 'claim', 'renew', 'finish', 'ask'] as const).filter((v) => a[v] !== undefined && a[v] !== false);
  if (verbs.length > 1) throw badRequest(`one action does one thing; ${verbs.join(' and ')} go in separate actions`);
  if (a.revision !== undefined && !a.move) throw badRequest('revision goes with a move; to set it alone, the owner puts the item');
  switch (verbs[0]) {
    case 'move':
      return move(ctx, p, a.item, { to: a.move!, note: a.note, revision: a.revision }, key);
    case 'hold':
      return hold(ctx, p, a.item, a.hold, key);
    case 'release':
      return release(ctx, p, a.item, a.release, key);
    case 'link':
      return link(ctx, p, a.item, a.link!, key);
    case 'unlink':
      return link(ctx, p, a.item, { ...a.unlink!, remove: true }, key);
    case 'claim':
      return claim(ctx, p, a.item, typeof a.claim === 'number' ? a.claim : undefined, key);
    case 'renew':
      return renew(ctx, p, a.item, key);
    case 'finish': {
      const f = a.finish!;
      const cost = f.cost ? { amount: f.cost.amount, currency: f.cost.currency, ...(f.cost.tokens !== undefined ? { tokens: f.cost.tokens } : {}) } : undefined;
      return finish(ctx, p, a.item, { move: f.move, run: { summary: f.summary, proof: f.proof ?? [], ...(f.handoff !== undefined ? { handoff: f.handoff } : {}), ...(f.seconds !== undefined ? { seconds: f.seconds } : {}), ...(cost ? { cost } : {}) } }, key);
    }
    case 'ask':
      return ask(ctx, p, a.item, a.ask!, key);
    case 'attach': {
      const bytes = Uint8Array.from(Buffer.from(a.attach!.data, 'base64'));
      return attach(ctx, p, a.item, { name: a.attach!.name, contentType: a.attach!.contentType ?? 'application/octet-stream', bytes }, key);
    }
  }
  if (a.note === undefined) throw badRequest('an action names what to do: move, hold, release, note, attach, link, or unlink');
  return note(ctx, p, a.item, a.note, key);
}

export function registerItemTools(server: McpServer, ctx: AppContext, p: Principal): void {
  const guarded = guardFor(ctx.log.child({ surface: 'mcp', userId: p.userId }));
  server.registerTool(
    ITEM.name,
    { description: ITEM.description, inputSchema: ITEM.shape },
    guarded<{ actions: Action[] }>(ITEM.name, async ({ actions }) => {
      const lines: string[] = [];
      let failed = 0;
      for (const a of actions) {
        try {
          lines.push((await runAction(ctx, p, a)).line);
        } catch (err) {
          failed += 1;
          lines.push(`${a.item}: ${refusalText(err)}`);
        }
      }
      return text(lines.join('\n'), failed === actions.length);
    }),
  );
  server.registerTool(
    QUEUE.name,
    { description: QUEUE.description, inputSchema: QUEUE.shape },
    guarded<{ kinds?: string[] | undefined; limit?: number | undefined }>(QUEUE.name, async ({ kinds, limit }) => text(queueText(await queue(ctx, p, { ...(kinds ? { kinds } : {}), ...(limit ? { limit } : {}) })))),
  );
  server.registerTool(
    ROADMAP_IMPORT.name,
    { description: ROADMAP_IMPORT.description, inputSchema: ROADMAP_IMPORT.shape },
    guarded<{ kind: string; text: string; dryRun?: boolean | undefined }>(ROADMAP_IMPORT.name, async ({ kind, text: md, dryRun }) => text((await importRoadmap(ctx, p, kind, md, dryRun ?? false)).join('\n'))),
  );
}
