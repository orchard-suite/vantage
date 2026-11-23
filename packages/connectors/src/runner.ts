/**
 * The connector runner: one connector, run outside the hub as its own app.
 * It signs in to the issuer as the connector's app (with a workload identity
 * token file, or a client secret), reads its settings from the hub, runs
 * the connector kind they name, and pushes the batch. The same app reads
 * the systems the connector covers (the run's `identity`), so what it may
 * see is exactly what its app may see. A secret a connector names is a Key
 * Vault URL read as that app (`secrets.ts`), or, on a runner of the
 * connector's own, a variable of the runner's environment; never the hub.
 * In the shared pool (`pool.ts`) a run reads no environment and refuses a
 * kind that reads as the machine it runs on.
 * What the connector keeps between runs is read from the hub before the run
 * and stored back after its batch is pushed, when it changed; the hub holds
 * it as bytes it never reads. A run that fails before it pushes is reported
 * to the hub, with the pool's run when it has one, then rethrown, and keeps
 * nothing. A run that cannot sign in or read its settings cannot report;
 * in the pool, the hub records that failure from the pool's word.
 */
import { readFileSync } from 'node:fs';
import type { Batch } from './batch.ts';
import type { AppIdentity, ConnectorRegistry, FetchLike, Logger } from './connector.ts';
import { decodeKept, encodeKept, keptStore, type KeptStore } from './kept.ts';
import { runConnector } from './run.ts';
import { secretResolver } from './secrets.ts';

export interface RunnerOptions {
  /** The hub, for example https://vantage.example.com. */
  readonly hub: string;
  /** The connector id (from the hub's connector page or API). */
  readonly connector: string;
  /** The OAuth token endpoint, for example https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token. */
  readonly tokenUrl: string;
  readonly clientId: string;
  /** The scope to ask for: the hub's application id URI with /.default (Entra), for example api://<hub client id>/.default. */
  readonly scope: string;
  /** Exactly one: a file holding a signed assertion the issuer trusts (a projected service account token), or a client secret. */
  readonly assertionFile?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly registry: ConnectorRegistry;
  readonly log: Logger;
  readonly fetch?: FetchLike;
  /** Resolves a secret reference a connector kind names; default a Key Vault URL read as the app, or, outside the pool, the environment variable of that name. */
  readonly secrets?: (ref: string) => Promise<string>;
  /** Seconds the connector may run; default 600. */
  readonly timeoutSeconds?: number;
  /** A run in the shared pool: no environment secrets, and no kind that reads as the machine it runs on. */
  readonly pooled?: boolean;
  /** Stops the run early, such as when the pool shuts down. */
  readonly signal?: AbortSignal;
  /** The pool's run this is, so a failure the runner reports is that run's. */
  readonly job?: string;
}

export interface RunnerOutcome {
  readonly connector: string;
  readonly kind: string;
  readonly entities: number;
  readonly relations: number;
  readonly job: string | null;
}

interface Settings {
  readonly id: string;
  readonly slug: string;
  readonly connector: string;
  readonly config: unknown;
  readonly blocked: string | null;
}

type ClientCredentials = Pick<RunnerOptions, 'tokenUrl' | 'clientId' | 'assertionFile' | 'clientSecret'>;

/** An app-only access token for the scope, by the client credentials grant, with the seconds it lasts. */
async function grant(o: ClientCredentials, scope: string, fetchImpl: FetchLike): Promise<{ token: string; expiresIn: number }> {
  if (Boolean(o.assertionFile) === Boolean(o.clientSecret)) throw new Error('a runner needs exactly one of an assertion file and a client secret');
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: o.clientId, scope });
  if (o.assertionFile) {
    // Read on every grant: the kubelet replaces a projected token before it expires.
    form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    form.set('client_assertion', readFileSync(o.assertionFile, 'utf8').trim());
  } else form.set('client_secret', o.clientSecret!);
  const res = await fetchImpl(o.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number | string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`the issuer refused the client ${o.clientId} for ${scope}: ${body.error ?? res.status} ${body.error_description?.split('\n')[0] ?? ''}`.trim());
  return { token: body.access_token, expiresIn: Number(body.expires_in ?? 3600) };
}

/** The app as an identity a run reads with: one token per scope, asked again a minute before it lapses. */
export function appIdentity(o: ClientCredentials, fetchImpl: FetchLike): AppIdentity {
  const held = new Map<string, { token: string; until: number }>();
  return {
    async token(scope) {
      const h = held.get(scope);
      if (h && h.until > Date.now()) return h.token;
      const g = await grant(o, scope, fetchImpl);
      held.set(scope, { token: g.token, until: Date.now() + (g.expiresIn - 60) * 1000 });
      return g.token;
    },
  };
}

