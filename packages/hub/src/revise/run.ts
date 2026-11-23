/**
 * The revise job: one document, the open comments a person picked, and one
 * model. The model answers with edit operations through a forced tool
 * call; the hub applies them to the base version the way a patch by path
 * does and checks the result loads with no new errors. When the edits do
 * not apply or add errors, the model is asked once more with the reason.
 * The result is a proposal on the revision row; nothing is saved until
 * the person accepts it.
 */
import { z } from 'zod';
import { authoringGuide } from '@vantage/server';
import type { AppContext } from '../context.ts';
import type { JobLog, JobRow } from '../worker/jobs.ts';
import { applyEdits, EDIT_PATH_RULES, EditOperationSchema, type EditOperation } from '../documents/edit.ts';
import { loadStored, type ImportMap } from '../documents/model.ts';
import { versionById } from '../documents/repo.ts';
import type { CommentRow } from '../comments.ts';
import { ModelError, type ModelProvider, type ToolSpec, type Usage } from './provider.ts';
import { addUsage, moveRevision, revisionById, type RevisionRow } from './repo.ts';

/** Output room for one answer: a long list of edits to a large document. */
const MAX_OUTPUT_TOKENS = 16_000;
/** Calls per revision: the first, and one more with the reason the first did not apply. */
const MAX_CALLS = 2;

const AnswerSchema = z.object({
  operations: z.array(EditOperationSchema).max(500),
  summary: z.string().min(1).max(4000),
  addressed: z.array(z.string()).max(200),
});

type Answer = z.infer<typeof AnswerSchema>;

export const REVISE_TOOL: ToolSpec = {
  name: 'revise',
  description: 'Hand back the edits that carry out the comments, a short summary for the person, and the ids of the comments the edits address.',
  schema: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: `Edit operations applied in order to the document text. ${EDIT_PATH_RULES} {op: set, path, value} sets a key or replaces a list item; {op: add, path, value} appends to the list at path (creating it when missing) or adds keys to the map at path; {op: remove, path} removes a key or an item.`,
        items: {
          type: 'object',
          properties: { op: { type: 'string', enum: ['set', 'add', 'remove'] }, path: { type: 'string' }, value: { description: 'Any YAML value: a string, a number, a list, or a map. Not used by remove.' } },
          required: ['op', 'path'],
        },
      },
      summary: { type: 'string', description: 'Two or three plain sentences for the person: what changed, and any comment you could not carry out and why.' },
      addressed: { type: 'array', items: { type: 'string' }, description: 'Ids of the comments the operations fully carry out.' },
    },
    required: ['operations', 'summary', 'addressed'],
  },
};

const TASK = `# Your task

You revise one Vantage document from review comments people left on it. The guide above is the language. Follow it.

- Carry out what each comment asks, and nothing else. Keep every id, name, view, and line the comments do not touch.
- A comment names its view and the boxes it is about. A box is a node or a group, by id.
- A node without an \`id\` takes the slug of its name. Before you rename one, give it \`id\` with its current id, so the relations and views that name it still find it.
- Answer only through the revise tool, once. Keep the operations as few and as small as the change allows.
- If a comment cannot be done, or is unclear, leave its id out of addressed and say why in the summary.`;

export function reviseSystem(): string {
  return `${authoringGuide()}\n\n${TASK}`;
}

/** The request the model reads: the document and each comment with the view and boxes it points at, by name. */
export function revisePrompt(yaml: string, imports: ImportMap, comments: readonly CommentRow[]): string {
  const model = loadStored(yaml, imports).model;
  const nameOf = (id: string): string => {
    const n = model?.nodes.get(id);
    return n ? `${id} (${n.name})` : id;
  };
  const viewOf = (id: string | null): string => {
    if (!id) return 'the whole document';
    const v = model?.views.find((x) => x.id === id);
    return v ? `view ${id} (${v.title})` : `view ${id}`;
  };
  const lines = comments.map((c) => `- Comment ${c.id}, on ${viewOf(c.view_id)}${c.targets.length ? `, boxes ${c.targets.map(nameOf).join(', ')}` : ''}:\n  ${c.text.replace(/\n/g, '\n  ')}`);
  return `The document:\n\n\`\`\`yaml\n${yaml}\`\`\`\n\nThe comments to carry out:\n\n${lines.join('\n')}`;
}

/** Errors in the loaded text; a revision may not add any. */
function errorCount(yaml: string, imports: ImportMap): number {
  return loadStored(yaml, imports).diagnostics.filter((d) => d.severity === 'error').length;
}

