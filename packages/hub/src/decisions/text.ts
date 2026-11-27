/** What the record tools answer an agent: one line per record or registry, and the report of a move, a discard, or an import. A record's own text form is text/record-text.ts. */
import { STANCE_LABEL, STATUS_LABEL, type Alignment, type Decision, type Registry } from './types.ts';
import { schemeText } from './numbering.ts';
import type { ImportReport } from './import-apply.ts';
import type { MoveReport } from './move.ts';
import { pointerLine, type DiscardReport } from './discard.ts';

export function alignmentText(a: Alignment): string {
  return [STANCE_LABEL[a.stance], a.rule, a.note ? `: ${a.note}` : ''].filter(Boolean).join(' ').replace(' :', ':');
}

export function moveText(r: MoveReport, publicUrl: string): string {
  const out = [`${r.dryRun ? 'Would move' : 'Moved'} ${r.from} to ${r.to} (${publicUrl}${r.url}). ${r.from} ${r.dryRun ? 'would stay' : 'stays'} an alias that resolves to it, and no other record takes the number.`];
  const line = (x: MoveReport['rewritten'][number]): string => `- ${x.kind} ${x.source} (${x.title}): ${x.places.join(', ')}${x.reason ? `. ${x.reason}` : ''}`;
  out.push('', r.dryRun ? 'Would rewrite:' : 'Rewrote:', ...(r.rewritten.length ? r.rewritten.map(line) : ['- nothing']));
  if (r.cannot.length) out.push('', r.dryRun ? 'Cannot rewrite (the alias keeps them resolving):' : 'Could not rewrite (the alias keeps them resolving):', ...r.cannot.map(line));
  if (r.hidden) out.push('', `${r.hidden} more cite it in places you cannot open; the alias keeps them resolving.`);
  if (r.followed) out.push('', `${r.followed} cite it by id (Related, governs links, adr:<ULID>) and follow on their own.`);
  return out.join('\n');
}

export function discardText(r: DiscardReport): string {
  if (r.discarded) return `Discarded ${r.ref} (${r.title}). Its number is free for the next record in its category. The audit log keeps its whole text.`;
  if (!r.pointers.length && !r.hidden) return `${r.ref} (${r.title}) can be discarded: nothing points to it, and every revision is yours. Its number would be free for the next record in its category.`;
  const out = [`${r.ref} (${r.title}) cannot be discarded. Retire it instead: set its status to deprecated, or supersede it with vantage_decision_supersede. What points to it:`, ...r.pointers.map((x) => `- ${pointerLine(x)}`)];
  if (r.hidden) out.push(`- ${r.hidden} more in places you cannot open`);
  return out.join('\n');
}

export function listLine(d: Decision): string {
  return `${d.ref}  ${STATUS_LABEL[d.status].padEnd(10)}  ${d.updatedOn}  ${d.categoryName}: ${d.title}`;
}

export function registryLine(r: Registry): string {
  return `${r.prefix}  ${r.name}  (workspace ${r.workspace}; categories ${schemeText(r.categories)})`;
}

export function importText(r: ImportReport, publicUrl: string): string {
  const out = [`${r.dryRun ? 'Would import' : 'Imported'} ${r.imported.length} into ${r.registry}; ${r.existing.length} already there; ${r.skipped.length} skipped.`];
  if (r.imported.length) out.push('', r.dryRun ? 'Would import:' : 'Imported:', ...r.imported.map((x) => `- ${x.path} -> ${x.ref} ${x.status} ${publicUrl}${x.url}`));
  if (r.existing.length) out.push('', 'Already there:', ...r.existing.map((x) => `- ${x.path} -> ${x.ref} ${publicUrl}${x.url}`));
  if (r.skipped.length) out.push('', 'Skipped:', ...r.skipped.map((x) => `- ${x.path}: ${x.reason}`));
  if (r.notes.length) out.push('', 'Could not map:', ...r.notes.map((x) => `- ${x.path}: ${x.note}`));
  return out.join('\n');
}
