/**
 * The git connector's reads from GitHub or a GitHub Enterprise server. It
 * signs in with a token or as a GitHub App (`../github/app.ts`); an app's
 * token asks only for contents and metadata.
 */
import { fetchJson, type ConnectorContext } from '../../connector.ts';
import { githubSigner, type GithubApp, type GithubPermissions } from '../github/app.ts';
import { listed, type Forge } from './forge.ts';

interface CommitDetail {
  sha: string;
  commit: { message: string; committer?: { date?: string } | null };
  files?: { filename: string; patch?: string }[];
}

/** What reading commits and their diffs needs, and nothing more. */
export const GIT_PERMISSIONS: GithubPermissions = { contents: 'read', metadata: 'read' };

/** The host a repository is named under: github.com for the public API, the server's own host for Enterprise. */
export function repositoryHost(apiUrl: string): string {
  const u = new URL(apiUrl);
  return u.hostname === 'api.github.com' ? 'github.com' : u.hostname;
}

export async function githubForge(ctx: ConnectorContext<{ token?: string | undefined; app?: GithubApp | undefined }>, base: string): Promise<Forge> {
  const signer = await githubSigner(ctx, base, GIT_PERMISSIONS);
  return {
    host: repositoryHost(base),
    async repository(repo) {
      const headers = await signer(repo);
      const get = <T>(path: string): Promise<T> => fetchJson<T>(ctx, `${base}/repos/${repo}${path}`, { headers });
      return {
        defaultBranch: async () => (await get<{ default_branch: string }>('')).default_branch,
        list: async (branch, depth) => (await listed(depth, (n, per) => get<{ sha: string }[]>(`/commits?sha=${encodeURIComponent(branch)}&per_page=${per}&page=${n}`))).map((r) => r.sha),
        async commit(sha) {
          const d = await get<CommitDetail>(`/commits/${sha}`);
          const at = d.commit.committer?.date;
          return { sha: d.sha, ...(at ? { at } : {}), message: d.commit.message, files: (d.files ?? []).map((f) => ({ path: f.filename, ...(f.patch !== undefined ? { patch: f.patch } : {}) })) };
        },
      };
    },
  };
}
