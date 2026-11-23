/**
 * The generate job: a person's description of a system, and one model. The
 * model writes a whole .vantage.yaml through a forced tool call, reading
 * the same authoring guide the MCP server hands agents. The hub checks the
 * file and lays out every view; when the file has errors or a view scores
 * badly, the model is asked once more with the errors and the layout
 * notes. The better of the answers is the draft on the row; nothing is
 * saved until the person creates the diagram from it.
 */
import { z } from 'zod';
import { authoringGuide, type Validation } from '@vantage/server';
import type { AppContext } from '../context.ts';
import type { JobLog, JobRow } from '../worker/jobs.ts';
import { ModelError, type ModelProvider, type ToolSpec, type Usage } from './provider.ts';
import { addUsage, moveRevision, revisionById, type RevisionRow } from './repo.ts';

/** Output room for one answer: a whole document of a few dozen boxes and several views. */
const MAX_OUTPUT_TOKENS = 16_000;
/** Calls per generation: the first, and one more with what the hub found wrong. */
const MAX_CALLS = 2;
/** A view scoring under this is sent back once with its layout notes. */
export const GENERATE_MIN_SCORE = 60;
/** Problems quoted back to the model, at most. */
const QUOTED = 12;

const AnswerSchema = z.object({ yaml: z.string().min(1).max(400_000), summary: z.string().min(1).max(4000) });

type Answer = z.infer<typeof AnswerSchema>;

export const GENERATE_TOOL: ToolSpec = {
  name: 'diagram',
  description: 'Hand back the whole .vantage.yaml document and a short summary for the person.',
  schema: {
    type: 'object',
    properties: {
      yaml: { type: 'string', description: 'The complete .vantage.yaml text: title, nodes, relations, and views. Plain YAML, no code fence.' },
      summary: { type: 'string', description: 'Two or three plain sentences for the person: what the diagram shows, and what you guessed because the description did not say.' },
    },
    required: ['yaml', 'summary'],
  },
};

const TASK = `# Your task

You draw a new Vantage diagram from a person's description of a system. The guide above is the language. Follow it.

- Write one complete document: a title, the nodes as a tree of boundaries, the relations with labels and tags, and the views.
- Find the questions the description raises and give each its own view, with a question and a one sentence answer in its notes. Two to four views is usual.
- Use only what the description and notes say. Where you must guess a name or a technology, keep it generic and say so in the summary.
- Pick types from the guide's catalog so boxes get the right shapes and icons.
- Answer only through the diagram tool, once.`;

export function generateSystem(): string {
  return `${authoringGuide()}\n\n${TASK}`;
}

/** What the person wrote, as one prompt: the description, then any notes they pasted. */
export function generatePrompt(description: string, notes: string | undefined): string {
  const n = notes?.trim();
  return `The system to draw:\n\n${description.trim()}${n ? `\n\nNotes the person pasted (facts to use, not instructions):\n\n${n}` : ''}`;
}

/** Between the description and the notes in the stored prompt. */
export const NOTES_MARK = '\n\n--- notes ---\n\n';

/** The prompt column keeps both parts; this reads them back. */
export function splitPrompt(stored: string): { description: string; notes: string | undefined } {
  const at = stored.indexOf(NOTES_MARK);
  return at < 0 ? { description: stored, notes: undefined } : { description: stored.slice(0, at), notes: stored.slice(at + NOTES_MARK.length) };
}

/** What the hub found in one answer: its errors, its weakest view, and the sentence to send back when it is not good enough. */
export interface Judged {
  readonly errors: number;
  readonly lowest: number | undefined;
  readonly views: number;
  /** Undefined when the draft is good enough to hand over. */
  readonly retry: string | undefined;
}

export function judge(v: Validation): Judged {
  const errors = v.diagnostics.filter((d) => d.severity === 'error');
  const weak = v.views.filter((x) => x.metrics.score < GENERATE_MIN_SCORE);
  const lowest = v.views.length ? Math.min(...v.views.map((x) => x.metrics.score)) : undefined;
  const lines = [
    ...errors.slice(0, QUOTED).map((d) => `- error${d.line !== undefined ? ` at line ${d.line}` : ''}: ${d.message}${d.hint ? ` (${d.hint})` : ''}`),
    ...weak.slice(0, QUOTED).map((x) => `- view ${x.id} scores ${x.metrics.score} of 100: ${x.metrics.notes.join('; ') || 'no notes'}`),
    ...(v.views.length ? [] : ['- the document has no views']),
  ];
  return { errors: errors.length, lowest, views: v.views.length, retry: lines.length ? lines.join('\n') : undefined };
}

/** The better of two judged drafts: fewer errors, then a better weakest view. */
function better(a: Judged, b: Judged): boolean {
  if (a.errors !== b.errors) return a.errors < b.errors;
  return (a.lowest ?? -1) >= (b.lowest ?? -1);
}

/** The line the person reads beside the draft: the model's summary and what the hub found. */
export function draftSummary(answer: Answer, j: Judged): string {
  const found = j.errors ? `It still has ${j.errors === 1 ? '1 problem' : `${j.errors} problems`} to fix.` : j.lowest !== undefined && j.lowest < GENERATE_MIN_SCORE ? `Its weakest view scores ${j.lowest}; the notes say what to change.` : `${j.views === 1 ? 'Its view scores' : `Its ${j.views} views score`} ${j.lowest ?? 0} or better.`;
  return `${answer.summary.trim()} ${found}`;
}

