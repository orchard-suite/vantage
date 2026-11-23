/** The HTTP API and live viewer. */
import { Hono } from 'hono';
import { watch, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildBundle, engineScript, liveHtml, viewerScript } from '@vantage/render';
import { formatDiagnostic } from '@vantage/model';
import { defaultIcons, resourcesFor, explore, exportDocument, load, render, schema, searchIcons, validate, type DocumentFormat, type Format, type Theme, type TitleBlock, type PageSize, type Orientation } from './core.ts';
import { authoringGuide } from './guide.ts';

export interface ServerOptions {
  /** Default file opened at `/`. */
  readonly file?: string;
}

export function createApp(opts: ServerOptions = {}): Hono {
  const app = new Hono();
  const fileOf = (q: string | undefined): string | undefined => (q ? resolve(q) : opts.file ? resolve(opts.file) : undefined);

  app.get('/', (c) => c.html(liveHtml()));
  app.get('/viewer.js', (c) => c.body(viewerScript(), 200, { 'content-type': 'text/javascript' }));
  app.get('/engine.js', (c) => c.body(engineScript(), 200, { 'content-type': 'text/javascript' }));

  app.get('/api/bundle', (c) => {
    const file = fileOf(c.req.query('file'));
    if (!file) return c.json({ error: 'no file' }, 400);
    const { model, diagnostics } = load({ file });
    const theme = (c.req.query('theme') as Theme | undefined) ?? undefined;
    if (!model) return c.json({ title: file, theme: theme ?? 'light', views: [], diagnostics, live: true });
    return c.json(buildBundle(model, { ...(theme ? { theme } : {}), ...resourcesFor(model), live: true, diagnostics }));
  });

  app.get('/api/events', (c) => {
    const file = fileOf(c.req.query('file'));
    if (!file || !existsSync(file)) return c.text('no file', 400);
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(': connected\n\n'));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const watcher = watch(dirname(file), { recursive: true }, (_e, name) => {
          if (name && !String(name).match(/\.(ya?ml|vantage)$/)) return;
          clearTimeout(timer);
          timer = setTimeout(() => controller.enqueue(enc.encode(`data: ${JSON.stringify({ file })}\n\n`)), 120);
        });
        const ping = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 25000);
        c.req.raw.signal.addEventListener('abort', () => {
          watcher.close();
          clearInterval(ping);
          controller.close();
        });
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  });

  app.post('/api/validate', async (c) => {
    const body = (await c.req.json()) as { text?: string; file?: string };
    const v = validate(body);
    return c.json({ ...v, formatted: v.diagnostics.map(formatDiagnostic) });
  });

  app.post('/api/render', async (c) => {
    const body = (await c.req.json()) as { text?: string; file?: string; view?: string; format?: Format; theme?: Theme; scale?: number; titleBlock?: TitleBlock; transparent?: boolean; embedFonts?: boolean };
    const { result, diagnostics } = render(body);
    if (!result) return c.json({ diagnostics }, 422);
    const metricsHeader = { 'x-vantage-metrics': JSON.stringify(result.layout.metrics) };
    if (body.format === 'png') return c.body(new Blob([result.png!]), 200, { 'content-type': 'image/png', ...metricsHeader });
    if (body.format === 'html') return c.html(result.html!);
    if (body.format === 'json') return c.json({ viewId: result.viewId, layout: result.layout, diagnostics });
    return c.body(result.svg, 200, { 'content-type': 'image/svg+xml', ...metricsHeader });
  });

  app.post('/api/export', async (c) => {
    const body = (await c.req.json()) as { text?: string; file?: string; format?: DocumentFormat; views?: string[]; theme?: Theme; titleBlock?: TitleBlock | true; page?: PageSize; orientation?: Orientation };
    const { result, diagnostics } = await exportDocument({ ...body, format: body.format ?? 'pdf' });
    if (!result) return c.json({ diagnostics }, 422);
    return c.body(new Blob([result.bytes]), 200, { 'content-type': result.contentType, 'x-vantage-views': result.viewIds.join(',') });
  });

  app.post('/api/explore', async (c) => {
    const body = (await c.req.json()) as { text?: string; file?: string; view?: string; theme?: Theme; limit?: number; format?: 'png' | 'json' };
    const { result, diagnostics } = explore(body);
    if (!result) return c.json({ diagnostics }, 422);
    if (body.format === 'json') return c.json({ viewId: result.viewId, candidates: result.candidates, diagnostics });
    return c.body(new Blob([result.png]), 200, { 'content-type': 'image/png', 'x-vantage-candidates': JSON.stringify(result.candidates.map((x) => ({ name: x.name, score: x.score }))) });
  });

  app.get('/api/schema', (c) => c.json(schema()));
  app.get('/api/guide', (c) => c.text(authoringGuide()));
  app.get('/api/icons', (c) => c.json({ icons: searchIcons(c.req.query('q') ?? '', c.req.query('pack') ?? undefined, Number(c.req.query('limit') ?? 60)) }));
  app.get('/api/icons/:pack/:name', (c) => {
    const svg = defaultIcons().get(`${c.req.param('pack')}/${c.req.param('name')}`);
    return svg ? c.body(svg, 200, { 'content-type': 'image/svg+xml' }) : c.text('not found', 404);
  });
  return app;
}
