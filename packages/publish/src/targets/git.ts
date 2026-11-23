/**
 * A git repository: clone or fetch, write the artifacts under a path,
 * commit, push. GitHub Pages, a docs repository, Backstage TechDocs. The
 * token (secret ref) is used only in the remote URL for the push and never
 * written to disk.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { timed, type Target, type TargetContext } from '../target.ts';

const Config = z
  .object({
    url: z.string().min(1).describe('HTTPS remote URL'),
    branch: z.string().default('main'),
    path: z.string().default('diagrams').describe('Folder inside the repository'),
    secret: z.string().optional().describe('Secret reference holding a token for the push; omit for a remote that needs none'),
    workdir: z.string().describe('Local checkout directory the hub may reuse between runs'),
    message: z.string().default('docs: publish diagrams'),
  })
  .strict();

type Config = z.output<typeof Config>;

async function git(ctx: TargetContext<Config>, cwd: string, args: string[], redact?: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  const shown = redact ? args.map((a) => a.replaceAll(redact, '***')) : args;
  ctx.log.debug('git', { args: shown, code });
  if (code !== 0) throw new Error(`git ${shown.join(' ')} failed: ${(err || out).replaceAll(redact ?? '\u0000', '***').trim()}`);
  return out;
}

export const gitTarget: Target<Config> = {
  id: 'git',
  description: 'Commit artifacts into a git repository branch',
  configSchema: Config,
  async publish(ctx, artifacts) {
    const c = ctx.config;
    const token = c.secret ? await ctx.secrets(c.secret) : undefined;
    const remote = token ? c.url.replace(/^https:\/\//, `https://x-access-token:${token}@`) : c.url;
    ctx.log.info('publish start', { target: 'git', url: c.url, branch: c.branch, path: c.path, artifacts: artifacts.length });
    return timed('git', async () => {
      mkdirSync(dirname(c.workdir), { recursive: true });
      if (!existsSync(join(c.workdir, '.git'))) {
        await git(ctx, dirname(c.workdir), ['clone', '--depth', '1', '--branch', c.branch, remote, c.workdir], token);
      } else {
        await git(ctx, c.workdir, ['fetch', '--depth', '1', remote, c.branch], token);
        await git(ctx, c.workdir, ['checkout', '-B', c.branch, 'FETCH_HEAD']);
      }
      const dir = join(c.workdir, c.path);
      mkdirSync(dir, { recursive: true });
      const written = artifacts.map((a) => {
        const file = join(dir, a.filename);
        writeFileSync(file, a.bytes);
        return { artifact: a.filename, location: `${c.url}/blob/${c.branch}/${c.path}/${a.filename}`, bytes: a.bytes.byteLength };
      });
      await git(ctx, c.workdir, ['add', '-A', c.path]);
      const status = await git(ctx, c.workdir, ['status', '--porcelain', c.path]);
      if (!status.trim()) {
        ctx.log.info('publish end: nothing changed', { target: 'git' });
        return { written: [], skipped: written.map((w) => ({ artifact: w.artifact, reason: 'unchanged' })) };
      }
      await git(ctx, c.workdir, ['-c', 'user.name=vantage', '-c', 'user.email=vantage@localhost', 'commit', '-q', '-m', `${c.message} (${artifacts[0]?.stamp.version ?? 'unknown'})`]);
      await git(ctx, c.workdir, ['push', remote, `HEAD:${c.branch}`], token);
      ctx.log.info('publish end', { target: 'git', written: written.length });
      return { written, skipped: [] };
    }, ctx.now);
  },
};
