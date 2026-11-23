/**
 * The sidebar's "Let an agent draw it" box: each way this hub offers to
 * connect an assistant, a command to copy, a link to open, or the address
 * to paste into an app's connector settings. With none set,
 * the hub's MCP address to copy.
 */
import type { AgentSetup, AgentWay } from '../agents.ts';
import { escapeHtml } from './html.ts';
import { ico } from './icons.ts';

function copyRow(value: string, what: string, wrap: boolean): string {
  return `<div class="url${wrap ? ' run' : ''}"><code title="${escapeHtml(value)}">${escapeHtml(value)}</code><button class="btn ghost sm icon" type="button" data-copy="${escapeHtml(value)}" aria-label="Copy ${escapeHtml(what)}">${ico('copy', 14)}</button></div>`;
}

function wayHtml(w: AgentWay): string {
  const hint = w.hint ?? (w.action.kind === 'run' ? 'Run this once in a terminal:' : '');
  const act = w.action.kind === 'run'
    ? copyRow(w.action.command, `the ${w.name} command`, true)
    : w.action.kind === 'connector'
      ? copyRow(w.action.url, 'the Vantage address', true)
      : `<a class="btn sm" href="${escapeHtml(w.action.href)}" target="_blank" rel="noopener">${escapeHtml(w.action.label)}${ico('right', 13)}</a>`;
  return `<div class="way" data-client="${w.client}"><span class="way-name">${escapeHtml(w.name)}</span>${hint ? `<p>${escapeHtml(hint)}</p>` : ''}${act}</div>`;
}

export function agentBox(a: AgentSetup): string {
  const body = a.ways.length
    ? `<p>Ask your assistant for a diagram. It saves it here.</p>${a.ways.map(wayHtml).join('')}`
    : `<p>Point your agent at this hub's MCP server. Diagrams it saves show up here.</p>${copyRow(a.mcpUrl, 'the MCP address', false)}`;
  return `<div class="agent" id="agent"><b>${ico('code')}Let an agent draw it</b>${body}</div>`;
}
