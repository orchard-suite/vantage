/**
 * How a reader connects an agent to this hub, as the people who run it set
 * it in AGENT_SETUP: one way per assistant the organization offers. A way
 * either runs a command the reader copies (a plugin install), opens a link
 * (an agent's page in Teams), or, for an app that adds a connector by its
 * address and signs in through the hub (Claude Desktop), gives the address
 * to paste. With no ways set, the reader gets the hub's MCP address, the one
 * thing every agent can use.
 */
import { z } from 'zod';

export const AGENT_CLIENTS = ['claude-code', 'claude-desktop', 'copilot', 'other'] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

/** What each assistant is called when a way names none. */
const CLIENT_NAME: Record<AgentClient, string> = { 'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', copilot: 'Microsoft Copilot', other: 'Your agent' };

/** What an open button says when a way names nothing: Copilot lives in Teams. */
const OPEN_LABEL: Record<AgentClient, string> = { 'claude-code': 'Open', 'claude-desktop': 'Open', copilot: 'Open in Teams', other: 'Open' };

/** A way as AGENT_SETUP writes it. */
export const AgentWaySchema = z
  .object({
    client: z.enum(AGENT_CLIENTS),
    /** The assistant's name, when it is not the client's usual one. */
    name: z.string().trim().min(1).max(40).optional(),
    /** One line under the name: where to run the command, or what the link does. */
    hint: z.string().trim().min(1).max(200).optional(),
    /** A command the reader copies and runs. */
    run: z.string().trim().min(1).max(400).optional(),
    /** A link the reader opens; https only. */
    open: z.url({ protocol: /^https$/ }).optional(),
    /** The open button's words. */
    label: z.string().trim().min(1).max(40).optional(),
  })
  .strict()
  .refine((w) => !(w.run && w.open), 'a way has at most one of run and open')
  .refine((w) => Boolean(w.run || w.open) || w.client === 'claude-desktop', 'a way needs run or open, except claude-desktop, which pastes the hub address');

/** AGENT_SETUP: a JSON array of ways, read once at start. */
export const AgentSetupSchema = z
  .string()
  .default('[]')
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'AGENT_SETUP must be a JSON array of ways' });
      return z.NEVER;
    }
  })
  .pipe(z.array(AgentWaySchema).max(6));

export type AgentAction = { readonly kind: 'run'; readonly command: string } | { readonly kind: 'open'; readonly href: string; readonly label: string } | { readonly kind: 'connector'; readonly url: string };

/** What a connector way says above the address, unless it names its own hint. */
const CONNECTOR_HINT = 'In Claude, open Settings, then Connectors. Add a custom connector, paste this address, and sign in when it asks.';

export interface AgentWay {
  readonly client: AgentClient;
  readonly name: string;
  readonly hint?: string;
  readonly action: AgentAction;
}

/** Everything the sidebar needs to tell a reader how to connect an agent. */
export interface AgentSetup {
  readonly mcpUrl: string;
  readonly ways: readonly AgentWay[];
}

export function agentSetup(publicUrl: string, ways: readonly z.output<typeof AgentWaySchema>[]): AgentSetup {
  const mcpUrl = `${publicUrl}/mcp`;
  const action = (w: z.output<typeof AgentWaySchema>): AgentAction =>
    w.run ? { kind: 'run', command: w.run } : w.open ? { kind: 'open', href: w.open, label: w.label ?? OPEN_LABEL[w.client] } : { kind: 'connector', url: mcpUrl };
  return {
    mcpUrl,
    ways: ways.map((w) => {
      const act = action(w);
      const hint = w.hint ?? (act.kind === 'connector' ? CONNECTOR_HINT : undefined);
      return { client: w.client, name: w.name ?? CLIENT_NAME[w.client], ...(hint ? { hint } : {}), action: act };
    }),
  };
}
