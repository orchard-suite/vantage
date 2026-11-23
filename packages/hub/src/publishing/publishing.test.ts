import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeFetch, SAMPLE_YAML, testApp } from '../testing.ts';
import { createWorker } from '../worker/loop.ts';

describe('publications', () => {
  test('a run against the fs target writes stamped artifacts, on-save and failure paths record runs and notify', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-pub-'));
    const hooks = fakeFetch([{ match: 'dispatch.example.test', json: { queued: 0 } }, { match: 'webhook.example.test', status: 500, json: { error: 'down' } }]);
    try {
      const t = await testApp({ fetch: hooks.fetch, env: { DISPATCH_URL: 'https://dispatch.example.test', DISPATCH_TOKEN: 'vantage-token' } });
      const worker = createWorker(t.ctx);
      const admin = await t.bearer('admin', { admin: true });
      const me = await t.bearer('author');
      const viewer = await t.bearer('viewer');
      const ws = ((await t.json('/api/v1/workspaces', { headers: me.headers })).body['workspaces'] as { slug: string; id: string }[])[0]!;
      const saved = await t.json(`/api/v1/workspaces/${ws.slug}/documents`, { method: 'POST', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML }) });
      const doc = saved.body['document'] as { id: string; slug: string };
      const v1 = (saved.body['version'] as { id: string }).id;
      await worker.drain();
      const base = `/api/v1/workspaces/${ws.slug}/publications`;

      expect((await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'x', document: doc.slug, formats: ['png'], target: 'nowhere', config: {} }) })).status).toBe(400);
      expect((await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'x', document: doc.slug, formats: ['png'], target: 'fs', config: {} }) })).status).toBe(400);
      expect((await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'x', document: doc.slug, formats: ['png'], target: 'fs', config: { path: dir }, trigger: { kind: 'schedule', cron: 'daily' } }) })).status).toBe(400);
      expect((await t.json(base, { method: 'POST', headers: viewer.headers, body: JSON.stringify({ name: 'x', document: doc.slug, formats: ['png'], target: 'fs', config: { path: dir } }) })).status).toBe(404);
      const created = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Share folder', document: doc.slug, formats: ['html', 'png', 'svg', 'pdf', 'drawio', 'vsdx'], target: 'fs', config: { path: dir } }) });
      expect(created.status).toBe(201);
      const pubId = created.body['id'] as string;
      expect(((await t.json(`${base}?document=${doc.slug}`, { headers: me.headers })).body['publications'] as unknown[]).length).toBe(1);
      expect(((await t.json('/api/v1/targets', { headers: me.headers })).body['targets'] as { id: string }[]).map((x) => x.id)).toContain('fs');

      const run = await t.json(`${base}/${pubId}/run`, { method: 'POST', headers: me.headers });
      expect(run.status).toBe(202);
      await worker.drain();
      const files = readdirSync(dir).sort();
      expect(files).toEqual(['sample.context.png', 'sample.context.svg', 'sample.drawio', 'sample.html', 'sample.pdf', 'sample.vsdx']);
      const html = readFileSync(join(dir, 'sample.html'), 'utf8');
      expect(html).toContain(`/api/v1/documents/${doc.id}/bundle`);
      expect(html).toContain(`"version":"${v1}"`);
      expect(html).toContain('"stamp"');
      const svg = readFileSync(join(dir, 'sample.context.svg'), 'utf8');
      expect(svg).toContain(v1);
      expect(svg).toContain(`http://hub.test/w/${ws.slug}/${doc.slug}`);
      expect(svg).toContain('published');
      expect(readFileSync(join(dir, 'sample.context.png')).byteLength).toBeGreaterThan(1000);
      const runs = await t.json(`${base}/${pubId}/runs`, { headers: viewer.headers });
      expect(runs.status).toBe(404);
      const history = (await t.json(`${base}/${pubId}/runs`, { headers: me.headers })).body['runs'] as { status: string; trigger: string; version: string; written: unknown[] }[];
      expect(history.length).toBe(1);
      expect(history[0]).toMatchObject({ status: 'ok', trigger: 'manual', version: v1 });
      expect(history[0]!.written.length).toBe(6);
      const detail = await t.json(`${base}/${pubId}`, { headers: me.headers });
      expect((detail.body['lastRun'] as { status: string; written: number }).written).toBe(6);

      const onSave = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'On save', document: doc.slug, formats: ['svg'], views: ['context'], target: 'fs', config: { path: join(dir, 'on-save') }, trigger: { kind: 'on-save' }, titleBlock: false }) });
      expect(onSave.status).toBe(201);
      await t.json(`/api/v1/workspaces/${ws.slug}/documents/${doc.slug}`, { method: 'PUT', headers: me.headers, body: JSON.stringify({ yaml: SAMPLE_YAML.replace('title: Sample', 'title: Sample two'), expectedVersion: v1 }) });
      await worker.drain();
      expect(readdirSync(join(dir, 'on-save'))).toEqual(['sample.context.svg']);
      const saveRuns = (await t.json(`${base}/${onSave.body['id'] as string}/runs`, { headers: me.headers })).body['runs'] as { trigger: string; status: string }[];
      expect(saveRuns.map((r) => r.trigger)).toEqual(['on-save']);

      const failing = await t.json(base, { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Broken', document: doc.slug, formats: ['png'], target: 'webhook', config: { url: 'https://webhook.example.test/in', secret: 'missing-secret' } }) });
      expect(failing.status).toBe(201);
      await t.json(`${base}/${failing.body['id'] as string}/run`, { method: 'POST', headers: me.headers });
      await worker.drain();
      const failed = (await t.json(`${base}/${failing.body['id'] as string}/runs`, { headers: me.headers })).body['runs'] as { status: string; error: string }[];
      expect(failed[0]!.status).toBe('failed');
      expect(failed[0]!.error).toContain('missing-secret');
      const notes = (await t.json(`/api/v1/workspaces/${ws.slug}/notifications`, { headers: me.headers })).body['notifications'] as { kind: string; title: string }[];
      expect(notes[0]).toMatchObject({ kind: 'publication-failed', title: 'Publication Broken failed' });
      const sent = hooks.calls.filter((c) => c.url === 'https://dispatch.example.test/v1/events');
      expect(sent.length).toBe(1);
      const event = JSON.parse(sent[0]!.body!) as Record<string, unknown>;
      expect(event).toMatchObject({ kind: 'vantage.publication_failed', title: 'Publication Broken failed', severity: 'warning', labels: { workspace: ws.slug } });
      expect(event['to']).toBeUndefined();
      const jobs = await t.ctx.db.query<{ state: string; attempts: number }>("select state, attempts from jobs where kind = 'publication-run' order by created_at desc limit 1");
      expect(jobs[0]!.state).toBe('failed');

      await t.json('/api/v1/secrets/missing-secret', { method: 'PUT', headers: admin.headers, body: JSON.stringify({ value: 'tok' }) });
      await t.json(`${base}/${failing.body['id'] as string}/run`, { method: 'POST', headers: me.headers });
      await worker.drain();
      const rejected = (await t.json(`${base}/${failing.body['id'] as string}/runs`, { headers: me.headers })).body['runs'] as { status: string; skipped: { reason: string }[] }[];
      expect(rejected[0]!.status).toBe('ok');
      expect(rejected[0]!.skipped[0]!.reason).toBe('500');

      const audits = (await t.ctx.db.query<{ what: string }>('select what from audit')).map((a) => a.what);
      for (const w of ['publication.create', 'publication.run.queue', 'publication.run']) expect(audits).toContain(w);
      expect((await t.json(`${base}/${pubId}`, { method: 'DELETE', headers: me.headers })).status).toBe(204);
      expect((await t.json(`${base}/${pubId}`, { headers: me.headers })).status).toBe(404);
      await t.ctx.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
