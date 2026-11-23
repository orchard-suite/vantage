/** OpenAI's Responses API: one input, the function forced, its arguments read back. */
import { ModelError, type ModelHttp, type ToolAnswer, type ToolRequest } from './provider.ts';

interface Output {
  readonly type: string;
  readonly name?: string;
  readonly arguments?: string;
}

export async function askOpenAi(http: ModelHttp, req: ToolRequest): Promise<ToolAnswer> {
  const json = await http('/responses', {
    model: req.model,
    instructions: req.system,
    input: req.prompt,
    max_output_tokens: req.maxTokens,
    tools: [{ type: 'function', name: req.tool.name, description: req.tool.description, parameters: req.tool.schema }],
    tool_choice: { type: 'function', name: req.tool.name },
  });
  const u = (json['usage'] ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  // OpenAI counts cached input inside input_tokens; it is taken out so input means fresh input on both wires.
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const usage = { input: (u.input_tokens ?? 0) - cached, output: u.output_tokens ?? 0, cacheRead: cached, cacheWrite: 0 };
  if (json['status'] === 'incomplete') throw new ModelError('the answer was cut off before it finished; ask for fewer changes at once', undefined, usage);
  const call = ((json['output'] ?? []) as Output[]).find((o) => o.type === 'function_call' && o.name === req.tool.name);
  if (!call || typeof call.arguments !== 'string') throw new ModelError('the model answered without the tool call', undefined, usage);
  try {
    return { input: JSON.parse(call.arguments) as unknown, usage };
  } catch {
    throw new ModelError('the model wrote tool arguments that are not JSON', undefined, usage);
  }
}
