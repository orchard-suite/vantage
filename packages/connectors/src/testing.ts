/**
 * Test support: a context whose fetch answers from recorded fixtures and
 * whose logger keeps what it was told. Tests import this directly; it is
 * not part of the package surface.
 */
import { readFileSync } from 'node:fs';
import type { ConnectorContext, FetchLike } from './connector.ts';
import { memoryLogger, type MemoryLogger } from './connector.ts';

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  /** The raw init, for options outside the fetch standard such as Bun's tls. */
  readonly init: RequestInit | undefined;
}

export type Route = { readonly match: string | RegExp; readonly file?: string; readonly json?: unknown; readonly status?: number; readonly headers?: Record<string, string> };

export interface FixtureFetch {
  readonly fetch: FetchLike;
  readonly calls: RecordedCall[];
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/** Routes are tried in order; the first whose match is a substring or regex hit of the URL answers. */
export function fixtureFetch(dir: string, routes: readonly Route[]): FixtureFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers: headersOf(init), body, init });
    const route = routes.find((r) => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!route) return new Response(JSON.stringify({ error: `no fixture for ${url}` }), { status: 404, headers: { 'content-type': 'application/json' } });
    const text = route.file !== undefined ? readFileSync(`${dir}/${route.file}`, 'utf8') : JSON.stringify(route.json ?? null);
    return new Response(text, { status: route.status ?? 200, headers: { 'content-type': 'application/json', ...route.headers } });
  };
  return { fetch, calls };
}

export interface TestContext<C> extends ConnectorContext<C> {
  readonly log: MemoryLogger;
}

export const TEST_NOW = '2026-10-28T10:00:00.000Z';

export function testContext<C>(config: C, fetch: FetchLike, secrets: Record<string, string> = {}): TestContext<C> {
  return {
    config,
    secrets: async (ref) => {
      const v = secrets[ref];
      if (v === undefined) throw new Error(`no test secret ${ref}`);
      return v;
    },
    log: memoryLogger(),
    now: () => new Date(TEST_NOW),
    signal: new AbortController().signal,
    fetch,
  };
}

export async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}
