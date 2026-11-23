import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { Batch } from './batch.ts';
import { consoleLogger, createRegistry, fetchJson, HttpError, memoryLogger, type Connector } from './connector.ts';
import { builtinConnectors, defaultRegistry } from './connectors/index.ts';
import { runConnector } from './run.ts';
import { testContext } from './testing.ts';

describe('registry', () => {
  test('holds the built-in connectors by id and refuses a duplicate', () => {
    const r = defaultRegistry();
    expect(r.list().map((c) => c.id).sort()).toEqual(['azure-resource-graph', 'cloudflare', 'git', 'github', 'http', 'jira', 'kubectl', 'orrery']);
    expect(r.get('orrery')?.id).toBe('orrery');
    expect(r.get('nope')).toBeUndefined();
    expect(() => r.register(builtinConnectors()[0]!)).toThrow('registered twice');
    expect(createRegistry().list()).toEqual([]);
  });
});

describe('logging', () => {
  test('memory logger keeps records; console logger writes JSON lines', () => {
    const m = memoryLogger();
    m.warn('x', { a: 1 });
    expect(m.records).toEqual([{ level: 'warn', message: 'x', fields: { a: 1 } }]);
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => void lines.push(line);
    try {
      consoleLogger({ connector: 't' }).info('hello', { n: 2 });
    } finally {
      console.log = original;
    }
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 'info', message: 'hello', connector: 't', n: 2 });
  });
});

describe('fetchJson', () => {
  test('throws an HttpError with the status on a failed response', async () => {
    const ctx = testContext({}, async () => new Response('nope', { status: 503 }));
    await expect(fetchJson(ctx, 'https://x.example.test/')).rejects.toBeInstanceOf(HttpError);
    expect(ctx.log.records.at(-1)).toMatchObject({ level: 'error', fields: { status: 503 } });
  });
});

describe('runConnector', () => {
  const echo: Connector<{ n: number }> = {
    id: 'echo',
    configSchema: z.object({ n: z.number() }),
    async *discover(ctx) {
      for (let i = 0; i < ctx.config.n; i++) {
        const b: Batch = { source: 'ignored', observed: ctx.now().toISOString(), partial: true, entities: [{ id: `e${i}`, type: 't', name: `E${i}` }], relations: [] };
        yield b;
      }
    },
  };

  test('stamps the source, folds slices, and logs counts', async () => {
    const ctx = testContext<unknown>({ n: 3 }, fetch);
    const run = await runConnector(echo, ctx, 'my-echo');
    expect(run.batch.source).toBe('my-echo');
    expect(run.batch.entities).toHaveLength(3);
    expect(run.slices).toBe(3);
    expect(ctx.log.records.filter((r) => r.message === 'connector slice')).toHaveLength(3);
  });

  test('a connector that yields nothing still produces an empty full batch', async () => {
    const run = await runConnector(echo, testContext<unknown>({ n: 0 }, fetch), 'empty');
    expect(run.batch).toEqual({ source: 'empty', observed: '2026-10-28T10:00:00.000Z', entities: [], relations: [] });
  });
});
