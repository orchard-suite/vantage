/**
 * What every hub tool shares: an answer as text, and a guard that turns a
 * refusal into an answer an agent can read. The call itself is measured
 * and logged once, at the door (index.ts), not here.
 */
import type { Logger } from '../log.ts';
import { HttpError } from '../http.ts';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export type ToolResult = { content: Content[]; isError?: boolean };

export const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

/** A refusal as an agent reads it: the status, what was wrong, and each issue on its own line. */
export function refusalText(err: unknown): string {
  if (!(err instanceof HttpError)) return (err as Error).message;
  const issues = Array.isArray(err.details?.['issues']) ? `\n${(err.details['issues'] as string[]).map((i) => `- ${i}`).join('\n')}` : '';
  return `${err.status}: ${err.message}${issues}`;
}

/** Wraps a tool so that anything it throws comes back as its answer. */
export function guardFor(log: Logger) {
  return <A>(name: string, fn: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return await fn(args);
      } catch (err) {
        const message = refusalText(err);
        log.warn('mcp.tool.failed', { tool: name, error: message });
        return text(message, true);
      }
    };
}
