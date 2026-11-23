import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTargets, runPublication, PublicationSchema, type Artifact, type Logger, type Stamp } from './index.ts';

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const stamp: Stamp = { title: 'Harbor', version: 'v12', publishedAt: '2026-10-28T10:00:00Z', liveUrl: 'https://vantage.example/w/platform/harbor' };
const art = (filename: string, kind: Artifact['kind'] = 'png'): Artifact => ({ kind, filename, contentType: 'image/png', bytes: new TextEncoder().encode(`data for ${filename}`) as Uint8Array<ArrayBuffer>, stamp });
const ctx = (fetchImpl: typeof fetch = fetch) => ({ secrets: async (ref: string) => `secret-${ref}`, log: quiet, now: () => new Date('2026-10-28T10:00:00Z'), fetch: fetchImpl });

describe('publishing', () => {
  test('fs target writes every artifact and reports locations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-pub-'));
    const pub = PublicationSchema.parse({ id: 'p', document: 'harbor', formats: ['png'], target: 'fs', config: { path: dir } });
    const r = await runPublication(pub, stamp, async () => [art('harbor.context.png'), art('harbor.access.png')], defaultTargets(), ctx());
    expect(r.written.map((w) => w.artifact)).toEqual(['harbor.context.png', 'harbor.access.png']);
    expect(readFileSync(join(dir, 'harbor.context.png'), 'utf8')).toBe('data for harbor.context.png');
    expect(r.startedAt <= r.finishedAt).toBe(true);
  });

  test('azure blob target PUTs block blobs with the SAS and the version metadata', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
      return new Response('', { status: 201 });
    }) as unknown as typeof fetch;
    const pub = PublicationSchema.parse({ id: 'p', document: 'harbor', formats: ['html'], target: 'azure-blob', config: { account: 'acct', container: '$web', prefix: 'diagrams', secret: 'sas' } });
    const r = await runPublication(pub, stamp, async () => [art('harbor.html', 'html')], defaultTargets(), ctx(fake));
    expect(r.written).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://acct.blob.core.windows.net/$web/diagrams/harbor.html?secret-sas');
    expect(calls[0]!.headers['x-ms-blob-type']).toBe('BlockBlob');
    expect(calls[0]!.headers['x-ms-meta-vantage-version']).toBe('v12');
    expect(calls[0]!.headers['x-ms-blob-cache-control']).toBe('no-cache');
  });

  test('webhook target reports a rejection as skipped, not thrown', async () => {
    const fake: typeof fetch = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const pub = PublicationSchema.parse({ id: 'p', document: 'harbor', formats: ['svg'], target: 'webhook', config: { url: 'https://hook.example/x' } });
    const r = await runPublication(pub, stamp, async () => [art('a.svg', 'svg')], defaultTargets(), ctx(fake));
    expect(r.written).toEqual([]);
    expect(r.skipped[0]!.reason).toBe('403');
  });

  test('sharepoint target uploads through graph drive paths', async () => {
    const urls: string[] = [];
    const fake: typeof fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ webUrl: 'https://tenant.sharepoint.com/sites/x/Diagrams/a.png' }), { status: 201 });
    }) as unknown as typeof fetch;
    const pub = PublicationSchema.parse({ id: 'p', document: 'harbor', formats: ['png'], target: 'sharepoint', config: { drive: 'sites/abc/drive', path: 'Diagrams/Harbor' } });
    const r = await runPublication(pub, stamp, async () => [art('a.png')], defaultTargets(), ctx(fake));
    expect(urls[0]).toBe('https://graph.microsoft.com/v1.0/sites/abc/drive/root:/Diagrams/Harbor/a.png:/content');
    expect(r.written[0]!.location).toContain('sharepoint.com');
  });

  test('teams target posts one adaptive card with the live link', async () => {
    let body = '';
    const fake: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body);
      return new Response('1', { status: 200 });
    }) as unknown as typeof fetch;
    const pub = PublicationSchema.parse({ id: 'p', document: 'harbor', formats: ['png'], target: 'teams', config: { webhook: 'hook' } });
    await runPublication(pub, stamp, async () => [art('a.png')], defaultTargets(), ctx(fake));
    expect(body).toContain('Open live diagram');
    expect(body).toContain('v12');
  });

  test('unknown target fails loudly and config is validated', async () => {
    const pub = PublicationSchema.parse({ id: 'p', document: 'd', formats: ['png'], target: 'nope', config: {} });
    await expect(runPublication(pub, stamp, async () => [], defaultTargets(), ctx())).rejects.toThrow('unknown target nope');
    const bad = PublicationSchema.parse({ id: 'p', document: 'd', formats: ['png'], target: 'fs', config: {} });
    await expect(runPublication(bad, stamp, async () => [], defaultTargets(), ctx())).rejects.toThrow();
    expect(existsSync('/nonexistent-vantage')).toBe(false);
  });
});
