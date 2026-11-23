/**
 * Readers' browser telemetry: the script the hub pages load, and the relay
 * its batches post to. The relay makes each batch the hub's own (the app
 * is always the hub's web client, the user is the signed-in one by id or
 * none), caps its size, and hands it to the Faro collector with the key.
 * Telemetry never fails a page: without a collector, or when it refuses,
 * the batch is accepted and dropped, and every batch is counted by outcome.
 */
import { Hono } from 'hono';
import { telemetryScript } from '@vantage/render';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';

/** The name every batch carries, whatever the browser says. A collector labels them by it. */
export const WEB_APP_NAME = 'vantage-web';
/** A batch is a few events and spans; anything near this is a bug or abuse. */
export const MAX_BATCH_BYTES = 256 * 1024;
const RELAY_TIMEOUT_MS = 5_000;

export type Batch = Record<string, unknown> & { meta?: Record<string, unknown> };

/** One batch as the hub's own, or null when the body is not a JSON object. */
export function ownBatch(body: string, userId: string | undefined): Batch | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const batch = parsed as Batch;
  const meta = isRecord(batch.meta) ? batch.meta : {};
  const app = isRecord(meta['app']) ? meta['app'] : {};
  const { user: _claimed, ...rest } = meta;
  batch.meta = { ...rest, app: { ...app, name: WEB_APP_NAME }, ...(userId ? { user: { id: userId } } : {}) };
  return batch;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The request body as text, or null once it passes `limit` bytes. */
async function readCapped(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? '0') > limit) return null;
  if (!req.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function browserTelemetryRoutes(ctx: AppContext): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const { FARO_URL: url, FARO_API_KEY: key } = ctx.config;
  const target = url && key ? { url, key } : undefined;

  app.get('/telemetry.js', (c) => c.body(telemetryScript(), 200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }));

  app.post('/api/telemetry', async (c) => {
    const body = await readCapped(c.req.raw, MAX_BATCH_BYTES);
    const batch = body === null ? null : ownBatch(body, c.get('principal')?.userId);
    let outcome: 'too_large' | 'invalid' | 'dropped' | 'relayed' | 'failed';
    if (body === null) outcome = 'too_large';
    else if (!batch) outcome = 'invalid';
    else if (!target) outcome = 'dropped';
    else outcome = (await relay(ctx, target, batch)) ? 'relayed' : 'failed';
    ctx.metrics.browserBatches.add(1, { outcome });
    if (outcome === 'too_large') return c.json({ error: 'batch too large' }, 413);
    if (outcome === 'invalid') return c.json({ error: 'not a telemetry batch' }, 400);
    return c.body(null, 202);
  });
  return app;
}

async function relay(ctx: AppContext, target: { url: string; key: string }, batch: Batch): Promise<boolean> {
  try {
    const res = await ctx.fetch(target.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': target.key }, body: JSON.stringify(batch), signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    await res.body?.cancel();
    if (res.ok) return true;
    ctx.log.warn('browser.telemetry.refused', { status: res.status });
  } catch (err) {
    ctx.log.warn('browser.telemetry.failed', { error: (err as Error).message });
  }
  return false;
}
