/**
 * What the git connector needs from a forge, and nothing more: a
 * repository's default branch, the commits on a branch newest first, and
 * one commit's message, time, and files. Each forge signs in its own way
 * and answers in its own shape; the connector reads them all the same.
 */

/** One commit as a forge answers it, before the connector cuts and keeps it. */
export interface ForgeCommit {
  readonly sha: string;
  /** When it landed on the branch, as the forge reports it. */
  readonly at?: string;
  readonly message: string;
  readonly files: readonly { readonly path: string; readonly patch?: string }[];
}

/** Reads one repository, signed in for it. */
export interface RepositoryReader {
  defaultBranch(): Promise<string>;
  /** The newest commits on the branch, newest first, at most `depth`. */
  list(branch: string, depth: number): Promise<string[]>;
  commit(sha: string): Promise<ForgeCommit>;
}

/** A forge for one run: the host its repositories are named under, and a reader per repository. */
export interface Forge {
  readonly host: string;
  repository(repo: string): Promise<RepositoryReader>;
}

/** The most commits one list call asks for; both forges cap a page at 100. */
export const PAGE = 100;

/** Pages through a newest-first list until it has `depth` rows or the forge runs out. */
export async function listed<T>(depth: number, page: (n: number, per: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let n = 1; out.length < depth; n++) {
    const per = Math.min(PAGE, depth - out.length);
    const rows = await page(n, per);
    out.push(...rows);
    if (rows.length < per) break;
  }
  return out;
}
