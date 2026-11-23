#!/usr/bin/env bun
/**
 * Saves and reads at once on one large document. Readers fetch the viewer
 * bundle over and over the way a browser does, keeping the ETag; agents
 * each make a run of small saves back to back (one fact on a node of their
 * own), each naming the version it started from. For every save it
 * measures the time from the save's response to the first bundle served
 * drawn at that version or a later one: a burst of saves is drawn once, so
 * a later version's picture shows the earlier save too. A bundle marked
 * `drawing` counts: it is the newest drawn picture, the reader sees it, and
 * only a still newer save is missing from it. Only the X-Vantage-Reader
 * header is read, never the bundle body.
 *
 * Against a running hub in AUTH_MODE=none (or with VANTAGE_TOKEN set):
 *
 *   bun scripts/bench/load-saves.ts --url http://localhost:4848
 *
 * Or a hub it starts itself (migrate, web, and worker) in a fresh database
 * on a Postgres server, dropped at the end, from this checkout or from the
 * one --hub-root names:
 *
 *   bun scripts/bench/load-saves.ts --database-url postgres://localhost:5432/vantage
 *     [--hub-root dir] [--readers 50] [--agents 5] [--saves 10] [--views 160]
 *     [--max-p95 4] [--json out.json] [file.vantage.yaml]
 *
 * Exits 1 when a save is never shown, a request fails, or, when --max-p95
 * is given, the save-to-picture p95 passes that many seconds. --json writes
 * the run's samples for a comparison (load-compare.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { startHub, type BenchHub, type Histogram } from './hub-process.ts';
import { STRESS_BASE, stressDocument } from './stress.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const READERS = Number(opt('readers', '50'));
const AGENTS = Number(opt('agents', '5'));
const SAVES = Number(opt('saves', '10'));
const VIEWS = Number(opt('views', '160'));
const MAX_P95 = Number(opt('max-p95', 'Infinity'));
const SETTLE = Number(opt('settle', '60'));
const DATABASE_URL = opt('database-url', '');
const HUB_ROOT = opt('hub-root', '');
const JSON_OUT = opt('json', '');
const FILE = args.find((a) => a.endsWith('.yaml')) ?? STRESS_BASE;
const RUN = Date.now().toString(36);

interface Reader { version?: string; render?: string; drawing?: boolean; pending?: boolean }
interface Summary { id: string; parent: string | null }
interface Save { readonly version: string; readonly at: number }

const reads: number[] = [];
const saveTimes: number[] = [];
const statuses = new Map<string, number>();
const errors = new Map<string, number>();
const fail = (why: string): void => void errors.set(why, (errors.get(why) ?? 0) + 1);
const parents = new Map<string, string | null>();
const firstShown = new Map<string, number>();
const saves: Save[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let hub: BenchHub | undefined;
let base = opt('url', '');
if (!base) {
  if (!DATABASE_URL) {
    console.error('give --url of a running hub, or --database-url of a Postgres to start one on');
    process.exit(2);
  }
  hub = await startHub(DATABASE_URL, {}, HUB_ROOT || undefined);
  process.on('exit', () => hub?.kill());
  base = hub.url;
  console.log(`hub ${base}; logs in ${hub.logs}`);
}
let token = process.env['VANTAGE_TOKEN'] ?? '';
const headers = (extra: Record<string, string> = {}): Record<string, string> => ({ 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });
const api = async <T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> => {
  const res = await fetch(`${base}${path}`, { ...init, headers: headers(init.headers as Record<string, string> | undefined) });
  const text = await res.text();
  return { status: res.status, body: (text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as T };
};

/** The reader fields of a bundle response, or nothing when it carries none. */
function readerOf(res: Response): Reader | undefined {
  const h = res.headers.get('x-vantage-reader');
  return h ? (JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as Reader) : undefined;
}

