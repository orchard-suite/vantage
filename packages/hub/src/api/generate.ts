/**
 * Drawing a new diagram from words: whether this hub can, the models on
 * offer and what the caller has left to spend, a request that queues a
 * generation for a workspace the caller edits, and its progress. Spend
 * counts against the same limits as revisions. The draft is the caller's
 * alone until they create a diagram from it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal } from './common.ts';
import { requireWorkspace } from '../authz.ts';
import { enqueue } from '../worker/jobs.ts';
import { badRequest, HttpError, notFound } from '../http.ts';
import { createGeneration, publicGeneration, revisionById } from '../revise/repo.ts';
import { allowance, refusal } from '../revise/limits.ts';
import { NOTES_MARK } from '../revise/generate.ts';

/** Room for a paragraph or a page of description. */
export const MAX_DESCRIPTION_CHARS = 8_000;
/** Room for pasted notes: an inventory, a README, a meeting's minutes. */
export const MAX_NOTES_CHARS = 60_000;

const GenerateBody = z.object({
  workspace: z.string().min(1).max(200),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
  notes: z.string().max(MAX_NOTES_CHARS).optional(),
  model: z.string().min(1).optional(),
});

export function generateRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();

  reg.add({ method: 'get', path: '/generate', summary: 'Whether this hub draws diagrams from a description, the models on offer, and what the caller has spent against each limit', tag: 'generate', auth: 'user' });
  app.get('/generate', async (c) => {
    const p = principal(c);
    if (!ctx.ai) return c.json({ enabled: false });
    const [models, allowed] = await Promise.all([ctx.ai.models(), allowance(ctx.db, ctx.config, p.orgId, p.userId)]);
    return c.json({ enabled: true, models, defaultModel: ctx.ai.defaultModel, allowance: allowed });
  });

  reg.add({ method: 'post', path: '/generations', summary: "Ask the organization's model to draw a new diagram from a description; queues the generation and answers it. Nothing is saved: the draft opens in the editor", tag: 'generate', body: { workspace: 'slug of a workspace the caller edits', description: 'the system in words', notes: 'optional pasted notes: facts to use', model: 'optional model id; the default otherwise' }, auth: 'author', responses: { '202': 'queued', '403': 'an admin turned model use off for the caller', '409': 'the caller already has one being drawn', '429': "over the caller's daily or monthly limit, or the organization's monthly limit" } });
  app.post('/generations', async (c) => {
    const p = principal(c);
    if (!ctx.ai) throw new HttpError(404, 'this hub has no model API configured');
    const input = await body(c, GenerateBody);
    const ws = await requireWorkspace(ctx.db, p, input.workspace, 'author');
    const model = input.model ?? ctx.ai.defaultModel;
    if (!(await ctx.ai.models()).includes(model)) throw badRequest(`model ${model} is not offered on this hub`);
    const allowed = await allowance(ctx.db, ctx.config, p.orgId, p.userId);
    const refused = refusal(allowed);
    if (refused) {
      ctx.log.info('generate.refused', { by: p.userId, status: refused.status, reason: refused.message, today: allowed.today, month: allowed.month, orgMonth: allowed.orgMonth });
      throw refused;
    }
    const notes = input.notes?.trim();
    const row = await createGeneration(ctx.db, { orgId: p.orgId, workspaceId: ws.id, requestedBy: p.userId, prompt: notes ? `${input.description}${NOTES_MARK}${notes}` : input.description, model });
    await enqueue(ctx.db, { orgId: p.orgId, kind: 'generate', payload: { generationId: row.id } });
    ctx.log.info('generate.requested', { generationId: row.id, workspaceId: ws.id, model, chars: input.description.length, notes: notes?.length ?? 0, by: p.userId, today: allowed.today, month: allowed.month, orgMonth: allowed.orgMonth });
    return c.json(publicGeneration(row), 202);
  });

  reg.add({ method: 'get', path: '/generations/:id', summary: 'A generation the caller asked for: its state, the draft YAML when ready, the summary, and its tokens', tag: 'generate', params: ['id'], auth: 'user' });
  app.get('/generations/:id', async (c) => {
    const p = principal(c);
    const row = await revisionById(ctx.db, c.req.param('id'));
    if (!row || row.kind !== 'generate' || row.requested_by !== p.userId) throw notFound('generation');
    return c.json(publicGeneration(row));
  });

  return app;
}
