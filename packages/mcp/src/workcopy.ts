/**
 * A working copy: things from the hub as files in a folder, with the
 * version each came from kept in one file beside them. The agent edits the
 * files with its own tools. Sync sends what changed and pulls what moved.
 * The hub decides every path and merges every write, so nothing here knows
 * a diagram from a record.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** The hub's text routes, as the working copy uses them. */
export interface TextApi {
  list(address: string): Promise<Listed[]>;
  read(address: string): Promise<{ address: string; version: string; text: string }>;
  file(address: string): Promise<Uint8Array>;
  write(body: { writes: { address: string; text: string; base?: string }[]; assets?: Record<string, string>; message?: string }): Promise<Result[]>;
}

export interface Listed {
  readonly address: string;
  readonly path: string;
  readonly version: string;
  readonly hash?: string;
  readonly binary?: true;
  readonly readonly?: true;
}

export interface Result {
  readonly address: string;
  readonly status: 'saved' | 'created' | 'unchanged' | 'conflict' | 'refused';
  readonly version?: string;
  readonly message: string;
  readonly preview?: string;
  readonly path?: string;
}

interface Entry {
  address: string;
  version: string;
  /** The sha256 of the file as it was last written or sent. */
  hash: string;
  binary?: true;
  readonly?: true;
}

interface Manifest {
  hub: string;
  roots: string[];
  files: Record<string, Entry>;
}

const MANIFEST = '.vantage.json';
const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const posix = (p: string): string => p.split(sep).join('/');

function load(dir: string, hub: string): Manifest {
  const path = join(dir, MANIFEST);
  if (!existsSync(path)) return { hub, roots: [], files: {} };
  const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  if (m.hub !== hub) throw new Error(`${dir} is a working copy of ${m.hub}; this machine is signed in to ${hub}`);
  return m;
}

function store(dir: string, m: Manifest): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
}

function put(dir: string, path: string, data: Uint8Array | string): string {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return sha(data);
}

/** The file's hash, or undefined when it is gone. */
function hashOf(dir: string, path: string): string | undefined {
  const full = join(dir, path);
  return existsSync(full) ? sha(readFileSync(full)) : undefined;
}

async function fetchInto(api: TextApi, dir: string, m: Manifest, t: Listed): Promise<void> {
  const data = t.binary || t.readonly ? await api.file(t.address) : (await api.read(t.address)).text;
  const hash = put(dir, t.path, data);
  m.files[t.path] = { address: t.address, version: t.version, hash, ...(t.binary ? { binary: true } : {}), ...(t.readonly ? { readonly: true } : {}) };
}

/** Brings the hub's side into the folder: new things, things that moved, things that are gone. A file edited here and not yet sent is left alone. */
async function pull(api: TextApi, dir: string, m: Manifest, skip: ReadonlySet<string>): Promise<{ written: number; removed: number; kept: string[] }> {
  let written = 0;
  let removed = 0;
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const root of m.roots) {
    for (const t of await api.list(root)) {
      seen.add(t.path);
      if (skip.has(t.path)) continue;
      const have = m.files[t.path];
      const local = hashOf(dir, t.path);
      if (have && local !== undefined && local !== have.hash) {
        kept.push(t.path);
        continue;
      }
      if (have && local !== undefined && have.version === t.version) continue;
      if (have && local !== undefined && t.hash !== undefined && t.hash === local) {
        have.version = t.version;
        continue;
      }
      await fetchInto(api, dir, m, t);
      written += 1;
    }
  }
  for (const [path, e] of Object.entries(m.files)) {
    if (seen.has(path) || skip.has(path)) continue;
    if (hashOf(dir, path) === e.hash) rmSync(join(dir, path), { force: true });
    delete m.files[path];
    removed += 1;
  }
  return { written, removed, kept };
}

export async function checkout(api: TextApi, hub: string, address: string, dir: string): Promise<string> {
  const root = resolve(dir);
  const m = load(root, hub);
  const things = await api.list(address);
  if (!things.length) return `nothing to check out at ${address}`;
  if (!m.roots.includes(address)) m.roots.push(address);
  const r = await pull(api, root, m, new Set());
  store(root, m);
  const texts = things.filter((t) => !t.binary && !t.readonly).map((t) => t.path);
  const shown = texts.slice(0, 12).map((p) => join(root, p));
  return [
    `checked out ${address} to ${root}: ${things.length} file${things.length === 1 ? '' : 's'}, ${r.written} written${r.kept.length ? `, ${r.kept.length} left alone because you edited them (${r.kept.slice(0, 5).join(', ')})` : ''}`,
    ...shown,
    ...(texts.length > shown.length ? [`and ${texts.length - shown.length} more under ${root}`] : []),
    'Edit them with your own tools, then vantage_sync this folder.',
  ].join('\n');
}

function walk(dir: string, at = dir, out: string[] = []): string[] {
  for (const name of readdirSync(at)) {
    if (name === MANIFEST || name === '.git' || name === 'node_modules' || name === '.DS_Store') continue;
    const full = join(at, name);
    if (statSync(full).isDirectory()) walk(dir, full, out);
    else out.push(posix(relative(dir, full)));
  }
  return out;
}

interface Batch {
  readonly writes: { address: string; text: string; base?: string }[];
  readonly assets: Record<string, string>;
  /** Address of each write to the file it came from. */
  readonly from: Map<string, string>;
}

