/**
 * Hub configuration: environment variables validated by a schema. The
 * process refuses to start on a missing or malformed value and says which.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { cronProblem } from './worker/cron.ts';
import { AgentSetupSchema } from './agents.ts';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const list = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean));

const int = (min: number, fallback: number) => z.coerce.number().int().min(min).default(fallback);

/**
 * The cores this process may use: the container's CPU limit (cgroup v2
 * `cpu.max`) where there is one, else the machine's.
 */
export function availableCores(cpuMax: string | undefined, machine: number): number {
  const [quota, period] = (cpuMax ?? '').trim().split(/\s+/);
  const limit = quota && quota !== 'max' && period ? Math.ceil(Number(quota) / Number(period)) : undefined;
  return Math.max(1, Math.min(machine, limit !== undefined && Number.isFinite(limit) ? limit : machine));
}

function readCpuMax(): string | undefined {
  try {
    return readFileSync('/sys/fs/cgroup/cpu.max', 'utf8');
  } catch {
    return undefined;
  }
}

/** Render threads when RENDER_THREADS is unset: one per core, at most eight. */
export const DEFAULT_RENDER_THREADS = Math.min(8, availableCores(readCpuMax(), navigator.hardwareConcurrency));

export const ConfigSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    /** A read replica (or a pooler in front of the replicas) for reads that tolerate lag; unset reads the primary. */
    DATABASE_READ_URL: z.string().min(1).optional(),
    /** How the hub signs in to Postgres: `password` uses the one in the URL; `azure` uses an Entra token for the pod's workload identity as the password, so the URL carries the user and no password. */
    DATABASE_AUTH: z.enum(['password', 'azure']).default('password'),
    PUBLIC_URL: z.url().transform((u) => u.replace(/\/$/, '')),
    AUTH_MODE: z.enum(['oidc', 'proxy', 'none']).default('oidc'),
    OIDC_ISSUER: z.url().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    /** A file holding a signed token the issuer trusts as the client's credential (a Kubernetes workload identity token for Entra), read on every use; instead of OIDC_CLIENT_SECRET. */
    OIDC_CLIENT_ASSERTION_FILE: z.string().min(1).optional(),
    OIDC_GROUPS_CLAIM: z.string().min(1).default('groups'),
    /** The scope the hub exposes at the issuer (Entra: "access_as_user"). Set, every bearer route also takes access tokens the issuer signs for the hub with it, so an agent or a module acts as the person, under any AUTH_MODE but none. */
    OIDC_API_SCOPE: z.string().min(1).optional(),
    /** The hub's application URI at the issuer, accepted as an audience beside OIDC_CLIENT_ID; default api://<OIDC_CLIENT_ID>. */
    OIDC_API_AUDIENCE: z.string().min(1).optional(),
    /** The claim that names a person the same in every token the issuer signs, for any app: "oid" on Entra, whose sub differs per app (VAN-2006). */
    OIDC_PERSON_CLAIM: z.string().min(1).default('sub'),
    /** Groups (comma separated) a person must be in to sign in, from the OIDC groups claim or the front door's groups header; empty lets everyone the issuer signs in. */
    SIGN_IN_GROUPS: list,
    /** Who may make team workspaces: everyone, or only admins and the people an admin lets. */
    TEAM_WORKSPACES: z.enum(['everyone', 'granted']).default('everyone'),
    /** Publications run only once an admin approves them, and again after their destination changes. */
    PUBLICATION_APPROVAL: bool.default(false),
    /** Connectors push only once an admin approves them, and again after their kind, client, or settings change. */
    CONNECTOR_APPROVAL: bool.default(false),
    /** The issuer that signs connectors' app-only access tokens; default OIDC_ISSUER. Unset with no OIDC_ISSUER, no connector can sign in. */
    CONNECTOR_ISSUER: z.url().optional(),
    /** The audience a connector's token must name; default OIDC_API_AUDIENCE, else api://<OIDC_CLIENT_ID>. */
    CONNECTOR_AUDIENCE: z.string().min(1).optional(),
    /** The app role a connector's token must carry (Entra: an application permission on the hub's app). */
    CONNECTOR_ROLE: z.string().min(1).default('Vantage.Connector'),
    /** The app role a module's own token carries; its kinds are the ones an admin registered for its client. */
    MODULE_ROLE: z.string().min(1).default('Vantage.Module'),
    /** The app role that makes an app the shared connector pool, which leases the runs the hub schedules. */
    CONNECTOR_POOL_ROLE: z.string().min(1).default('Vantage.ConnectorPool'),
    /** The shortest interval, in minutes, a connector may run on in the pool. */
    CONNECTOR_MIN_EVERY_MINUTES: int(1, 5),
    /** The most connectors one workspace may hold. */
    CONNECTOR_MAX_PER_WORKSPACE: int(1, 20),
    /** Guest links for people without an account; false turns off making and opening them everywhere. */
    GUEST_LINKS: bool.default(true),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET needs at least 32 characters'),
    SECRETS_KEY: z.string().min(32, 'SECRETS_KEY needs at least 32 characters'),
    BLOB_DRIVER: z.enum(['fs', 'azure']).default('fs'),
    BLOB_PATH: z.string().min(1).default('./data/blobs'),
    AZURE_BLOB_URL: z.url().optional(),
    WORKER_EMBEDDED: bool.default(false),
    PORT: int(1, 4848),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    FRESHNESS_DAYS: int(1, 7),
    RETENTION_VERSIONS: int(1, 50),
    /** Days a disabled workspace waits before the purge job removes it. */
    PURGE_GRACE_DAYS: int(0, 30),
    /** Seconds between worker polls when no job is queued. */
    WORKER_POLL_SECONDS: int(1, 2),
    /** Five-field cron (UTC) for the nightly review of every workspace. */
    REVIEW_CRON: z.string().min(9).default('0 3 * * *'),
    /** Jobs one worker runs at once. Rendering runs on the render threads, so this can exceed them. */
    WORKER_CONCURRENCY: int(1, 4),
    /** Seconds a running job's lease lasts; the worker renews it, and another worker takes back a job whose lease lapsed. */
    JOB_LEASE_SECONDS: int(15, 120),
    /** Seconds a stopping worker waits for its jobs before it puts them back in the queue. */
    SHUTDOWN_GRACE_SECONDS: int(0, 20),
    /** Seconds a stopping web pod answers 503 on /readyz before it closes, so the load balancer stops sending it requests first. */
    DRAIN_SECONDS: int(0, 5),
    /** Days finished jobs, source runs, publication runs, and notifications are kept. The audit log is kept. */
    HISTORY_DAYS: int(1, 30),
    /** Render threads in one process; 0 draws on the event loop (tests, tools). Unset, one per core the process may use, at most eight. */
    RENDER_THREADS: int(0, DEFAULT_RENDER_THREADS),
    /** Seconds one render task may run before its thread is replaced and the task fails. */
    RENDER_TIMEOUT_SECONDS: int(5, 300),
    /** Render tasks allowed to wait; past it a request answers 503 and a job retries. */
    RENDER_QUEUE: int(1, 200),
    /** Days an entity or relation a source stopped reporting is remembered; past it, it is dropped. */
    OBSERVED_RETENTION_DAYS: int(1, 3),
    /** Connections in the database pool of one process. */
    DB_POOL: int(1, 10),
    /** The Grafana Faro collector readers' browser telemetry is relayed to; with FARO_API_KEY. Without both, batches are accepted and dropped. */
    FARO_URL: z.url().optional(),
    FARO_API_KEY: z.string().min(1).optional(),
    /** The organization's allowed origins (comma separated): the sites that may frame an embed, and that published HTML copies may fetch the live bundle from with credentials; empty allows none but the hub. */
    EMBED_ORIGINS: list.transform((v) => v.map((o) => o.replace(/\/$/, ''))),
    /** The model API the organization pays for, ending in its version (https://gateway.example/v1). Set, authors may revise a document from its open comments. */
    AI_BASE_URL: z.url().transform((u) => u.replace(/\/$/, '')).optional(),
    /** The organization's key for AI_BASE_URL; one key for everyone, and the hub counts each person's use. */
    AI_API_KEY: z.string().min(1).optional(),
    /** The header the key goes in. */
    AI_KEY_HEADER: z.string().min(1).default('x-api-key'),
    /** The model a revision uses unless the author picks another. */
    AI_MODEL: z.string().min(1).optional(),
    /** Each person's daily token limit for revisions until an admin sets the limits on the admin page; then those stand. */
    AI_DAILY_TOKENS: int(1, 1_000_000),
    /** Dispatch's API base (https://dispatch-api.example.org); with DISPATCH_TOKEN, notifications are delivered through it. Without both they are stored only. */
    DISPATCH_URL: z.url().transform((u) => u.replace(/\/$/, '')).optional(),
    /** A token the Dispatch desk issued; its name is the producer Dispatch shows. */
    DISPATCH_TOKEN: z.string().min(1).optional(),
    /** The longest voice walkthrough an author may save, in seconds. */
    RECORDING_MAX_SECONDS: int(10, 900),
    /** The largest voice walkthrough an author may save, in megabytes. */
    RECORDING_MAX_MB: int(1, 50),
    /** How readers connect an agent: a JSON array of ways, each a command to copy or a link to open (agents.ts). Empty shows the MCP address. */
    AGENT_SETUP: AgentSetupSchema,
  })
  .superRefine((c, ctx) => {
    if (c.AUTH_MODE === 'oidc') {
      for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID'] as const) {
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when AUTH_MODE=oidc` });
      }
      if (Boolean(c.OIDC_CLIENT_SECRET) === Boolean(c.OIDC_CLIENT_ASSERTION_FILE)) {
        ctx.addIssue({ code: 'custom', path: ['OIDC_CLIENT_SECRET'], message: 'AUTH_MODE=oidc needs exactly one of OIDC_CLIENT_SECRET and OIDC_CLIENT_ASSERTION_FILE' });
      }
    }
    if (c.OIDC_API_SCOPE && c.AUTH_MODE !== 'none') {
      if (!c.OIDC_ISSUER) ctx.addIssue({ code: 'custom', path: ['OIDC_ISSUER'], message: 'OIDC_ISSUER is required when OIDC_API_SCOPE is set' });
      if (!c.OIDC_CLIENT_ID && !c.OIDC_API_AUDIENCE) ctx.addIssue({ code: 'custom', path: ['OIDC_API_AUDIENCE'], message: 'OIDC_API_SCOPE needs the hub named at the issuer: OIDC_CLIENT_ID or OIDC_API_AUDIENCE' });
    }
    if (c.AI_BASE_URL) {
      for (const k of ['AI_API_KEY', 'AI_MODEL'] as const) {
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when AI_BASE_URL is set` });
      }
    }
    if (Boolean(c.DISPATCH_URL) !== Boolean(c.DISPATCH_TOKEN)) {
      ctx.addIssue({ code: 'custom', path: ['DISPATCH_TOKEN'], message: 'DISPATCH_URL and DISPATCH_TOKEN go together' });
    }
    if (cronProblem(c.REVIEW_CRON)) ctx.addIssue({ code: 'custom', path: ['REVIEW_CRON'], message: `REVIEW_CRON: ${cronProblem(c.REVIEW_CRON)}` });
    if (c.BLOB_DRIVER === 'azure' && !c.AZURE_BLOB_URL) {
      ctx.addIssue({ code: 'custom', path: ['AZURE_BLOB_URL'], message: 'AZURE_BLOB_URL is required when BLOB_DRIVER=azure' });
    }
  });

export type Config = z.output<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parses the environment; throws a ConfigError naming every bad variable. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(stripEmpty(env));
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`);
  throw new ConfigError(problems);
}

function stripEmpty(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}
