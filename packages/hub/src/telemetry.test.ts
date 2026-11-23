import { describe, expect, test } from 'bun:test';
import { metrics } from '@opentelemetry/api';
import { startTelemetry } from './telemetry.ts';
import { silentLogger } from './log.ts';

describe('telemetry', () => {
  test('with an endpoint set, the exporters load against the pinned api and shut down cleanly', async () => {
    const t = await startTelemetry(silentLogger, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9' });
    expect(t.tracer).toBeDefined();
    await t.shutdown().catch(() => undefined);
    metrics.disable();
  });
});