export async function sync(api: TextApi, hub: string, dir: string, message: string | undefined): Promise<{ text: string; isError: boolean }> {
  const root = resolve(dir);
  if (!existsSync(join(root, MANIFEST))) return { text: `${root} is not a working copy; vantage_checkout something into it first`, isError: true };
  const m = load(root, hub);
  // The folder of each document here: workspace/document/ holds its YAML, its pages, and its files.
  const docs = new Map<string, { address: string; version: string }>();
  for (const [path, e] of Object.entries(m.files)) if (path.endsWith('.vantage.yaml') && !e.readonly) docs.set(`${dirname(path)}/`, { address: e.address, version: e.version });
  const batches = new Map<string, Batch>();
  const batch = (key: string): Batch => batches.get(key) ?? batches.set(key, { writes: [], assets: {}, from: new Map() }).get(key)!;
  const notes: string[] = [];
  const sent = new Set<string>();

  for (const path of walk(root)) {
    const e = m.files[path];
    const bytes = readFileSync(join(root, path));
    if (e && sha(bytes) === e.hash) continue;
    if (e?.readonly) {
      notes.push(`${path} is an imported file; a change to it is not sent`);
      continue;
    }
    const doc = [...docs].find(([folder]) => path.startsWith(folder));
    if (doc) {
      const [folder, d] = doc;
      const b = batch(d.address);
      const rel = path.slice(folder.length);
      if (e ? e.binary : !/\.(md|ya?ml)$/i.test(path)) b.assets[rel] = bytes.toString('base64');
      else {
        const address = e?.address ?? `${d.address}/${rel}`;
        b.writes.push({ address, text: bytes.toString('utf8'), base: e?.version ?? d.version });
        b.from.set(address, path);
      }
      sent.add(path);
      continue;
    }
    // A record under decisions/<REGISTRY>/ and an item under work/<KIND>/: a new file is made at the prefix.
    const record = /^(?:decisions|work)\/([A-Z][A-Z0-9]{1,11})\/[^/]+\.md$/.exec(path);
    if (e || record) {
      const address = e?.address ?? record![1]!;
      const b = batch(`record:${path}`);
      b.writes.push({ address, text: bytes.toString('utf8'), ...(e ? { base: e.version } : {}) });
      b.from.set(address, path);
      sent.add(path);
      continue;
    }
    notes.push(`${path} belongs to nothing checked out here; it was not sent`);
  }

  const lines: string[] = [];
  const conflicted = new Set<string>();
  let failed = false;
  for (const [key, b] of batches) {
    // A picture alone still needs its document written, so the hub lays it over the head.
    if (!b.writes.length && Object.keys(b.assets).length) {
      const yaml = Object.entries(m.files).find(([, e]) => e.address === key);
      if (yaml) b.writes.push({ address: key, text: readFileSync(join(root, yaml[0]), 'utf8'), base: yaml[1].version });
    }
    const results = await api.write({ writes: b.writes, ...(Object.keys(b.assets).length ? { assets: b.assets } : {}), ...(message ? { message } : {}) });
    for (const r of results) {
      lines.push(r.message);
      if (r.status === 'refused') failed = true;
      if (r.status === 'conflict') {
        failed = true;
        // The page in conflict, or the thing itself: both sides go into the file, and its base moves to the head so the fixed file lands.
        const address = r.path ? `${r.address}/${r.path}` : r.address;
        const path = b.from.get(address) ?? Object.entries(m.files).find(([, e]) => e.address === address)?.[0];
        if (path && r.preview !== undefined) {
          writeFileSync(join(root, path), r.preview);
          const e = m.files[path];
          if (e && r.version) Object.assign(e, { version: r.version, hash: 'conflict' });
          conflicted.add(path);
          lines.push(`both sides are in ${join(root, path)} between <<<<<<< and >>>>>>>; fix the file and sync again`);
        }
      }
      if (r.status === 'created' && key.startsWith('record:')) {
        // A new record has its number now: its file takes the name the hub gives it.
        const old = key.slice('record:'.length);
        const listed = (await api.list(r.address))[0];
        if (listed) {
          mkdirSync(dirname(join(root, listed.path)), { recursive: true });
          renameSync(join(root, old), join(root, listed.path));
          m.files[listed.path] = { address: listed.address, version: listed.version, hash: sha(readFileSync(join(root, listed.path))) };
          if (!m.roots.some((x) => x === listed.address || listed.address.startsWith(`${x}-`))) m.roots.push(listed.address);
          lines.push(`its file is now ${join(root, listed.path)}`);
        }
      }
    }
    // What was sent and saved is the base now; the pull below brings back what the hub merged in.
    if (results.every((r) => r.status === 'saved' || r.status === 'unchanged' || r.status === 'created')) {
      for (const path of b.from.values()) {
        const e = m.files[path];
        if (e) e.hash = hashOf(root, path) ?? e.hash;
      }
    }
  }
  const pulled = await pull(api, root, m, conflicted);
  store(root, m);
  if (!batches.size) lines.push('nothing here changed');
  if (pulled.written || pulled.removed) lines.push(`pulled ${pulled.written} file${pulled.written === 1 ? '' : 's'} the hub changed${pulled.removed ? `, removed ${pulled.removed} it no longer has` : ''}`);
  if (pulled.kept.length) lines.push(`not saved, still only here: ${pulled.kept.slice(0, 8).join(', ')}`);
  lines.push(...notes);
  return { text: lines.join('\n'), isError: failed };
}