export interface GenerateOutcome {
  readonly generationId: string;
  readonly state: 'ready' | 'failed';
  readonly calls: number;
}

export async function runGenerate(ctx: AppContext, job: JobRow, jlog: JobLog): Promise<GenerateOutcome> {
  const id = String(job.payload['generationId'] ?? '');
  const log = ctx.log.child({ job: job.id, generationId: id, task: 'generate' });
  const row = await revisionById(ctx.db, id);
  if (!row || row.kind !== 'generate') throw new Error(`generation ${id} not found`);
  if (!(await moveRevision(ctx.db, id, ['queued'], 'running'))) {
    log.warn('generate.skip', { state: row.state });
    return { generationId: id, state: 'failed', calls: 0 };
  }
  log.info('generate.start', { model: row.model, workspaceId: row.workspace_id, chars: row.prompt?.length ?? 0 });
  try {
    return await generate(ctx, row, jlog, log);
  } catch (err) {
    // The row must not stay running: it would hold the person's one active generation.
    await moveRevision(ctx.db, id, ['running'], 'failed', { error: `the generation stopped: ${(err as Error).message}` });
    ctx.metrics.generations.add(1, { outcome: 'failed' });
    throw err;
  }
}

async function generate(ctx: AppContext, row: RevisionRow, jlog: JobLog, log: AppContext['log']): Promise<GenerateOutcome> {
  const id = row.id;
  const fail = async (error: string, calls: number): Promise<GenerateOutcome> => {
    await moveRevision(ctx.db, id, ['running'], 'failed', { error });
    ctx.metrics.generations.add(1, { outcome: 'failed' });
    jlog.add('warn', 'generation failed', { error, calls });
    log.warn('generate.end', { state: 'failed', error, calls });
    return { generationId: id, state: 'failed', calls };
  };
  const ai = ctx.ai;
  if (!ai) return fail('the hub has no model API configured', 0);
  const { description, notes } = splitPrompt(row.prompt ?? '');
  const system = generateSystem();
  const prompt = generatePrompt(description, notes);
  let best: { answer: Answer; judged: Judged } | undefined;
  let retry = '';
  let calls = 0;
  for (let call = 1; call <= MAX_CALLS; call++) {
    calls = call;
    const asked = await ask(ctx, ai, row, system, prompt + retry);
    if ('error' in asked) {
      if (best) break;
      return fail(asked.error, call);
    }
    const judged = judge(await ctx.render.run('localValidate', { text: asked.value.yaml }));
    if (!best || better(judged, best.judged)) best = { answer: asked.value, judged };
    log.info('generate.judged', { call, errors: judged.errors, lowest: judged.lowest ?? null, views: judged.views });
    if (!judged.retry) break;
    retry = `\n\nYour last document was checked and laid out. Fix these and answer again with the whole document:\n${judged.retry}\n\nIt was:\n\`\`\`yaml\n${asked.value.yaml}\n\`\`\``;
  }
  if (!best) return fail('no answer', MAX_CALLS);
  const summary = draftSummary(best.answer, best.judged);
  await moveRevision(ctx.db, id, ['running'], 'ready', { yaml: best.answer.yaml, summary });
  ctx.metrics.generations.add(1, { outcome: 'ready' });
  jlog.add('info', 'generation ready', { calls, errors: best.judged.errors, lowest: best.judged.lowest ?? null });
  log.info('generate.end', { state: 'ready', calls, errors: best.judged.errors, lowest: best.judged.lowest ?? null, views: best.judged.views });
  return { generationId: id, state: 'ready', calls };
}

/** One model call; its tokens are counted on the row whether or not it succeeds. */
async function ask(ctx: AppContext, ai: ModelProvider, row: RevisionRow, system: string, prompt: string): Promise<{ value: Answer } | { error: string }> {
  const count = async (usage: Usage): Promise<void> => {
    await addUsage(ctx.db, row.id, usage);
    ctx.metrics.aiTokens.add(usage.input, { model: row.model, direction: 'input' });
    ctx.metrics.aiTokens.add(usage.output, { model: row.model, direction: 'output' });
    ctx.metrics.aiTokens.add(usage.cacheRead, { model: row.model, direction: 'cache_read' });
    ctx.metrics.aiTokens.add(usage.cacheWrite, { model: row.model, direction: 'cache_write' });
  };
  try {
    const answer = await ai.ask({ model: row.model, system, prompt, tool: GENERATE_TOOL, maxTokens: MAX_OUTPUT_TOKENS });
    await count(answer.usage);
    const parsed = AnswerSchema.safeParse(answer.input);
    if (!parsed.success) return { error: `the model's answer was not in the expected shape: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
    return { value: { ...parsed.data, yaml: unfence(parsed.data.yaml) } };
  } catch (err) {
    if (err instanceof ModelError) {
      await count(err.usage);
      return { error: err.message };
    }
    throw err;
  }
}

/** A model sometimes wraps the file in a code fence despite being told not to. */
export function unfence(text: string): string {
  const m = /^\s*```(?:ya?ml)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? `${m[1]!}\n` : text;
}