/** What the connector kept from its last run; a hub without the route, or a failed read, keeps nothing and the run reads afresh. */
async function readKept(fetchImpl: FetchLike, url: string, auth: string, log: Logger): Promise<KeptStore> {
  try {
    const res = await fetchImpl(url, { headers: { authorization: auth } });
    if (res.status === 204 || res.status === 404) {
      log.info('connector kept none', { status: res.status });
      return keptStore();
    }
    if (!res.ok) throw new Error(`${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const entries = decodeKept(bytes);
    log.info('connector kept read', { entries: Object.keys(entries).length, bytes: bytes.length });
    return keptStore(entries);
  } catch (err) {
    log.warn('connector kept unreadable', { error: (err as Error).message });
    return keptStore();
  }
}

/** Stores what the run kept, when it changed; a failure costs the next run its reuse, never this run. */
async function storeKept(fetchImpl: FetchLike, url: string, auth: string, kept: KeptStore, log: Logger): Promise<void> {
  if (!kept.changed()) {
    log.info('connector kept unchanged', { entries: Object.keys(kept.entries()).length });
    return;
  }
  const entries = kept.entries();
  const bytes = encodeKept(entries);
  try {
    const res = await fetchImpl(url, { method: 'PUT', headers: { authorization: auth, 'content-type': 'application/gzip' }, body: bytes });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    log.info('connector kept stored', { entries: Object.keys(entries).length, bytes: bytes.length });
  } catch (err) {
    log.warn('connector kept not stored', { error: (err as Error).message, bytes: bytes.length });
  }
}

export async function runConnectorOnce(o: RunnerOptions): Promise<RunnerOutcome> {
  const fetchImpl: FetchLike = o.fetch ?? fetch;
  const hub = o.hub.replace(/\/$/, '');
  const log = o.log;
  log.info('runner start', { hub, connector: o.connector, clientId: o.clientId, pooled: o.pooled ?? false });
  const identity = appIdentity(o, fetchImpl);
  const token = await identity.token(o.scope);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const call = async (path: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const res = await fetchImpl(`${hub}/api/v1${path}`, { ...init, headers });
    const text = await res.text();
    const what = `${init.method ?? 'GET'} ${path}`;
    // A gateway in front of the hub answers with its own page, not JSON, while the hub restarts.
    let body: Record<string, unknown> | null = {};
    try {
      if (text) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    if (!res.ok) throw new Error(`${what}: ${res.status} ${String(body?.['error'] ?? text.split('\n')[0]!.slice(0, 200))}`);
    if (!body) throw new Error(`${what}: ${res.status} answered with something that is not JSON`);
    return body;
  };
  const settings = (await call(`/connector/${encodeURIComponent(o.connector)}`)) as unknown as Settings;
  try {
    if (settings.blocked) throw new Error(`the hub will not take a batch: ${settings.blocked}`);
    let batch: Batch;
    if (settings.connector === 'push') throw new Error('a push connector has no kind to run; push to it from your own script');
    const kind = o.registry.get(settings.connector);
    if (!kind) throw new Error(`this runner has no connector kind ${settings.connector}; known: ${o.registry.list().map((c) => c.id).join(', ')}`);
    if (o.pooled && kind.hostIdentity) throw new Error(`a ${kind.id} connector reads as the machine it runs on, so it needs a runner of its own, not the shared pool`);
    const keptUrl = `${hub}/api/v1/connector/${encodeURIComponent(settings.id)}/kept`;
    const kept = await readKept(fetchImpl, keptUrl, headers.authorization, log);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`connector run exceeded ${o.timeoutSeconds ?? 600}s`)), (o.timeoutSeconds ?? 600) * 1000);
    const stop = (): void => controller.abort(o.signal?.reason ?? new Error('the runner stopped'));
    o.signal?.addEventListener('abort', stop, { once: true });
    try {
      const secrets = o.secrets ?? secretResolver({ identity, fetch: fetchImpl, log, ...(o.pooled ? {} : { env: process.env }) });
      batch = (await runConnector(kind, { config: settings.config, secrets, log, now: () => new Date(), signal: controller.signal, fetch: fetchImpl, kept, identity }, settings.slug)).batch;
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', stop);
    }
    const pushed = await call(`/connector/${encodeURIComponent(settings.id)}/batches`, { method: 'POST', body: JSON.stringify(batch) });
    await storeKept(fetchImpl, keptUrl, headers.authorization, kept, log);
    const outcome = { connector: settings.slug, kind: settings.connector, entities: batch.entities.length, relations: batch.relations.length, job: typeof pushed['job'] === 'string' ? pushed['job'] : null };
    log.info('runner end', { ...outcome });
    return outcome;
  } catch (err) {
    const message = (err as Error).message;
    log.error('runner failed', { connector: settings.slug, error: message });
    await call(`/connector/${encodeURIComponent(settings.id)}/failures`, { method: 'POST', body: JSON.stringify({ error: message.slice(0, 4000), ...(o.job ? { job: o.job } : {}) }) }).catch((e: Error) => log.warn('runner could not report the failure', { error: e.message }));
    throw err;
  }
}
