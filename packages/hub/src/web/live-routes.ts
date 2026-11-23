/**
 * The viewer's live routes: the event stream per document, which carries
 * saves and renders as plain messages and presence beats as `presence`
 * events, and the beat a viewer posts to say where it is. Both resolve the
 * document the way the bundle does, so a guest link works on them too.
 */
import { Hono, type Context } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import type { Live } from '../live.ts';
import { channelName } from '../db/db.ts';
import { resolveFile, type ResolvedDocument } from './resolve.ts';
import { createRateLimiter } from '../ratelimit.ts';
import { HttpError } from '../http.ts';
import { body } from '../api/common.ts';
import { BeatSchema, forReader, nameCache, PRESENCE_CHANNEL_PREFIX, publishBeat, stamp, type Reader, type Speaker } from '../presence.ts';
import { GUEST_LIMIT } from './pages.ts';

/** Beats per session per minute: a presenter sends at most five a second, with room for bursts. */
export const BEAT_LIMIT = { requests: 600, windowMs: 60_000 };
/** Beats per guest link or address per minute: a link shared with a room shares this. */
const GUEST_BEAT_LIMIT = { requests: 3_000, windowMs: 60_000 };
const PING_MS = 25_000;

export function liveRoutes(ctx: AppContext, live: Live, presence: Live): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const guestLimiter = createRateLimiter(GUEST_LIMIT.requests, GUEST_LIMIT.windowMs);
  const guestBeats = createRateLimiter(GUEST_BEAT_LIMIT.requests, GUEST_BEAT_LIMIT.windowMs);
  const sessions = createRateLimiter(BEAT_LIMIT.requests, BEAT_LIMIT.windowMs);
  const names = nameCache(ctx.db);

  const events = async (c: Context<HubEnv>, file: string | undefined): Promise<Response> => {
    const resolved = await resolveFile(ctx, c, file, guestLimiter, { recordGuestOpen: false });
    const { document } = resolved;
    const reader = readerOf(c, resolved);
    const enc = new TextEncoder();
    let unsubscribe: (() => Promise<void>) | undefined;
    let unpresence: (() => Promise<void>) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stop = (): void => {
      clearInterval(ping);
      // The database may already be closing (the pod stops); the listener goes with it.
      const quiet = (err: unknown): void => ctx.log.debug('live.unsubscribe.failed', { documentId: document.id, error: err });
      unsubscribe?.().catch(quiet);
      unpresence?.().catch(quiet);
      unsubscribe = unpresence = undefined;
    };
    const stream = new ReadableStream({
      async start(controller) {
        // The retry hint tells the client to come back in a second if the stream ends, which it does when this pod drains.
        controller.enqueue(enc.encode(': connected\n\nretry: 1000\n\n'));
        const end = (): void => {
          stop();
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        };
        const write = (text: string): void => {
          try {
            controller.enqueue(enc.encode(text));
          } catch {
            // the stream closed between the notify and this write
          }
        };
        unsubscribe = await live.subscribe(document.id, (payload) => write(`data: ${payload}\n\n`), end);
        unpresence = await presence.subscribe(document.id, (payload) => {
          const seen = forReader(payload, reader);
          if (seen) write(`event: presence\ndata: ${seen}\n\n`);
        });
        ping = setInterval(() => write(': ping\n\n'), PING_MS);
        c.req.raw.signal.addEventListener('abort', end);
      },
      cancel: stop,
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  };
  app.get('/api/events', (c) => events(c, c.req.query('file')));
  app.get('/w/:workspace/:doc/api/events', (c) => events(c, `${c.req.param('workspace')}/${c.req.param('doc')}`));

  const beat = async (c: Context<HubEnv>, file: string | undefined): Promise<Response> => {
    const resolved = await resolveFile(ctx, c, file, guestBeats, { recordGuestOpen: false });
    const input = await body(c, BeatSchema);
    const kind = resolved.guest ? 'guest' : 'member';
    const fields = { documentId: resolved.document.id, session: input.session, reader: kind, ...(resolved.guest ? { guestLink: resolved.guest.id } : { userId: c.get('principal')?.userId ?? null }) };
    if (!sessions.allow(input.session)) {
      ctx.metrics.presenceBeats.add(1, { outcome: 'limited' });
      ctx.log.warn('presence.limited', fields);
      throw new HttpError(429, 'too many presence beats');
    }
    const who = await speaker(c, resolved, names);
    const bytes = await publishBeat(ctx.db, channelName(PRESENCE_CHANNEL_PREFIX, resolved.document.id), stamp(input, who));
    if (bytes < 0) {
      ctx.metrics.presenceBeats.add(1, { outcome: 'too_large' });
      ctx.log.warn('presence.too_large', fields);
      throw new HttpError(413, 'presence beat too large');
    }
    ctx.metrics.presenceBeats.add(1, { outcome: 'sent' });
    if (input.event === 'beat') ctx.log.debug('presence.beat', { ...fields, view: input.view ?? null, bytes });
    else {
      ctx.metrics.presence.add(1, { event: input.event, reader: kind });
      ctx.log.info(`presence.${input.event}`, { ...fields, view: input.view ?? null, ...(input.following ? { leader: input.following } : {}), presenting: input.presenting ?? false });
    }
    return c.body(null, 204);
  };
  app.post('/api/presence', (c) => beat(c, c.req.query('file')));
  app.post('/w/:workspace/:doc/api/presence', (c) => beat(c, `${c.req.param('workspace')}/${c.req.param('doc')}`));

  return app;
}

function readerOf(c: Context<HubEnv>, resolved: ResolvedDocument): Reader {
  if (resolved.guest) return { userId: null, guest: true, onlyView: resolved.onlyView };
  return { userId: c.get('principal')?.userId ?? null, guest: false };
}

async function speaker(c: Context<HubEnv>, resolved: ResolvedDocument, names: ReturnType<typeof nameCache>): Promise<Speaker> {
  const p = c.get('principal');
  if (resolved.guest || !p) return { userId: null, name: 'Guest', named: true, guest: true };
  const { name, named } = await names(p.userId, p.subject);
  return { userId: p.userId, name, named, guest: false };
}
