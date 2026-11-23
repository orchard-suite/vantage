/**
 * Which ties may be stale: a box or a page section is read from files at a
 * commit, and a later commit on the branch changed one of those files. One
 * fold, with no model call, for the hub (commits a git connector read) and
 * for a laptop (commits from its own clone).
 */
import type { EvidenceTie } from './schema-docs.ts';

export interface CommitFile {
  readonly path: string;
  /** The change to the file, as a unified diff hunk; cut short by whoever read it. */
  readonly patch?: string | undefined;
}

export interface Commit {
  readonly sha: string;
  /** When it landed, ISO 8601. */
  readonly at?: string | undefined;
  readonly title?: string | undefined;
  readonly files: readonly CommitFile[];
}

export interface StaleTie {
  readonly tie: EvidenceTie;
  /**
   * changed: a later commit changed a file the tie reads.
   * unknown: the tie's commit is not in the history read, so every change in it to those files counts.
   */
  readonly why: 'changed' | 'unknown';
  /** The commits that changed the tie's files, oldest first, each with only those files. */
  readonly commits: readonly Commit[];
}

/** Whether a tie's path names a repository file: the same path, a folder ending in `/`, or a pattern where `*` is one segment and `**` any depth. */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  if (!pattern.includes('*')) return false;
  const re = pattern
    .split('**')
    .map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${re}$`).test(path);
}

/**
 * The ties a later commit may have made stale, in tie order. `commits` is
 * the branch's history oldest first, the head last. A tie whose commit is
 * the head, or that no later commit touches, is current.
 */
export function staleTies(ties: readonly EvidenceTie[], commits: readonly Commit[]): StaleTie[] {
  const out: StaleTie[] = [];
  for (const tie of ties) {
    const at = commits.findIndex((c) => c.sha.startsWith(tie.commit) || tie.commit.startsWith(c.sha));
    const after = at >= 0 ? commits.slice(at + 1) : commits;
    const touched = after
      .map((c) => ({ ...c, files: c.files.filter((f) => tie.files.some((p) => pathMatches(p, f.path))) }))
      .filter((c) => c.files.length > 0);
    if (touched.length) out.push({ tie, why: at >= 0 ? 'changed' : 'unknown', commits: touched });
  }
  return out;
}

export interface StaleScope {
  /** The document, as an address or a file. */
  readonly document: string;
  readonly repository: string;
  readonly branch: string;
  readonly head: string;
  /** Every tie the document records, in order, so each stale one is named by its place in `evidence`. */
  readonly ties: readonly EvidenceTie[];
  /** How a reader changes one tie's commit: a sentence that ends with the edit. */
  readonly fix: (index: number, head: string) => string;
}

/**
 * The stale ties as Markdown: one heading per tie, its files, and each
 * commit with its diffs, so a reader can read one tie by its heading.
 */
export function staleMarkdown(stale: readonly StaleTie[], s: StaleScope): string {
  const short = (sha: string): string => sha.slice(0, 7);
  const lines = [`# ${s.document}: ${stale.length} of ${s.ties.length} ties may be stale`, '', `Against ${s.repository} ${s.branch} at ${short(s.head)}.`];
  if (!stale.length) return [...lines, '', 'Every box and section is current with the files it was read from.'].join('\n');
  lines.push('A tie is a box or a page section and the files it was read from. Read the files at the head, fix what is now wrong, then move the tie to the head commit.');
  for (const t of stale) {
    const i = s.ties.indexOf(t.tie);
    lines.push('', `## ${t.tie.to}`, '', `Read ${t.tie.files.join(', ')} at ${short(t.tie.commit)}${t.why === 'unknown' ? ', a commit older than the history read, so every change below counts' : ''}. ${s.fix(i, s.head)}`);
    for (const c of t.commits) {
      lines.push('', `- ${short(c.sha)}${c.at ? ` ${c.at.slice(0, 10)}` : ''} ${c.title ?? ''}: ${c.files.map((f) => f.path).join(', ')}`);
      for (const f of c.files) if (f.patch) lines.push('', '```diff', `# ${f.path}`, f.patch, '```');
    }
  }
  return lines.join('\n');
}
