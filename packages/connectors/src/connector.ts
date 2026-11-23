/**
 * The connector contract. A connector pulls from one kind of source and
 * yields batches; the hub schedules it, merges what it yields, and persists
 * the result. Everything a connector touches outside its own logic (network,
 * secrets, time, logging, cancellation) comes through the context, so a test
 * can run a connector against recorded responses.
 */
import type { z } from 'zod';
import type { Batch } from './batch.ts';
import type { Kept } from './kept.ts';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Request options plus the TLS override Bun accepts, which the in-cluster kubectl path uses for the API server CA. */
export interface FetchInit extends RequestInit {
  tls?: { ca?: string; rejectUnauthorized?: boolean };
}

/** The shape of fetch a connector needs; the global fetch satisfies it, and a test hands in a recorded one. */
export type FetchLike = (input: string | URL | Request, init?: FetchInit) => Promise<Response>;

/** The app a run acts as: tokens for any resource that app may reach, from the issuer that vouches for it. */
export interface AppIdentity {
  /** An app-only access token for the scope, such as https://management.azure.com/.default. */
  token(scope: string): Promise<string>;
}

export interface ConnectorContext<C = unknown> {
  /** The validated instance configuration. */
  readonly config: C;
  /** Resolves a secret reference (`vault:orrery/token`, an env name, whatever the hub decides) to its value. */
  readonly secrets: (ref: string) => Promise<string>;
  readonly log: Logger;
  readonly now: () => Date;
  readonly signal: AbortSignal;
  readonly fetch: FetchLike;
  /** What outlasts the run, where the runner keeps it; absent, nothing does. */
  readonly kept?: Kept;
  /** The connector's own app, which a runner signs in as; absent outside a runner, where a kind falls back to the machine's own sign-in. */
  readonly identity?: AppIdentity;
}

export interface Connector<C = unknown> {
  readonly id: string;
  /** Validated per instance; secrets are referenced, never inlined. */
  readonly configSchema: z.ZodType<C>;
  /**
   * The kind reads as the machine it runs on (a pod's own service account), not as
   * its connector's app, so only a runner of its own runs it; the shared pool never does.
   */
  readonly hostIdentity?: true;
  discover(ctx: ConnectorContext<C>): AsyncIterable<Batch>;
}

export interface ConnectorRegistry {
  get(id: string): Connector | undefined;
  list(): readonly Connector[];
  register(connector: Connector): void;
}

export function createRegistry(connectors: readonly Connector[] = []): ConnectorRegistry {
  const byId = new Map<string, Connector>();
  const register = (c: Connector): void => {
    if (byId.has(c.id)) throw new Error(`connector ${c.id} is registered twice`);
    byId.set(c.id, c);
  };
  for (const c of connectors) register(c);
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    register,
  };
}

/** A logger that writes one JSON line per event to stdout. */
export function consoleLogger(base: LogFields = {}): Logger {
  const emit = (level: string, message: string, fields?: LogFields): void => {
    console.log(JSON.stringify({ level, time: new Date().toISOString(), message, ...base, ...fields }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export interface LogRecord {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: LogFields;
}

export interface MemoryLogger extends Logger {
  readonly records: LogRecord[];
}

/** A logger tests read back. */
export function memoryLogger(): MemoryLogger {
  const records: LogRecord[] = [];
  const push = (level: LogRecord['level']) => (message: string, fields: LogFields = {}) => {
    records.push({ level, message, fields });
  };
  return { records, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

/** GET or POST JSON and parse the body; a non-2xx status throws with the body text for the log. */
export async function fetchJson<T = unknown>(ctx: Pick<ConnectorContext, 'fetch' | 'signal' | 'log'>, url: string, init: FetchInit = {}): Promise<T> {
  ctx.log.debug('http request', { url, method: init.method ?? 'GET' });
  const res = await ctx.fetch(url, { ...init, signal: ctx.signal });
  if (!res.ok) {
    const text = await res.text();
    ctx.log.error('http request failed', { url, status: res.status });
    throw new HttpError(res.status, url, text);
  }
  return (await res.json()) as T;
}

interface Tagged<T> {
  readonly etag: string;
  readonly body: T;
}

function taggedOf<T>(v: unknown): Tagged<T> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as { etag?: unknown; body?: unknown };
  return typeof t.etag === 'string' && 'body' in t ? { etag: t.etag, body: t.body as T } : undefined;
}

/**
 * GET JSON the way fetchJson does, keeping the answer under its URL with the
 * tag the source named. The next ask sends the tag back; a 304 answers with
 * the kept body. Without `ctx.kept`, or from a source that names no tag, it
 * is a plain GET.
 */
export async function fetchJsonTagged<T = unknown>(ctx: Pick<ConnectorContext, 'fetch' | 'signal' | 'log' | 'kept'>, url: string, init: Omit<FetchInit, 'headers'> & { headers?: Record<string, string> } = {}): Promise<{ body: T; kept: boolean }> {
  const before = taggedOf<T>(ctx.kept?.get(url));
  const headers = before ? { ...init.headers, 'if-none-match': before.etag } : init.headers;
  ctx.log.debug('http request', { url, method: 'GET', tagged: before !== undefined });
  const res = await ctx.fetch(url, { ...init, ...(headers ? { headers } : {}), signal: ctx.signal });
  if (res.status === 304 && before) return { body: before.body, kept: true };
  if (!res.ok) {
    const text = await res.text();
    ctx.log.error('http request failed', { url, status: res.status });
    throw new HttpError(res.status, url, text);
  }
  const body = (await res.json()) as T;
  const etag = res.headers.get('etag');
  if (ctx.kept && etag) ctx.kept.set(url, { etag, body } satisfies Tagged<T>);
  return { body, kept: false };
}
