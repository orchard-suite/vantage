/**
 * The git connector's reads from GitLab, on gitlab.com or a self-hosted
 * server, through API v4. It signs in with a token held as the connector's
 * secret (VAN-2002), sent as `PRIVATE-TOKEN`: a personal, group, or project
 * access token with `read_api` or `read_repository`. Without one it reads
 * public projects only. A project is named by its full path, groups and
 * subgroups included.
 */
import { fetchJson, type ConnectorContext } from '../../connector.ts';
import { listed, PAGE, type Forge } from './forge.ts';

interface ListedCommit {
  id: string;
  message: string;
  committed_date?: string;
}

interface FileDiff {
  new_path: string;
  diff?: string;
}

/** The most files one commit keeps, as the batch allows. */
const FILES_MAX = 300;

/** The host a project is named under: the API's own host, gitlab.com for the cloud. */
export function gitlabHost(apiUrl: string): string {
  return new URL(apiUrl).host;
}

export async function gitlabForge(ctx: ConnectorContext<{ token?: string | undefined }>, base: string): Promise<Forge> {
  const { config, log } = ctx;
  const headers: Record<string, string> = config.token !== undefined ? { 'private-token': await ctx.secrets(config.token) } : {};
  log.debug('gitlab sign-in', { as: config.token !== undefined ? 'token' : 'none' });
  return {
    host: gitlabHost(base),
    async repository(repo) {
      const project = `${base}/projects/${encodeURIComponent(repo)}`;
      const get = <T>(path: string): Promise<T> => fetchJson<T>(ctx, `${project}${path}`, { headers });
      // The list answers each commit's message and time, so a commit not kept costs one more call, for its diff.
      const seen = new Map<string, ListedCommit>();
      return {
        defaultBranch: async () => (await get<{ default_branch: string }>('')).default_branch,
        async list(branch, depth) {
          const rows = await listed(depth, (n, per) => get<ListedCommit[]>(`/repository/commits?ref_name=${encodeURIComponent(branch)}&per_page=${per}&page=${n}`));
          for (const r of rows) seen.set(r.id, r);
          return rows.map((r) => r.id);
        },
        async commit(sha) {
          const c = seen.get(sha) ?? (await get<ListedCommit>(`/repository/commits/${sha}`));
          const files = await listed(FILES_MAX, (n) => get<FileDiff[]>(`/repository/commits/${sha}/diff?per_page=${PAGE}&page=${n}`));
          return { sha: c.id, ...(c.committed_date ? { at: c.committed_date } : {}), message: c.message, files: files.map((f) => ({ path: f.new_path, ...(f.diff ? { patch: f.diff } : {}) })) };
        },
      };
    },
  };
}
