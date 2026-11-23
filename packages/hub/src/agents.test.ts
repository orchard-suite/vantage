import { describe, expect, test } from 'bun:test';
import { agentSetup } from './agents.ts';
import { ConfigError, loadConfig } from './config.ts';

const BASE = { DATABASE_URL: 'postgres://x', PUBLIC_URL: 'https://hub.example', AUTH_MODE: 'none', SESSION_SECRET: 's'.repeat(32), SECRETS_KEY: 'k'.repeat(32) };
const ways = (json: string) => loadConfig({ ...BASE, AGENT_SETUP: json }).AGENT_SETUP;

describe('agent setup', () => {
  test('unset, a hub offers no ways and the MCP address', () => {
    const a = agentSetup('https://hub.example', loadConfig(BASE).AGENT_SETUP);
    expect(a).toEqual({ mcpUrl: 'https://hub.example/mcp', ways: [] });
  });

  test('a command and a Teams link come out named and labelled', () => {
    const a = agentSetup('https://hub.example', ways(JSON.stringify([
      { client: 'copilot', open: 'https://teams.microsoft.com/l/chat/0/0?users=28:abc' },
      { client: 'claude-code', run: 'claude plugin install vantage@example' },
    ])));
    expect(a.ways).toEqual([
      { client: 'copilot', name: 'Microsoft Copilot', action: { kind: 'open', href: 'https://teams.microsoft.com/l/chat/0/0?users=28:abc', label: 'Open in Teams' } },
      { client: 'claude-code', name: 'Claude Code', action: { kind: 'run', command: 'claude plugin install vantage@example' } },
    ]);
  });

  test('a way needs exactly one of run and open, links are https only, and the JSON must parse', () => {
    expect(() => ways('[{"client":"claude-code"}]')).toThrow(ConfigError);
    expect(() => ways('[{"client":"claude-code","run":"x","open":"https://a.example"}]')).toThrow(ConfigError);
    expect(() => ways('[{"client":"other","open":"javascript:alert(1)"}]')).toThrow(ConfigError);
    expect(() => ways('[{"client":"other","open":"http://a.example"}]')).toThrow(ConfigError);
    expect(() => ways('[{"client":"chatgpt","run":"x"}]')).toThrow(ConfigError);
    expect(() => ways('not json')).toThrow(/AGENT_SETUP/);
  });
});

describe('a claude desktop way', () => {
  test('with neither run nor open, it gives the hub address to paste into a connector', () => {
    const a = agentSetup('https://hub.example', ways('[{"client":"claude-desktop"}]'));
    expect(a.ways[0]).toMatchObject({ name: 'Claude Desktop', action: { kind: 'connector', url: 'https://hub.example/mcp' } });
    expect(a.ways[0]!.hint).toContain('custom connector');
  });
});
