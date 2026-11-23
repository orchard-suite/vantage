/**
 * The model API a revision calls, as a plugin: list the models the key may
 * use, and ask one model for a single structured answer through a forced
 * tool call. The organization configures one API and one key; each model
 * is reached through the wire format its family speaks, so one gateway can
 * serve Anthropic and OpenAI models side by side.
 */
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import { askAnthropic } from './anthropic.ts';
import { askOpenAi } from './openai.ts';

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the tool's input. */
  readonly schema: Record<string, unknown>;
}

export interface ToolRequest {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly tool: ToolSpec;
  readonly maxTokens: number;
}

/** Tokens one call spent. Input is fresh input only; cached input is counted apart because it is billed apart. */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Every token a call spent, the way limits count them. */
export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite;
}

export interface ToolAnswer {
  /** The tool input the model wrote, not yet checked against the schema. */
  readonly input: unknown;
  readonly usage: Usage;
}

export interface ModelProvider {
  readonly defaultModel: string;
  /** Model ids the key may use, the default first; the default alone when the API cannot list them. */
  models(): Promise<string[]>;
  ask(req: ToolRequest): Promise<ToolAnswer>;
}

/** A failed call to the model API, with what to tell the person who asked. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    /** Tokens the failed call still spent. */
    readonly usage: Usage = NO_USAGE,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** One POST to the model API with the organization's key, answering parsed JSON or throwing a ModelError. */
export type ModelHttp = (path: string, body: Record<string, unknown>, headers?: Record<string, string>) => Promise<Record<string, unknown>>;

const CALL_TIMEOUT_MS = 180_000;
const MODELS_TTL_MS = 10 * 60_000;

/** The wire format a model speaks: Anthropic's Messages API for Claude models, OpenAI's Responses API for the rest. */
export function wireFor(model: string): 'anthropic' | 'openai' {
  return /^claude/i.test(model) ? 'anthropic' : 'openai';
}

export function providerFromConfig(config: Config, fetchImpl: typeof fetch, log: Logger): ModelProvider | undefined {
  const base = config.AI_BASE_URL;
  const key = config.AI_API_KEY;
  const defaultModel = config.AI_MODEL;
  if (!base || !key || !defaultModel) return undefined;
  const auth: Record<string, string> = config.AI_KEY_HEADER.toLowerCase() === 'authorization' ? { authorization: `Bearer ${key}` } : { [config.AI_KEY_HEADER]: key };
  let listed: { at: number; models: string[] } | undefined;

  const http: ModelHttp = async (path, body, headers = {}) => {
    const res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }).catch((err: unknown) => {
      throw new ModelError(`the model API did not answer: ${(err as Error).message}`, undefined);
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ModelError(refusal(res.status, json), res.status);
    return json;
  };

  return {
    defaultModel,
    async models() {
      if (listed && Date.now() - listed.at < MODELS_TTL_MS) return listed.models;
      try {
        const res = await fetchImpl(`${base}/models`, { headers: auth, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as { data?: { id?: unknown }[] };
        const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
        listed = { at: Date.now(), models: [defaultModel, ...ids.filter((id) => id !== defaultModel).sort()] };
        log.info('ai.models', { count: ids.length });
      } catch (err) {
        log.warn('ai.models.failed', { error: (err as Error).message });
        return [defaultModel];
      }
      return listed.models;
    },
    async ask(req) {
      const wire = wireFor(req.model);
      const started = Date.now();
      log.info('ai.call.start', { model: req.model, wire, tool: req.tool.name });
      try {
        const answer = wire === 'anthropic' ? await askAnthropic(http, req) : await askOpenAi(http, req);
        log.info('ai.call.end', { model: req.model, wire, ms: Date.now() - started, inputTokens: answer.usage.input, outputTokens: answer.usage.output, cacheReadTokens: answer.usage.cacheRead, cacheWriteTokens: answer.usage.cacheWrite });
        return answer;
      } catch (err) {
        log.warn('ai.call.failed', { model: req.model, wire, ms: Date.now() - started, status: err instanceof ModelError ? err.status : undefined, error: (err as Error).message });
        throw err;
      }
    },
  };
}

/** What to say about a refused call; the API's own message when it gives one. */
function refusal(status: number, json: Record<string, unknown>): string {
  const err = json['error'];
  const said = typeof err === 'string' ? err : typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : undefined;
  if (status === 401 || status === 403) return `the model API refused the organization's key (${status})${said ? `: ${said}` : ''}`;
  if (status === 429) return `the model API is over its limit; try again later${said ? ` (${said})` : ''}`;
  return `the model API answered ${status}${said ? `: ${said}` : ''}`;
}
