/**
 * Reads the recent history of repositories on one branch, from GitHub or
 * GitLab: each commit, when it landed, the files it changed with the start
 * of each diff, and the items its `Work:` trailers name (VAN-3026). It
 * reports no entities; the hub keeps the history per repository, reads
 * which boxes and page sections a commit may have made stale against the
 * evidence a document records, and links each commit to the items it
 * names as proof. A commit never changes, so each is read once and kept
 * between runs.
 *
 * Each forge signs in its own way: GitHub with a token or as a GitHub App
 * (`./github.ts`), GitLab with a token (`./gitlab.ts`).
 */
import { z } from 'zod';
import type { Batch, Changes } from '../../batch.ts';
import { PATCH_MAX } from '../../batch.ts';
import type { Connector, ConnectorContext } from '../../connector.ts';
import { githubSignIn, ONE_SIGN_IN, oneSignIn } from '../github/app.ts';
import type { Forge } from './forge.ts';
import { githubForge } from './github.ts';
import { gitlabForge } from './gitlab.ts';
import { workTrailers } from './trailers.ts';

export { GIT_PERMISSIONS, repositoryHost } from './github.ts';
export { gitlabHost } from './gitlab.ts';
export { workTrailers } from './trailers.ts';

export const FORGES = ['github', 'gitlab'] as const;
export type ForgeName = (typeof FORGES)[number];

/** The API a forge answers on when no url is given. */
export const FORGE_URLS: Readonly<Record<ForgeName, string>> = { github: 'https://api.github.com', gitlab: 'https://gitlab.com/api/v4' };

export const GitConfigSchema = z
  .object({
    forge: z.enum(FORGES).default('github').describe('Where the repositories live: github (github.com or GitHub Enterprise) or gitlab (gitlab.com or self-hosted, API v4)'),
    url: z.string().url().optional().describe('API base URL; default https://api.github.com for github and https://gitlab.com/api/v4 for gitlab. A GitHub Enterprise server is https://host/api/v3, a self-hosted GitLab https://host/api/v4'),
    ...githubSignIn,
    repositories: z.array(z.string().regex(/^[^/\s]+(\/[^/\s]+)+$/, 'owner/name, or group/subgroup/name on GitLab')).min(1).describe('Repositories as owner/name; a GitLab project by its full path'),
    branch: z.string().min(1).optional().describe("The branch merges land on; default each repository's own default branch"),
    depth: z.number().int().min(1).max(1000).default(200).describe('How many commits back to read; a tie checked at an older commit is reported as unknown'),
    paths: z.array(z.string().min(1)).optional().describe('Keep only files these paths watch: globs (packages/**, *.md), folders (src/), or exact files, the way vantage.yaml watch names them'),
  })
  .strict()
  .refine(oneSignIn, ONE_SIGN_IN)
  .refine((c) => c.forge === 'github' || c.app === undefined, { message: 'app signs in to GitHub only; GitLab signs in with token' })
  .refine((c) => c.forge === 'gitlab' || c.repositories.every((r) => r.split('/').length === 2), { message: 'a GitHub repository is owner/name' });

export type GitConfig = z.output<typeof GitConfigSchema>;

/** A commit as the connector keeps it: `work` is always set, so a commit kept before trailers were read is read again once. */
type KeptCommit = Changes['commits'][number] & { work: string[] };

function cut(patch: string | undefined): string | undefined {
  if (patch === undefined) return undefined;
  return patch.length > PATCH_MAX ? `${patch.slice(0, PATCH_MAX)}\n... cut at ${PATCH_MAX} characters` : patch;
}

function keptCommit(v: unknown): KeptCommit | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Partial<KeptCommit>;
  return typeof c.sha === 'string' && Array.isArray(c.files) && Array.isArray(c.work) ? (c as KeptCommit) : undefined;
}

const GLOB = /[*?[{]/;

/**
 * Whether a repository path is one the paths watch: a glob (`packages/**`,
 * `*.md`, matched from the root), a folder (`src/` or `src`, and all under
 * it), or an exact file (`Makefile`). No paths watches everything.
 */
export function watches(paths: readonly string[] | undefined, file: string): boolean {
  if (!paths?.length) return true;
  return paths.some((p) => (GLOB.test(p) ? new Bun.Glob(p).match(file) : file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`)));
}

function forgeOf(ctx: ConnectorContext<GitConfig>): Promise<Forge> {
  const base = (ctx.config.url ?? FORGE_URLS[ctx.config.forge]).replace(/\/$/, '');
  return ctx.config.forge === 'gitlab' ? gitlabForge(ctx, base) : githubForge(ctx, base);
}

export const gitConnector: Connector<GitConfig> = {
  id: 'git',
  configSchema: GitConfigSchema,
  async *discover(ctx: ConnectorContext<GitConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const forge = await forgeOf(ctx);
    for (const repo of config.repositories) {
      const reader = await forge.repository(repo);
      const branch = config.branch ?? (await reader.defaultBranch());
      const listed = await reader.list(branch, config.depth);
      let read = 0;
      let named = 0;
      const commits: Changes['commits'] = [];
      // The list is newest first; the history is oldest first.
      for (const sha of listed.reverse()) {
        const key = `${repo}@${sha}`;
        let c = keptCommit(ctx.kept?.get(key));
        if (!c) {
          const d = await reader.commit(sha);
          const trailers = workTrailers(d.message);
          if (trailers.bad.length) log.warn('git work trailer is not an item key', { repository: repo, sha: d.sha, values: trailers.bad });
          c = { sha: d.sha, ...(d.at ? { at: new Date(d.at).toISOString() } : {}), title: d.message.split('\n')[0]!.slice(0, 500), files: d.files.slice(0, 300).map((f) => ({ path: f.path, ...(cut(f.patch) !== undefined ? { patch: cut(f.patch)! } : {}) })), work: trailers.keys.slice(0, 50) };
          ctx.kept?.set(key, c);
          read++;
        }
        const { work, ...rest } = c;
        if (work.length) named++;
        commits.push({ ...rest, ...(work.length ? { work } : {}), files: c.files.filter((f) => watches(config.paths, f.path)) });
      }
      const head = commits[commits.length - 1]?.sha;
      log.info('git history read', { forge: config.forge, repository: repo, branch, commits: commits.length, read, naming: named });
      if (head === undefined) continue;
      yield { source: 'git', observed: ctx.now().toISOString(), partial: true, entities: [], relations: [], changes: [{ repository: `${forge.host}/${repo}`, branch, head, commits }] };
    }
  },
};
