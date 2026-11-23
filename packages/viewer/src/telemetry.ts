/**
 * What readers see and do in the hub, from their browser. A script of its
 * own (`/telemetry.js`), loaded by the hub's pages before the viewer, so
 * exported and embedded copies never carry it. The Grafana Faro SDK
 * collects sessions, web vitals, exceptions, and a span per call to the
 * hub's API, which joins the server's trace through `traceparent`.
 * Batches go to the hub's own `/api/telemetry`, which relays them with the
 * collector's key; the browser never holds it. Nothing here names a person
 * or a document.
 */
import { faro, getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import { parseRoute } from './router.ts';

export const APP_NAME = 'vantage-web';

/** The page kinds, a fixed list, so every event and error says where the reader was. */
export function pageKind(path: string): 'home' | 'workspace' | 'document' | 'other' {
  if (path === '/') return 'home';
  if (/^\/w\/[^/]+\/?$/.test(path)) return 'workspace';
  if (/^\/(w|g)\/[^/]+\/[^/]+\/?$/.test(path)) return 'document';
  return 'other';
}

/**
 * Only calls to the hub's own API become spans: not the telemetry relay
 * itself, not the live event stream, and nothing on another origin.
 */
export function ignoredUrls(origin: string): RegExp[] {
  const own = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [new RegExp(`^(?!(${own})?/api/(?!telemetry|events))`)];
}

function start(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  initializeFaro({
    url: '/api/telemetry',
    // The hub replaces this with the collector's key.
    apiKey: 'vantage',
    app: { name: APP_NAME, version: script?.dataset['version'] ?? 'unknown', environment: location.protocol === 'https:' ? 'production' : 'dev' },
    sessionTracking: { enabled: true, persistent: true },
    ignoreUrls: ignoredUrls(location.origin),
    instrumentations: [
      // Console capture would send every log line twice, and resource timing an event per thumbnail and font.
      ...getWebInstrumentations({ captureConsole: false, enablePerformanceInstrumentation: false }),
      new TracingInstrumentation(),
    ],
  });
  faro.api.setView({ name: pageKind(location.pathname) });
  // A reader picking another view of the diagram; the view's id is the author's text, so it is not sent.
  let view = parseRoute(location.hash).view;
  addEventListener('hashchange', () => {
    const next = parseRoute(location.hash).view;
    if (next && next !== view) faro.api.pushEvent('view.open');
    view = next;
  });
  // The first wheel event of each gesture, with its raw numbers, so a device the zoom misreads shows up.
  let lastWheel = 0;
  window.addEventListener('wheel', (e: WheelEvent) => {
    const now = performance.now();
    if (now - lastWheel > 500) {
      const legacy = e as WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number };
      faro.api.pushEvent('wheel.read', {
        deltaX: String(e.deltaX),
        deltaY: String(e.deltaY),
        deltaMode: String(e.deltaMode),
        wheelDeltaX: String(legacy.wheelDeltaX ?? ''),
        wheelDeltaY: String(legacy.wheelDeltaY ?? ''),
        ctrl: String(e.ctrlKey),
      });
    }
    lastWheel = now;
  }, { passive: true });
}

// Tests import the rules above without a page.
if (typeof document !== 'undefined') start();
