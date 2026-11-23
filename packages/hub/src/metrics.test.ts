import { describe, expect, test } from 'bun:test';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics';
import { testContext } from './testing.ts';
import { createHubApp } from './web/app.ts';
import { createHubMetrics } from './metrics.ts';

describe('metrics', () => {
  test('requests are recorded by route pattern, never by path, and build_info names the release', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
    const provider = new MeterProvider({ readers: [reader] });
    const ctx = { ...(await testContext()), metrics: createHubMetrics(provider.getMeter('test')) };
    const app = createHubApp(ctx);
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/api/v1/documents/doc-one/drift')).status).toBe(404);
    expect((await app.request('/api/v1/documents/doc-two/drift')).status).toBe(404);
    expect((await app.request('/no/such/page-three')).status).toBe(404);

    await reader.forceFlush();
    const all = exporter.getMetrics().flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
    const http = all.find((m) => m.descriptor.name === 'http.server.request.duration') as HistogramMetricData;
    const routes = http.dataPoints.map((p) => `${String(p.attributes['http.route'])} ${String(p.attributes['http.response.status_code'])}`);
    expect(routes).toContain('/healthz 200');
    expect(routes).toContain('/api/v1/documents/:document/drift 404');
    expect(routes.some((r) => r.includes('doc-one') || r.includes('page-three'))).toBe(false);
    const doc = http.dataPoints.find((p) => p.attributes['http.route'] === '/api/v1/documents/:document/drift');
    expect(doc?.value.count).toBe(2);
    const info = all.find((m) => m.descriptor.name === 'vantage.build_info');
    expect(info?.dataPoints[0]?.attributes['version']).toMatch(/^\d+\.\d+\.\d+/);
    await provider.shutdown();
    await ctx.db.close();
    // A fresh database and app take a few seconds on a slow runner.
  });
});
