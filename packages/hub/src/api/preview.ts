/**
 * Draws YAML that is not saved anywhere, for the new diagram page: one
 * view as SVG, the views it could show instead, and what the checker said.
 * Nothing is stored. Also answers the authoring guide, for a writer that
 * reaches the hub over HTTP rather than MCP. Any signed in reader may call it; the text is capped
 * so a paste cannot keep the layout engine busy for long.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { body, principal } from './common.ts';
import { authoringGuide } from '@vantage/server';

/** Bigger than any example in the repository, small enough to lay out in well under a second. */
export const MAX_PREVIEW_CHARS = 200_000;

const PreviewBody = z.object({
  yaml: z.string().max(MAX_PREVIEW_CHARS),
  view: z.string().max(200).optional(),
  theme: z.enum(['light', 'dark']).optional(),
});

export function previewRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  reg.add({ method: 'post', path: '/preview', summary: 'Draw one view of unsaved YAML as SVG, with the checker diagnostics; nothing is stored', tag: 'documents', body: { yaml: 'the .vantage.yaml text', view: 'optional view id; defaults to the first view', theme: 'light or dark' }, auth: 'user' });
  app.post('/preview', async (c) => {
    const p = principal(c);
    const input = await body(c, PreviewBody);
    const started = performance.now();
    const out = await ctx.render.run('preview', { yaml: input.yaml, view: input.view, theme: input.theme ?? 'light' });
    ctx.log.debug('preview.render', { userId: p.userId, chars: input.yaml.length, ms: Math.round(performance.now() - started), ok: out.svg !== null });
    return c.json(out);
  });
  reg.add({ method: 'get', path: '/guide', summary: 'The authoring guide as Markdown: the diagram language and the page syntax as this hub reads them, the same text agents read by topic at the address guide', tag: 'documents' });
  app.get('/guide', (c) => {
    principal(c);
    return c.text(authoringGuide(), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'private, max-age=300' });
  });
  return app;
}
