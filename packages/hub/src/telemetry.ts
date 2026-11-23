/**
 * OpenTelemetry wiring. Spans and metrics go to an OTLP endpoint when the
 * standard OTEL_EXPORTER_OTLP_ENDPOINT variable is set; otherwise the API
 * is a no-op and nothing is exported. Registering the provider also sets
 * the W3C trace context propagator and the async context manager, which
 * the request middleware and the logger read. Requests and jobs each get
 * a span and are counted in metrics.ts.
 */
import { metrics, trace, type Tracer } from '@opentelemetry/api';
import type { Logger } from './log.ts';
import { HUB_VERSION } from './version.ts';

export interface Telemetry {
  readonly tracer: Tracer;
  shutdown(): Promise<void>;
}

export async function startTelemetry(log: Logger, env: Record<string, string | undefined> = process.env): Promise<Telemetry> {
  const endpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
  if (!endpoint) {
    log.info('telemetry.disabled', { reason: 'OTEL_EXPORTER_OTLP_ENDPOINT not set' });
    return { tracer: trace.getTracer('vantage-hub'), shutdown: async () => undefined };
  }
  const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { MeterProvider, PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
  const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
  const { detectResources, envDetector, resourceFromAttributes } = await import('@opentelemetry/resources');
  const resource = resourceFromAttributes({ 'service.name': 'vantage-hub', 'service.version': HUB_VERSION }).merge(detectResources({ detectors: [envDetector] }));
  const provider = new NodeTracerProvider({ resource, spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())] });
  provider.register();
  const meters = new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 30_000 })] });
  metrics.setGlobalMeterProvider(meters);
  log.info('telemetry.enabled', { endpoint, service: env['OTEL_SERVICE_NAME'] ?? 'vantage-hub', version: HUB_VERSION });
  return { tracer: trace.getTracer('vantage-hub'), shutdown: async () => { await Promise.all([provider.shutdown(), meters.shutdown()]); } };
}
