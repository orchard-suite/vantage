#!/usr/bin/env bun
/**
 * Many clients against a running hub at once: readers loading bundles the
 * way a browser does (keeping the ETag), live event streams held open,
 * MCP clients reading and rendering, authors saving to one shared document,
 * and several sources pushing fleets that bound documents draw. Prints
 * latency per kind of request, errors, and what the worker got through.
 *
 * Start a hub with AUTH_MODE=none first (the bench signs in as the local
 * developer and mints a token). Connectors push as their own OAuth client:
 * set CONNECTOR_ISSUER and CONNECTOR_AUDIENCE on the hub, register one app
 * for the bench with the connector role, and give its access token as
 * VANTAGE_CONNECTOR_TOKEN and its client id as VANTAGE_CONNECTOR_CLIENT.
 * Then:
 *
 *   bun scripts/bench/load.ts --url http://localhost:4848 [--seconds 60] [--sources 4]
 *     [--entities 10000] [--docs 40] [--readers 40] [--streams 100] [--mcp 8] [--authors 4] [--push-every 10]
 */
import { boundDocument, fleetBatch, fleetDocument, shapeFor } from './fleet.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const URL_BASE = opt('url', 'http://localhost:4848');
const SECONDS = Number(opt('seconds', '60'));
const SOURCES = Number(opt('sources', '4'));
const ENTITIES = Number(opt('entities', '10000'));
const DOCS = Number(opt('docs', '40'));
const READERS = Number(opt('readers', '40'));
const STREAMS = Number(opt('streams', '100'));
const MCP = Number(opt('mcp', '8'));
const AUTHORS = Number(opt('authors', '4'));
// Bun's fetch holds at most BUN_CONFIG_MAX_HTTP_REQUESTS requests open (256 by default) and
// queues the rest, so a run with more clients than that measures the queue, not the hub.
const CLIENT_LIMIT = Number(process.env['BUN_CONFIG_MAX_HTTP_REQUESTS'] ?? '256');
if (READERS + STREAMS + MCP + AUTHORS + SOURCES > CLIENT_LIMIT) {
  console.error(`${READERS + STREAMS + MCP + AUTHORS + SOURCES} clients need more than ${CLIENT_LIMIT} open requests; set BUN_CONFIG_MAX_HTTP_REQUESTS higher`);
  process.exit(2);
}
const PUSH_EVERY = Number(opt('push-every', '10'));
const RUN = opt('run', Date.now().toString(36));
const CONNECTOR_TOKEN = process.env['VANTAGE_CONNECTOR_TOKEN'] ?? '';
const CONNECTOR_CLIENT = process.env['VANTAGE_CONNECTOR_CLIENT'] ?? '';

const samples = new Map<string, number[]>();
const errors = new Map<string, Map<string, number>>();
const record = (kind: string, ms: number): void => void (samples.get(kind) ?? samples.set(kind, []).get(kind)!).push(ms);
const fail = (kind: string, why: string): void => {
  const m = errors.get(kind) ?? errors.set(kind, new Map()).get(kind)!;
  m.set(why, (m.get(why) ?? 0) + 1);
};

let token = '';
const auth = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

