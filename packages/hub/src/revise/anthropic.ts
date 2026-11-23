/** Anthropic's Messages API: one user turn, the tool forced, its input read back. */
import { ModelError, type ModelHttp, type ToolAnswer, type ToolRequest } from './provider.ts';

interface Content {
  readonly type: string;
  readonly name?: string;
  readonly input?: unknown;
}

export async function askAnthropic(http: ModelHttp, req: ToolRequest): Promise<ToolAnswer> {
  const json = await http(
    '/messages',
    {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema }],
      tool_choice: { type: 'tool', name: req.tool.name },
    },
    { 'anthropic-version': '2023-06-01' },
  );
  const u = (json['usage'] ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  if (json['stop_reason'] === 'max_tokens') throw new ModelError('the answer was cut off before it finished; ask for fewer changes at once', undefined, usage);
  const call = ((json['content'] ?? []) as Content[]).find((c) => c.type === 'tool_use' && c.name === req.tool.name);
  if (!call) throw new ModelError('the model answered without the tool call', undefined, usage);
  return { input: call.input, usage };
}
