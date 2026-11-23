/**
 * Line-based three-way merge for concurrent saves, and unified diffs for
 * history and conflicts. YAML is text here; a merge that touches the same
 * lines is a conflict and the caller returns it as a diff.
 */
import { diff3Merge } from 'node-diff3';
import { createTwoFilesPatch } from 'diff';

export type MergeResult = { ok: true; text: string; changed: boolean } | { ok: false; conflicts: number; preview: string };

/** Merges `theirs` (the saved head) and `ours` (the incoming text) over the shared `base`. */
export function mergeYaml(base: string, theirs: string, ours: string): MergeResult {
  if (ours === theirs) return { ok: true, text: ours, changed: false };
  const regions = diff3Merge(lines(ours), lines(base), lines(theirs), { excludeFalseConflicts: true, stringSeparator: '\n' });
  const out: string[] = [];
  let conflicts = 0;
  for (const r of regions) {
    if (r.ok) out.push(...r.ok);
    else if (r.conflict) {
      conflicts++;
      out.push('<<<<<<< yours', ...r.conflict.a, '=======', ...r.conflict.b, '>>>>>>> saved');
    }
  }
  const text = out.join('\n') + (ours.endsWith('\n') || theirs.endsWith('\n') ? '\n' : '');
  if (conflicts > 0) return { ok: false, conflicts, preview: text };
  return { ok: true, text, changed: text !== theirs };
}

/** The same merge for any text kept line by line: a page's Markdown. */
export const mergeText = mergeYaml;

export function unifiedDiff(fromLabel: string, from: string, toLabel: string, to: string): string {
  return createTwoFilesPatch(fromLabel, toLabel, from, to, undefined, undefined, { context: 3 });
}

function lines(text: string): string[] {
  const ls = text.split('\n');
  if (ls[ls.length - 1] === '') ls.pop();
  return ls;
}
