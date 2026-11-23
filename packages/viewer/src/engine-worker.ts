/**
 * The layout engine bundle, built apart from the viewer so the page stays
 * light. In a worker it answers the viewer's messages; loaded on a page
 * where workers are refused, it puts itself on `window` for the viewer to
 * call in place.
 */
import { Engine } from '@vantage/render/engine';
import type { EngineReply, EngineMessage } from './engine.ts';

interface Host {
  onmessage: ((e: MessageEvent<EngineMessage>) => void) | null;
  postMessage(reply: EngineReply): void;
  VantageEngine?: typeof Engine;
}
const host = globalThis as unknown as Host;

if (typeof document === 'undefined') {
  let engine: Engine | undefined;
  host.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'kit') {
      engine = new Engine(m.kit);
      return;
    }
    try {
      const picture = engine?.picture(m.req);
      host.postMessage(picture ? { id: m.id, picture } : { id: m.id, error: `no view ${m.req.view}` });
    } catch (err) {
      host.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
} else {
  host.VantageEngine = Engine;
}
