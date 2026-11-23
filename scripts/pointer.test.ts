import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The pointer resolver and the session hook are shell scripts the plugin
// ships; these run them against throwaway repositories.
const SCRIPTS = import.meta.dir;
const scratch = mkdtempSync(join(tmpdir(), 'vantage-pointer-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ESTATE = `# Which Vantage hub and workspace each repository's docs live in.
- match: github.com/acme-tools/*
  hub: https://vantage.example.com
  workspace: tools
- match: github.com/acme-tools/special
  hub: https://vantage.example.com
  workspace: special
- match: "gitlab.example.com/*"   # a whole forge
  hub: 'https://hub.example.org'
  workspace: forge
`;
const estateFile = join(scratch, 'repos.yaml');
writeFileSync(estateFile, ESTATE);

let n = 0;
/** A fresh repository with the given origin and, when given, a vantage.yaml. */
function repo(origin: string | undefined, pointer?: string): string {
  const dir = join(scratch, `repo-${n++}`);
  mkdirSync(dir);
  const git = (...args: string[]): void => {
    const r = Bun.spawnSync(['git', '-C', dir, ...args]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  git('init', '-q');
  if (origin) git('remote', 'add', 'origin', origin);
  if (pointer !== undefined) writeFileSync(join(dir, 'vantage.yaml'), pointer);
  return dir;
}

const env = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: process.env['PATH'] ?? '', HOME: scratch, XDG_CONFIG_HOME: join(scratch, 'config'), VANTAGE_REPOS_CONFIG: estateFile, ...extra });

function resolve(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const out = Bun.spawnSync(['sh', join(SCRIPTS, 'pointer.sh'), dir], { env: env(extra) }).stdout.toString();
  return Object.fromEntries(out.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
}

function hook(dir: string): string {
  return Bun.spawnSync(['sh', join(SCRIPTS, 'onboard-check.sh')], { env: env({ CLAUDE_PROJECT_DIR: dir }) }).stdout.toString().trim();
}

describe('pointer resolver', () => {
  test('a repository key is its remote without scheme, user, port, or .git, in lower case', () => {
    expect(resolve(repo('git@github.com:Acme/App.git'))['repository']).toBe('github.com/acme/app');
    expect(resolve(repo('https://user:token@GitHub.com/Acme/App.git/'))['repository']).toBe('github.com/acme/app');
    expect(resolve(repo('ssh://git@gitlab.example.com:2222/Team/Tool.git'))['repository']).toBe('gitlab.example.com/team/tool');
  });

  test('the most specific match in the estate file names the hub and workspace', () => {
    expect(resolve(repo('git@github.com:acme-tools/widgets.git'))).toMatchObject({ hub: 'https://vantage.example.com', workspace: 'tools', from: estateFile, pointer: 'none' });
    expect(resolve(repo('git@github.com:acme-tools/special.git'))).toMatchObject({ workspace: 'special' });
    expect(resolve(repo('https://gitlab.example.com/team/tool'))).toMatchObject({ hub: 'https://hub.example.org', workspace: 'forge' });
  });

  test('a prefix matches only below its folder', () => {
    const r = resolve(repo('git@github.com:acme-toolsmith/app.git'));
    expect(r['hub']).toBeUndefined();
    expect(r['workspace']).toBeUndefined();
  });

  test('vantage.yaml keeps what is true in any estate, and its own hub and workspace win', () => {
    const shared = resolve(repo('git@github.com:acme-tools/widgets.git', 'document: widgets\ndecisions: WID\nwatch:\n  - src/\n'));
    expect(shared).toMatchObject({ hub: 'https://vantage.example.com', workspace: 'tools', pointer: 'present', document: 'widgets', decisions: 'WID' });
    const own = resolve(repo('git@github.com:acme-tools/widgets.git', 'hub: https://own.example.net  # the estate is this repository\nworkspace: own\ndocument: widgets\n'));
    expect(own).toMatchObject({ hub: 'https://own.example.net', workspace: 'own', from: 'vantage.yaml', document: 'widgets' });
  });

  test('with no estate file, no remote, or a declined pointer, it says what it knows', () => {
    expect(resolve(repo('git@github.com:acme-tools/widgets.git'), { VANTAGE_REPOS_CONFIG: join(scratch, 'missing.yaml') })).toEqual({ repository: 'github.com/acme-tools/widgets', pointer: 'none' });
    expect(resolve(repo(undefined))).toEqual({ pointer: 'none' });
    expect(resolve(repo('git@github.com:acme/app.git', 'vantage: false\n'))).toEqual({ repository: 'github.com/acme/app', pointer: 'declined' });
  });

  test('outside a repository it prints nothing', () => {
    const plain = join(scratch, 'plain');
    mkdirSync(plain);
    expect(resolve(plain)).toEqual({});
  });
});

describe('session hook', () => {
  test('is silent where the docs are wired, through either file, and where they were declined', () => {
    expect(hook(repo('git@github.com:acme-tools/widgets.git', 'document: widgets\n'))).toBe('');
    expect(hook(repo('git@github.com:acme/app.git', 'hub: https://own.example.net\nworkspace: own\ndocument: app\n'))).toBe('');
    expect(hook(repo('git@github.com:acme/app.git', 'vantage: false\n'))).toBe('');
  });

  test('says when vantage.yaml names a document but nothing names its hub', () => {
    expect(hook(repo('git@github.com:acme/app.git', 'document: app\n'))).toContain('no hub and workspace are mapped for github.com/acme/app');
  });

  test('offers onboarding where there is no vantage.yaml, and names the mapped hub', () => {
    expect(hook(repo('git@github.com:acme/app.git'))).toContain('has no vantage.yaml');
    expect(hook(repo('git@github.com:acme-tools/widgets.git'))).toContain('This estate maps it to workspace tools on https://vantage.example.com.');
  });
});
