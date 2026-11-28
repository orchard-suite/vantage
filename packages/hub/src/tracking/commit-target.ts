/**
 * How the hub keeps a commit an item names as proof (VAN-3026): the
 * repository, the hash, and when it landed, in the one link target. A
 * commit never changes, so its target never does either.
 */

export interface CommitProof {
  /** host/owner/name, as the git connector names it. */
  readonly repository: string;
  readonly sha: string;
  /** When it landed on the branch, as an ISO time. */
  readonly at: string;
}

const PREFIX = 'commit:';

export const isCommitTarget = (target: string): boolean => target.startsWith(PREFIX);

/** The part of a target that names one commit, whatever time it carries. */
export const commitPrefix = (repository: string, sha: string): string => `${PREFIX}${repository}@${sha}@`;

export const commitTarget = (c: CommitProof): string => `${commitPrefix(c.repository, c.sha)}${c.at}`;

export function parseCommitTarget(target: string): CommitProof | undefined {
  const m = /^commit:(.+)@([0-9a-f]{7,64})@(.+)$/.exec(target);
  return m ? { repository: m[1]!, sha: m[2]!, at: m[3]! } : undefined;
}

/** A commit in the words people use: repository@short-hash and the day it landed. */
export function commitText(target: string): string {
  const c = parseCommitTarget(target);
  return c ? `commit ${c.repository}@${c.sha.slice(0, 8)}, landed ${c.at.slice(0, 10)}` : 'a commit';
}