async function call(kind: string, path: string, init: RequestInit = {}, ok: (s: number) => boolean = (s) => s < 400): Promise<Response | undefined> {
  const started = performance.now();
  try {
    const res = await fetch(`${URL_BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...auth(), ...(init.headers as Record<string, string> | undefined) } });
    const body = await res.arrayBuffer();
    record(kind, performance.now() - started);
    if (!ok(res.status)) fail(kind, `${res.status} ${new TextDecoder().decode(body).slice(0, 80)}`);
    return new Response(body, { status: res.status, headers: res.headers });
  } catch (err) {
    record(kind, performance.now() - started);
    fail(kind, (err as Error).message.slice(0, 80));
    return undefined;
  }
}

const json = async <T>(res: Response | undefined): Promise<T> => (res ? ((await res.json()) as T) : ({} as T));
// The run's clock starts once setup is done, however long setup takes.
let until = Number.POSITIVE_INFINITY;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function setup(): Promise<{ ws: string; docs: string[]; shared: string; sourceTokens: { slug: string; id: string }[] }> {
  const minted = await json<{ token: string }>(await call('setup', '/api/v1/tokens', { method: 'POST', body: JSON.stringify({ name: `load ${RUN}` }) }));
  token = minted.token;
  if (!token) throw new Error('could not mint a token; is the hub in AUTH_MODE=none?');
  const ws = await json<{ slug: string }>(await call('setup', '/api/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: `Load ${RUN}` }) }));
  const sourceTokens: { slug: string; id: string }[] = [];
  const shape = shapeFor(ENTITIES);
  for (let s = 0; s < SOURCES; s++) {
    const slug = `fleet-${RUN}-${s}`;
    const src = await json<{ id: string }>(await call('setup', `/api/v1/workspaces/${ws.slug}/connectors`, { method: 'POST', body: JSON.stringify({ name: slug, slug, connector: 'push', clientId: CONNECTOR_CLIENT }) }));
    sourceTokens.push({ slug, id: src.id });
    await call('setup', `/api/v1/connector/${src.id}/batches`, { method: 'POST', headers: { authorization: `Bearer ${CONNECTOR_TOKEN}` }, body: JSON.stringify(fleetBatch(slug, shape, 0)) });
  }
  const docs: string[] = [];
  for (let i = 0; i < DOCS; i++) {
    const slug = sourceTokens[i % SOURCES]!.slug;
    const yaml = i < SOURCES ? fleetDocument(slug, `Fleet ${i}`) : boundDocument(slug, i);
    const r = await json<{ document: { slug: string } }>(await call('setup', `/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', body: JSON.stringify({ yaml, name: `Doc ${i}` }) }));
    docs.push(r.document.slug);
  }
  const shared = await json<{ document: { slug: string } }>(await call('setup', `/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', body: JSON.stringify({ yaml: boundDocument(sourceTokens[0]!.slug, 9999), name: 'Shared' }) }));
  return { ws: ws.slug, docs, shared: shared.document.slug, sourceTokens };
}

async function reader(ws: string, docs: readonly string[]): Promise<void> {
  const etags = new Map<string, string>();
  while (Date.now() < until) {
    const doc = docs[Math.floor(Math.random() * docs.length)]!;
    const etag = etags.get(doc);
    const res = await call('bundle', `/w/${ws}/${doc}/api/bundle`, { headers: etag ? { 'if-none-match': etag } : {} }, (s) => s === 200 || s === 304);
    if (res?.status === 200) {
      const e = res.headers.get('etag');
      if (e) etags.set(doc, e);
      await res.arrayBuffer();
    }
    await sleep(200 + Math.random() * 300);
  }
}

async function stream(ws: string, doc: string, events: { n: number }): Promise<void> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), until - Date.now());
  try {
    const res = await fetch(`${URL_BASE}/w/${ws}/${doc}/api/events`, { headers: auth(), signal: controller.signal });
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      events.n += (new TextDecoder().decode(value).match(/^data:/gm) ?? []).length;
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') fail('stream', (err as Error).message.slice(0, 80));
  }
}

async function mcp(ws: string, docs: readonly string[]): Promise<void> {
  let id = 1;
  const rpc = (name: string, args: Record<string, unknown>) =>
    call(`mcp ${name}`, '/mcp', { method: 'POST', headers: { accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }) });
  while (Date.now() < until) {
    const doc = docs[Math.floor(Math.random() * docs.length)]!;
    await rpc('vantage_outline', { address: `${ws}/${doc}` });
    await rpc('vantage_render', { address: `${ws}/${doc}`, format: 'png' });
    await sleep(500);
  }
}

async function author(ws: string, doc: string, n: number, outcomes: Record<string, number>): Promise<void> {
  while (Date.now() < until) {
    const head = await json<{ headVersion?: { id: string } }>(await call('read', `/api/v1/workspaces/${ws}/documents/${doc}`));
    const v = head.headVersion;
    const text = v ? await (await call('read', `/api/v1/workspaces/${ws}/documents/${doc}/versions/${v.id}?format=yaml`))?.text() : undefined;
    if (v && text) {
      // Each author keeps one comment line of its own, so concurrent saves touch different lines and merge.
      const mine = new RegExp(`^# author ${n} .*$`, 'm');
      const line = `# author ${n} ${Date.now()}`;
      const yaml = mine.test(text) ? text.replace(mine, line) : `${line}\n${text}`;
      const res = await call('save', `/api/v1/workspaces/${ws}/documents/${doc}`, { method: 'PUT', body: JSON.stringify({ yaml, expectedVersion: v.id }) }, (s) => s === 200 || s === 409);
      const r = await json<{ status?: string; merged?: boolean }>(res);
      const key = r.merged ? 'merged' : (r.status ?? 'error');
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
    await sleep(1000 + Math.random() * 1000);
  }
}

async function pusher(sourceTokens: readonly { slug: string; id: string }[]): Promise<number> {
  const shape = shapeFor(ENTITIES);
  let tick = 1;
  while (Date.now() < until) {
    await Promise.all(sourceTokens.map((s) => call('push', `/api/v1/connector/${s.id}/batches`, { method: 'POST', headers: { authorization: `Bearer ${CONNECTOR_TOKEN}` }, body: JSON.stringify(fleetBatch(s.slug, shape, tick)) }, (st) => st === 202)));
    tick++;
    await sleep(Math.max(0, Math.min(PUSH_EVERY * 1000, until - Date.now())));
  }
  return tick - 1;
}

async function prober(): Promise<void> {
  while (Date.now() < until) {
    await call('healthz', '/healthz');
    await call('readyz', '/readyz');
    await sleep(1000);
  }
}

const pct = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

const t0 = Date.now();
const env = await setup();
until = Date.now() + SECONDS * 1000;
console.log(`setup: ${env.docs.length + 1} documents over ${SOURCES} sources of ${ENTITIES} entities in ${((Date.now() - t0) / 1000).toFixed(1)} s; running ${SECONDS} s`);
const events = { n: 0 };
const outcomes: Record<string, number> = {};
// Clients arrive over two seconds, as people do; a burst of hundreds of connects in one instant
// overruns a small accept backlog (128 on macOS) and measures the operating system, not the hub.
const ramp = <T>(i: number, n: number, start: () => Promise<T>): Promise<T> => sleep((2000 * i) / Math.max(1, n)).then(start);
const work: Promise<unknown>[] = [prober(), pusher(env.sourceTokens)];
for (let i = 0; i < READERS; i++) work.push(ramp(i, READERS, () => reader(env.ws, env.docs)));
for (let i = 0; i < STREAMS; i++) work.push(ramp(i, STREAMS, () => stream(env.ws, env.docs[i % env.docs.length]!, events)));
for (let i = 0; i < MCP; i++) work.push(ramp(i, MCP, () => mcp(env.ws, env.docs)));
for (let i = 0; i < AUTHORS; i++) work.push(ramp(i, AUTHORS, () => author(env.ws, env.shared, i, outcomes)));
const results = await Promise.all(work);

console.log(`\n${'request'.padEnd(20)} ${'n'.padStart(6)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'p99'.padStart(8)} ${'max'.padStart(8)}  errors`);
for (const [kind, xs] of [...samples].sort()) {
  if (kind === 'setup') continue;
  xs.sort((a, b) => a - b);
  const errs = [...(errors.get(kind) ?? [])].map(([w, n]) => `${n}x ${w}`).join('; ');
  console.log(`${kind.padEnd(20)} ${String(xs.length).padStart(6)} ${pct(xs, 50).toFixed(0).padStart(8)} ${pct(xs, 95).toFixed(0).padStart(8)} ${pct(xs, 99).toFixed(0).padStart(8)} ${pct(xs, 100).toFixed(0).padStart(8)}  ${errs}`);
}
for (const [kind, m] of errors) if (!samples.has(kind)) console.log(`${kind.padEnd(20)} errors: ${[...m].map(([w, n]) => `${n}x ${w}`).join('; ')}`);
console.log(`\npushes per source: ${String(results[1])}; live events received: ${events.n}; shared saves: ${JSON.stringify(outcomes)}`);
