/**
 * Reads the recent history of GitHub repositories on one branch: each
 * commit, when it landed, and the files it changed with the start of each
 * diff. It reports no entities; the hub keeps the history per repository
 * and reads which boxes and page sections a commit may have made stale
 * against the evidence a document records. A commit's files never change,
 * so each is read once and kept between runs.
 *
 * It signs in with a token or as a GitHub App (`../github/app.ts`); an
 * app's token asks only for contents and metadata.
 */
import { z } from 'zod';
import type { Batch, Changes } from '../../batch.ts';
import { PATCH_MAX } from '../../batch.ts';
import { fetchJson, type Connector, type ConnectorContext } from '../../connector.ts';
import { githubSigner, githubSignIn, ONE_SIGN_IN, oneSignIn, type GithubPermissions } from '../github/app.ts';

export const GitConfigSchema = z
  .object({
    url: z.string().url().default('https://api.github.com').describe('API base URL; a GitHub Enterprise server is https://host/api/v3'),
    ...githubSignIn,
    repositories: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'owner/name')).min(1).describe('Repositories as owner/name'),
    branch: z.string().min(1).optional().describe("The branch merges land on; default each repository's own default branch"),
    depth: z.number().int().min(1).max(1000).default(200).describe('How many commits back to read; a tie checked at an older commit is reported as unknown'),
    paths: z.array(z.string().min(1)).optional().describe('Keep only files these paths watch: globs (packages/**, *.md), folders (src/), or exact files, the way vantage.yaml watch names them'),
  })
  .strict()
  .refine(oneSignIn, ONE_SIGN_IN);

export type GitConfig = z.output<typeof GitConfigSchema>;

interface ListedCommit {
  sha: string;
}

interface CommitDetail {
  sha: string;
  commit: { message: string; committer?: { date?: string } | null };
  files?: { filename: string; patch?: string }[];
}

type KeptCommit = Changes['commits'][number];

/** What reading commits and their diffs needs, and nothing more. */
export const GIT_PERMISSIONS: GithubPermissions = { contents: 'read', metadata: 'read' };

/** The host a repository is named under: github.com for the public API, the server's own host for Enterprise. */
export function repositoryHost(apiUrl: string): string {
  const u = new URL(apiUrl);
  return u.hostname === 'api.github.com' ? 'github.com' : u.hostname;
}

function cut(patch: string | undefined): string | undefined {
  if (patch === undefined) return undefined;
  return patch.length > PATCH_MAX ? `${patch.slice(0, PATCH_MAX)}\n... cut at ${PATCH_MAX} characters` : patch;
}

function keptCommit(v: unknown): KeptCommit | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Partial<KeptCommit>;
  return typeof c.sha === 'string' && Array.isArray(c.files) ? (c as KeptCommit) : undefined;
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

export const gitConnector: Connector<GitConfig> = {
  id: 'git',
  configSchema: GitConfigSchema,
  async *discover(ctx: ConnectorContext<GitConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const base = config.url.replace(/\/$/, '');
    const host = repositoryHost(base);
    const signer = await githubSigner(ctx, base, GIT_PERMISSIONS);
    for (const repo of config.repositories) {
      const headers = await signer(repo);
      const branch = config.branch ?? (await fetchJson<{ default_branch: string }>(ctx, `${base}/repos/${repo}`, { headers })).default_branch;
      const listed: string[] = [];
      for (let page = 1; listed.length < config.depth; page++) {
        const per = Math.min(100, config.depth - listed.length);
        const rows = await fetchJson<ListedCommit[]>(ctx, `${base}/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${per}&page=${page}`, { headers });
        listed.push(...rows.map((r) => r.sha));
        if (rows.length < per) break;
      }
      let read = 0;
      const commits: KeptCommit[] = [];
      // The list is newest first; the history is oldest first.
      for (const sha of listed.reverse()) {
        const key = `${repo}@${sha}`;
        let c = keptCommit(ctx.kept?.get(key));
        if (!c) {
          const d = await fetchJson<CommitDetail>(ctx, `${base}/repos/${repo}/commits/${sha}`, { headers });
          const at = d.commit.committer?.date;
          c = { sha: d.sha, ...(at ? { at: new Date(at).toISOString() } : {}), title: d.commit.message.split('\n')[0]!.slice(0, 500), files: (d.files ?? []).slice(0, 300).map((f) => ({ path: f.filename, ...(cut(f.patch) !== undefined ? { patch: cut(f.patch)! } : {}) })) };
          ctx.kept?.set(key, c);
          read++;
        }
        commits.push({ ...c, files: c.files.filter((f) => watches(config.paths, f.path)) });
      }
      const head = commits[commits.length - 1]?.sha;
      log.info('git history read', { repository: repo, branch, commits: commits.length, read });
      if (head === undefined) continue;
      yield { source: 'git', observed: ctx.now().toISOString(), partial: true, entities: [], relations: [], changes: [{ repository: `${host}/${repo}`, branch, head, commits }] };
    }
  },
};
