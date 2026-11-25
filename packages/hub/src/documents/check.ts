/**
 * The gate every save passes: a document checked whole, its pages
 * included, as the version would hold them. A document with errors saves
 * nothing and answers each error with its code, path, and line, so the
 * writer fixes what it wrote instead of publishing a page that shows
 * readers an error banner. Warnings save. A decision record the boxes or
 * pages cite must exist in one of the organization's registries; one cited
 * by a number it held before it moved passes, with a warning that names its
 * citation now.
 */
import { topicOf } from '@vantage/model';
import type { AppContext } from '../context.ts';
import { HttpError } from '../http.ts';
import type { CheckOutput, Finding } from '../render/tasks.ts';
import { resourceInputs, type Attachment } from './assets.ts';
import type { ImportMap } from './model.ts';
import { refOf, resolveRefs } from '../decisions/repo.ts';

/** What every route that writes a version says about the check it passes. */
export const REFUSES = 'A version with errors (text that does not parse, a type neither built in nor declared, a name that points at nothing) is refused with 422 and saves nothing; details.errors lists each with its code, message, path, and line. Warnings save';
export const REFUSED = { '422': 'the document has errors; nothing was saved, and details.errors lists them' } as const;

/** The most errors a refusal spells out in its message; its details carry every one. */
const LISTED = 20;

export interface CheckScope {
  readonly orgId: string;
  readonly workspaceId: string;
  /** Files the version holds that are already stored; `files` in the text lay over them by path. */
  readonly attachments?: readonly Attachment[] | undefined;
}

export interface CheckText {
  readonly yaml: string;
  readonly imports?: ImportMap | undefined;
  readonly files?: Readonly<Record<string, Uint8Array>> | undefined;
  readonly scores?: boolean | undefined;
  /** Also answer what a save takes from the model. */
  readonly save?: boolean | undefined;
}

/** Marks the end of a named phase, for a caller that times its own. */
export type Lap = (phase: string) => void;

export async function checkDocument(ctx: AppContext, scope: CheckScope, text: CheckText, lap: Lap = () => undefined): Promise<CheckOutput> {
  const held = await resourceInputs(ctx, { orgId: scope.orgId, workspaceId: scope.workspaceId, attachments: scope.attachments ?? [] });
  const resources = { ...held, files: { ...held.files, ...(text.files ?? {}) } };
  lap('check.resources');
  const out = await ctx.render.run('check', { yaml: text.yaml, imports: text.imports, resources, scores: text.scores, save: text.save });
  lap('check.document');
  // Every citation in one lookup: a record cited by its old number passes with a warning, one that is nowhere fails.
  const found = await resolveRefs(ctx.db, scope.orgId, out.decisions);
  const missing = out.decisions.filter((cited) => !found.has(cited));
  const moved: Finding[] = [];
  for (const cited of out.decisions) {
    const hit = found.get(cited);
    if (hit?.alias) moved.push({ code: 'decision-moved', message: `decision ${cited} moved; it is ${refOf(hit.row)} now. The old citation still resolves`, hint: `cite ${refOf(hit.row)}` });
  }
  lap('check.decisions');
  if (!missing.length && !moved.length) return out;
  const unknown = missing.map((r): Finding => ({ code: 'unknown-decision', message: `decision ${r} is not a record in any registry here`, hint: 'cite one that exists (vantage_outline a registry lists them)' }));
  return { ...out, warnings: [...out.warnings, ...moved], errors: [...out.errors, ...unknown] };
}

/** Throws 422 with every error a check found; the message spells them out for a writer that sees only text. */
export function refuseErrors(ctx: AppContext, scope: CheckScope, out: CheckOutput): void {
  if (!out.errors.length) return;
  const n = out.errors.length;
  ctx.log.info('save.refused', { workspaceId: scope.workspaceId, errors: n, codes: [...new Set(out.errors.map((e) => e.code))] });
  const listed = out.errors.slice(0, LISTED).map((e) => `- ${describeFinding(e)}`);
  if (n > LISTED) listed.push(`- and ${n - LISTED} more`);
  throw new HttpError(422, `the document has ${n} error${n === 1 ? '' : 's'}; nothing was saved. Fix ${n === 1 ? 'it' : 'every one'} and save again:\n${listed.join('\n')}`, { errors: out.errors });
}

/** One finding as a line: `unknown-type at nodes[0].type, line 4: node shoppers has unknown type phone. hint`. */
export function describeFinding(f: Finding): string {
  const where = [f.path, f.line !== undefined ? `line ${f.line}` : undefined].filter(Boolean).join(', ');
  const topic = topicOf(f.code);
  return `${f.code}${where ? ` at ${where}` : ''}: ${f.message}${f.hint ? `. ${f.hint}` : ''}${topic ? ` (${topic})` : ''}`;
}
