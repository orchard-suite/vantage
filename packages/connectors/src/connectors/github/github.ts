/**
 * Reads the open pull requests and issues of GitHub repositories (REST,
 * the issues list, which carries both) and reports each as an open item
 * pointed at a fact: every bound entity whose repository fact names the
 * repository shows them. The connector reports no entities of its own.
 *
 * It reads as a token, or as a GitHub App: each run signs a short JWT with
 * the app's private key and trades it for an installation token, so nothing
 * that reads a private repository has to be rotated by hand.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import { ITEM_SEVERITIES, type ItemSeverity } from '@vantage/model';
import type { Batch, BatchItem } from '../../batch.ts';
import { HttpError, type Connector, type ConnectorContext } from '../../connector.ts';

const SeveritySchema = z.enum(ITEM_SEVERITIES);

export const GithubConfigSchema = z
  .object({
    url: z.string().url().default('https://api.github.com').describe('API base URL; a GitHub Enterprise server is https://host/api/v3'),
    token: z.string().min(1).optional().describe('Secret reference for a token that may read the repositories; without it and without app, only public ones, at a low rate'),
    app: z
      .object({
        id: z.string().min(1).describe('The GitHub App id, or its client id'),
        installation: z.number().int().positive().describe('The installation id on the account that owns the repositories'),
        privateKey: z.string().min(1).describe("Secret reference for the app's private key (PEM)"),
      })
      .strict()
      .optional()
      .describe('Read as a GitHub App installation instead of a token: a fresh installation token every run'),
    repositories: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'owner/name')).min(1).describe('Repositories as owner/name'),
    fact: z.string().min(1).default('repository').describe('The fact that names a repository on observed entities, as owner/name or its URL'),
    pulls: z.boolean().default(true).describe('Report open pull requests'),
    issues: z.boolean().default(true).describe('Report open issues'),
    severities: z.record(z.string(), SeveritySchema).default({}).describe('Label name to severity; a label named for a severity (critical, high, medium, low, info) counts too'),
  })
  .strict()
  .refine((c) => !(c.token !== undefined && c.app !== undefined), { message: 'give token or app, not both' });

export type GithubConfig = z.output<typeof GithubConfigSchema>;

interface GithubIssue {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  draft?: boolean;
  labels: (string | { name?: string })[];
  pull_request?: unknown;
}

/** The next page from a Link header, when there is one. */
export function nextLink(link: string | null): string | undefined {
  return link?.split(',').map((p) => /<([^>]+)>;\s*rel="next"/.exec(p)?.[1]).find((u) => u !== undefined);
}

function severityOf(config: GithubConfig, labels: GithubIssue['labels']): ItemSeverity | undefined {
  const own = new Map(Object.entries(config.severities).map(([k, v]) => [k.toLowerCase(), v]));
  let worst: number | undefined;
  for (const l of labels) {
    const name = (typeof l === 'string' ? l : (l.name ?? '')).toLowerCase();
    const s = own.get(name) ?? (ITEM_SEVERITIES as readonly string[]).find((x) => x === name);
    if (s !== undefined) worst = Math.min(worst ?? ITEM_SEVERITIES.length, ITEM_SEVERITIES.indexOf(s as ItemSeverity));
  }
  return worst === undefined ? undefined : ITEM_SEVERITIES[worst];
}

function itemOf(config: GithubConfig, repo: string, i: GithubIssue): BatchItem {
  const pr = i.pull_request !== undefined;
  const severity = severityOf(config, i.labels);
  return {
    id: `${repo}#${i.number}`,
    kind: pr ? 'pr' : 'issue',
    title: `#${i.number} ${i.title}`,
    url: i.html_url,
    ...(severity !== undefined ? { severity } : {}),
    status: pr && i.draft ? 'draft' : 'open',
    updated: new Date(i.updated_at).toISOString(),
    target: { fact: config.fact, value: repo },
  };
}

const b64url = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

/** A JWT the app signs for itself, valid ten minutes; GitHub allows a minute of clock skew each way. */
export function appJwt(id: string, pem: string, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const data = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat, exp: iat + 600, iss: id }))}`;
  return `${data}.${b64url(sign('RSA-SHA256', Buffer.from(data), createPrivateKey(pem)))}`;
}

async function tokenOf(ctx: ConnectorContext<GithubConfig>, base: string): Promise<string | undefined> {
  const { config } = ctx;
  if (config.token !== undefined) return ctx.secrets(config.token);
  if (config.app === undefined) return undefined;
  const url = `${base}/app/installations/${config.app.installation}/access_tokens`;
  const jwt = appJwt(config.app.id, await ctx.secrets(config.app.privateKey), ctx.now());
  const res = await ctx.fetch(url, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${jwt}` }, signal: ctx.signal });
  if (!res.ok) {
    ctx.log.error('github app token refused', { url, status: res.status });
    throw new HttpError(res.status, url, await res.text());
  }
  return ((await res.json()) as { token: string }).token;
}

export const githubConnector: Connector<GithubConfig> = {
  id: 'github',
  configSchema: GithubConfigSchema,
  async *discover(ctx: ConnectorContext<GithubConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const base = config.url.replace(/\/$/, '');
    const token = await tokenOf(ctx, base);
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}) };
    for (const repo of config.repositories) {
      const items: BatchItem[] = [];
      let url: string | undefined = `${base}/repos/${repo}/issues?state=open&per_page=100`;
      let pages = 0;
      while (url !== undefined) {
        log.debug('http request', { url, method: 'GET' });
        const res = await ctx.fetch(url, { headers, signal: ctx.signal });
        if (!res.ok) {
          log.error('http request failed', { url, status: res.status });
          throw new HttpError(res.status, url, await res.text());
        }
        pages++;
        for (const i of (await res.json()) as GithubIssue[]) {
          const pr = i.pull_request !== undefined;
          if (pr ? config.pulls : config.issues) items.push(itemOf(config, repo, i));
        }
        url = nextLink(res.headers.get('link'));
      }
      log.info('github repository read', { repository: repo, pages, pulls: items.filter((i) => i.kind === 'pr').length, issues: items.filter((i) => i.kind === 'issue').length });
      yield { source: 'github', observed: ctx.now().toISOString(), partial: true, entities: [], relations: [], items };
    }
  },
};