// Setup: a token, a workspace, and the stress document.
if (!token) {
  const minted = await api<{ token?: string }>('/api/v1/tokens', { method: 'POST', body: JSON.stringify({ name: `load-saves ${RUN}` }) });
  token = minted.body.token ?? '';
  if (!token) throw new Error(`could not mint a token (${minted.status}); is the hub in AUTH_MODE=none? Otherwise set VANTAGE_TOKEN`);
}
// The run's id in the title keeps a running hub from reusing an earlier run's renders.
const yaml = stressDocument(readFileSync(FILE, 'utf8'), VIEWS).replace(/^title: (.*)$/m, `title: $1 ${RUN}`);
const ws = (await api<{ slug: string }>('/api/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: `Load saves ${RUN}` }) })).body.slug;
const created = await api<{ document: { slug: string }; version: Summary }>(`/api/v1/workspaces/${ws}/documents`, { method: 'POST', body: JSON.stringify({ yaml, name: 'Stress' }) });
if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
const doc = created.body.document.slug;
const first = created.body.version;
parents.set(first.id, first.parent);
const bundlePath = `/w/${ws}/${doc}/api/bundle`;

const t0 = performance.now();
for (;;) {
  const res = await fetch(`${base}${bundlePath}`, { headers: headers() });
  await res.arrayBuffer();
  const r = readerOf(res);
  if (r?.version === first.id && !r.drawing && !r.pending) break;
  if (performance.now() - t0 > SETTLE * 1000) throw new Error('the first picture never came');
  await sleep(100);
}
console.log(`${FILE}: ${VIEWS} views; first picture in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`${READERS} readers, ${AGENTS} agents x ${SAVES} saves\n`);

let stopped = false;

async function reader(): Promise<void> {
  let etag = '';
  while (!stopped) {
    const started = performance.now();
    try {
      const res = await fetch(`${base}${bundlePath}`, { headers: headers(etag ? { 'if-none-match': etag } : {}) });
      const arrived = performance.now();
      await res.arrayBuffer();
      reads.push(performance.now() - started);
      statuses.set(String(res.status), (statuses.get(String(res.status)) ?? 0) + 1);
      if (res.status === 200) {
        etag = res.headers.get('etag') ?? '';
        const r = readerOf(res);
        if (r?.version && !r.pending && !firstShown.has(r.version)) firstShown.set(r.version, arrived);
      } else if (res.status !== 304) fail(`read ${res.status}`);
    } catch (err) {
      fail(`read ${(err as Error).message.slice(0, 60)}`);
    }
    await sleep(200 + Math.random() * 300);
  }
}

/** The agent's fact on its own node, set to `n`: one line of the document changes. */
function edit(text: string, agent: number, n: number): string {
  const lines = text.split('\n');
  const facts = lines.flatMap((l, i) => (/^\s+facts: \[/.test(l) ? [i] : []));
  if (!facts.length) throw new Error('the document has no facts lines to edit');
  const i = facts[agent % facts.length]!;
  lines[i] = lines[i]!.replace(/^(\s+facts: \[)(?:"Load \d+: \d+", )?/, `$1"Load ${agent}: ${n}", `);
  return lines.join('\n');
}

async function agent(n: number): Promise<void> {
  let text = yaml;
  let expected = first.id;
  for (let i = 1; i <= SAVES; i++) {
    for (let attempt = 0; ; attempt++) {
      const started = performance.now();
      const res = await api<{ status: string; merged?: boolean; version?: Summary; head?: Summary }>(`/api/v1/workspaces/${ws}/documents/${doc}`, { method: 'PUT', body: JSON.stringify({ yaml: edit(text, n, i), expectedVersion: expected }) });
      const at = performance.now();
      saveTimes.push(at - started);
      const v = res.body.version;
      if (res.status === 200 && res.body.status === 'saved' && v) {
        parents.set(v.id, v.parent);
        saves.push({ version: v.id, at });
        expected = v.id;
        // A merged version holds other agents' edits; the next edit starts from it.
        text = res.body.merged ? (await api<string>(`/api/v1/workspaces/${ws}/documents/${doc}/versions/${v.id}?format=yaml`)).body : edit(text, n, i);
        break;
      }
      if (res.status === 409 && res.body.head && attempt < 5) {
        fail('save conflict, retried');
        expected = res.body.head.id;
        text = (await api<string>(`/api/v1/workspaces/${ws}/documents/${doc}/versions/${expected}?format=yaml`)).body;
        continue;
      }
      fail(`save ${res.status} ${res.body.status ?? ''}`.trim());
      break;
    }
  }
}

/** Each saved version's place in the document's history, from the parent each save names. */
function order(): Map<string, number> {
  const child = new Map<string, string>();
  for (const [id, parent] of parents) if (parent) child.set(parent, id);
  const at = new Map<string, number>();
  for (let id: string | undefined = first.id, i = 0; id; id = child.get(id), i++) at.set(id, i);
  return at;
}

/** Seconds from each save's response to the first drawn bundle at its version or later; NaN while unshown. */
function toPicture(): number[] {
  const at = order();
  const shown = [...firstShown].flatMap(([v, t]) => (at.has(v) ? [{ i: at.get(v)!, t }] : []));
  return saves.map((s) => {
    const i = at.get(s.version);
    const ts = i === undefined ? [] : shown.filter((x) => x.i >= i).map((x) => x.t);
    return ts.length ? Math.max(0, Math.min(...ts) - s.at) / 1000 : NaN;
  });
}

const reading = Array.from({ length: READERS }, (_, i) => sleep((1000 * i) / Math.max(1, READERS)).then(reader));
const runStarted = performance.now();
await Promise.all(Array.from({ length: AGENTS }, (_, i) => agent(i)));
const savedIn = (performance.now() - runStarted) / 1000;
const settleUntil = performance.now() + SETTLE * 1000;
while (toPicture().some(Number.isNaN) && performance.now() < settleUntil) await sleep(100);
stopped = true;
await Promise.all(reading);
const hubHistograms = hub ? await hub.stop() : undefined;

const pct = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? NaN;
};
const row = (name: string, xs: readonly number[], unit: string, scale = 1): string =>
  `${name.padEnd(22)} ${String(xs.length).padStart(5)} ${[50, 95, 100].map((p) => `${(pct(xs, p) * scale).toFixed(unit === 's' ? 2 : 0)} ${unit}`.padStart(10)).join('')}`;

const pictures = toPicture();
const drawn = pictures.filter((x) => !Number.isNaN(x));
const unshown = pictures.length - drawn.length;
const p95 = pct(drawn, 95);
console.log(`${'measure'.padEnd(22)} ${'n'.padStart(5)} ${'p50'.padStart(10)}${'p95'.padStart(10)}${'max'.padStart(10)}`);
console.log(row('save to picture', drawn, 's'));
console.log(row('save request', saveTimes, 'ms'));
console.log(row('read', reads, 'ms'));
console.log(`\n${saves.length} saves in ${savedIn.toFixed(1)} s, ${firstShown.size - 1} versions seen drawn; reads ${JSON.stringify(Object.fromEntries(statuses))}`);
if (hubHistograms) printHub(hubHistograms.get('vantage.render.first_picture.duration'));
if (errors.size) console.log(`errors: ${[...errors].map(([w, n]) => `${n}x ${w}`).join('; ')}`);

const failures = [
  ...(p95 > MAX_P95 ? [`save-to-picture p95 ${p95.toFixed(2)} s is over ${MAX_P95} s`] : []),
  ...(unshown ? [`${unshown} saves were never shown drawn within ${SETTLE} s`] : []),
  ...([...errors.keys()].some((k) => !k.startsWith('save conflict')) ? ['requests failed'] : []),
];
for (const f of failures) console.error(`FAIL: ${f}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pictures: drawn, unshown, p95, firstPicture: hubHistograms?.get('vantage.render.first_picture.duration') ?? null, failures } satisfies LoadRun));
/** What one run measured, as --json writes it. */
export interface LoadRun {
  /** Seconds from each shown save to its first drawn picture. */
  readonly pictures: readonly number[];
  readonly unshown: number;
  readonly p95: number;
  readonly firstPicture: Histogram | null;
  readonly failures: readonly string[];
}
// The hub's metric counts the versions the worker drew, from the save to the stored picture.
function printHub(h: Histogram | undefined): void {
  if (!h || !h.count) return void console.log('hub first_picture: no samples exported');
  console.log(`hub first_picture: ${h.count} versions drawn, mean ${(h.sum / h.count).toFixed(2)} s, max ${h.max.toFixed(2)} s`);
}
process.exit(failures.length ? 1 : 0);
