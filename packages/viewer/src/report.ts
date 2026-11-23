/**
 * The viewer's own reports to the hub's browser telemetry. The hub's
 * `/telemetry.js` exposes Faro as `window.faro`; in an exported or
 * embedded copy there is none and these do nothing.
 */
interface FaroApi {
  pushError(error: Error, options?: { context?: Record<string, string> }): void;
  pushMeasurement(measurement: { type: string; values: Record<string, number> }, options?: { context?: Record<string, string> }): void;
  pushEvent(name: string, attributes?: Record<string, string>): void;
}

declare global {
  // Read off the global object, not `window`, so a report from code that runs outside a page is a no-op too.
  var faro: { api?: FaroApi } | undefined;
}

/** The picture is on screen: the time from navigation to the first useful screen. */
export function reportReady(): void {
  globalThis.faro?.api?.pushMeasurement({ type: 'viewer_ready', values: { ready_ms: Math.round(performance.now()) } });
}

/** One picture the layout engine drew for the reader, and where it ran. */
export function reportLayout(ms: number, where: 'worker' | 'page'): void {
  globalThis.faro?.api?.pushMeasurement({ type: 'viewer_layout', values: { layout_ms: Math.round(ms) } }, { context: { where } });
}

/** A voice walkthrough recorded, saved, or played, with its length. */
export function reportTalk(action: 'record' | 'save' | 'play', ms: number): void {
  globalThis.faro?.api?.pushMeasurement({ type: 'viewer_talk', values: { length_ms: Math.round(ms) } }, { context: { action } });
}

/** An error the page shows in place of the diagram (`boot`), a picture the layout engine could not draw (`engine`), the YAML editor failing (`editor`), or a voice walkthrough that failed to list, record, or play (`recording`). */
export function reportError(err: unknown, stage: 'boot' | 'engine' | 'editor' | 'recording'): void {
  globalThis.faro?.api?.pushError(err instanceof Error ? err : new Error(String(err)), { context: { stage } });
}

/** Something the reader did that the hub counts from the browser, such as following another reader. Names no person or document. */
export function reportEvent(name: string, attributes: Record<string, string> = {}): void {
  globalThis.faro?.api?.pushEvent(name, attributes);
}