/** Applies an answer to the base text, or says why it cannot stand. */
export function tryAnswer(base: string, imports: ImportMap, answer: Answer): { ok: true; yaml: string } | { ok: false; reason: string } {
  if (!answer.operations.length) return { ok: false, reason: 'the answer had no operations' };
  let yaml: string;
  try {
    yaml = applyEdits(base, answer.operations as EditOperation[]);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const before = errorCount(base, imports);
  const after = loadStored(yaml, imports).diagnostics.filter((d) => d.severity === 'error');
  if (after.length > before) return { ok: false, reason: `the edited document has errors: ${after.slice(0, 5).map((d) => `${d.line ? `line ${d.line}: ` : ''}${d.message}`).join('; ')}` };
  return { ok: true, yaml };
}

export interface ReviseOutcome {
  readonly revisionId: string;
  readonly state: 'ready' | 'failed';
  readonly calls: number;
}

export async function runRevise(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<ReviseOutcome> {
  const id = String(job.payload['revisionId'] ?? '');
  const log = ctx.log.child({ job: job.id, revisionId: id, task: 'revise' });
  const rev = await revisionById(ctx.db, id);
  if (!rev) throw new Error(`revision ${id} not found`);
  if (!(await moveRevision(ctx.db, id, ['queued'], 'running'))) {
    log.warn('revise.skip', { state: rev.state });
    return { revisionId: id, state: 'failed', calls: 0 };
  }
  log.info('revise.start', { documentId: rev.document_id, model: rev.model, comments: rev.comment_ids.length });
  try {
    return await revise(ctx, rev, jlog, log);
  } catch (err) {
    // The row must not stay running: it would hold the document's one active revision.
    await moveRevision(ctx.db, id, ['running'], 'failed', { error: `the revision stopped: ${(err as Error).message}` });
    ctx.metrics.revisions.add(1, { outcome: 'failed' });
    throw err;
  }
}

async function revise(ctx: AppContext, rev: RevisionRow, jlog: JobLog, log: AppContext['log']): Promise<ReviseOutcome> {
  const id = rev.id;
  const fail = async (error: string, calls: number): Promise<ReviseOutcome> => {
    await moveRevision(ctx.db, id, ['running'], 'failed', { error });
    ctx.metrics.revisions.add(1, { outcome: 'failed' });
    jlog.add('warn', 'revision failed', { error, calls });
    log.warn('revise.end', { state: 'failed', error, calls });
    return { revisionId: id, state: 'failed', calls };
  };
  const ai = ctx.ai;
  if (!ai) return fail('the hub has no model API configured', 0);
  const base = rev.base_version_id ? await versionById(ctx.db, rev.base_version_id) : undefined;
  if (!base) return fail('the version the comments were made on is gone', 0);
  const comments = await ctx.db.query<CommentRow>('select * from comments where id = any($1::text[]) and resolved_at is null order by created_at', [rev.comment_ids]);
  if (!comments.length) return fail('every picked comment was resolved or deleted', 0);

  const system = reviseSystem();
  const prompt = revisePrompt(base.yaml, base.imports, comments);
  let retry = '';
  for (let call = 1; call <= MAX_CALLS; call++) {
    const answer = await ask(ctx, ai, rev, system, prompt + retry);
    if ('error' in answer) return fail(answer.error, call);
    const tried = tryAnswer(base.yaml, base.imports, answer.value);
    if (tried.ok) {
      const ids = new Set(comments.map((c) => c.id));
      const addressed = answer.value.addressed.filter((a) => ids.has(a));
      await moveRevision(ctx.db, id, ['running'], 'ready', { yaml: tried.yaml, summary: answer.value.summary, addressed });
      ctx.metrics.revisions.add(1, { outcome: 'ready' });
      jlog.add('info', 'revision ready', { calls: call, operations: answer.value.operations.length, addressed: addressed.length });
      log.info('revise.end', { state: 'ready', calls: call, operations: answer.value.operations.length, addressed: addressed.length });
      return { revisionId: id, state: 'ready', calls: call };
    }
    log.info('revise.retry', { call, reason: tried.reason });
    retry = `\n\nYour last answer could not be used: ${tried.reason}\nIt was:\n${JSON.stringify(answer.value.operations)}\nAnswer again with operations that apply to the document above.`;
    if (call === MAX_CALLS) return fail(`the model's edits could not be used: ${tried.reason}`, call);
  }
  return fail('no answer', MAX_CALLS);
}

/** One model call; its tokens are counted on the revision whether or not it succeeds. */
async function ask(ctx: AppContext, ai: ModelProvider, rev: RevisionRow, system: string, prompt: string): Promise<{ value: Answer } | { error: string }> {
  const count = async (usage: Usage): Promise<void> => {
    await addUsage(ctx.db, rev.id, usage);
    ctx.metrics.aiTokens.add(usage.input, { model: rev.model, direction: 'input' });
    ctx.metrics.aiTokens.add(usage.output, { model: rev.model, direction: 'output' });
    ctx.metrics.aiTokens.add(usage.cacheRead, { model: rev.model, direction: 'cache_read' });
    ctx.metrics.aiTokens.add(usage.cacheWrite, { model: rev.model, direction: 'cache_write' });
  };
  try {
    const answer = await ai.ask({ model: rev.model, system, prompt, tool: REVISE_TOOL, maxTokens: MAX_OUTPUT_TOKENS });
    await count(answer.usage);
    const parsed = AnswerSchema.safeParse(answer.input);
    if (!parsed.success) return { error: `the model's answer was not in the expected shape: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
    return { value: parsed.data };
  } catch (err) {
    if (err instanceof ModelError) {
      await count(err.usage);
      return { error: err.message };
    }
    throw err;
  }
}
