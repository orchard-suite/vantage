/**
 * The viewer's side of the layout engine. The engine runs in a worker so a
 * layout never stalls the page; where a worker is refused it runs in
 * place. Pictures are kept by what they show, and the reader's requests
 * run ahead of the ones the viewer lays out in advance.
 */
import type { Engine, Json, LayoutKit, PictureRequest } from '@vantage/render/engine';
import type { BundlePicture } from './bundle.ts';
import { reportError, reportLayout } from './report.ts';

export type EngineMessage = { readonly type: 'kit'; readonly kit: LayoutKit } | { readonly type: 'picture'; readonly id: number; readonly req: PictureRequest };
/** The engine's answer; a picture crosses as plain JSON, the shape the bundle's pictures have. */
export type EngineReply = { readonly id: number; readonly picture: Json } | { readonly id: number; readonly error: string };

/** Where the engine bundle comes from: its URL beside the viewer script, or its text inside the page. */
export type EngineSource = { readonly url: string } | { readonly text: string };

declare global {
  interface Window {
    VantageEngine?: typeof Engine;
  }
}

/** Pictures kept at once; a view's groups and their zooms fit with room to spare. */
const KEEP = 48;

interface Entry {
  readonly key: string;
  readonly req: PictureRequest;
  picture?: BundlePicture | undefined;
  done: boolean;
  readonly waiting: ((p: BundlePicture | undefined) => void)[];
}

function keyOf(r: PictureRequest): string {
  return JSON.stringify([r.view, r.detail ?? null, [...r.open].sort(), [...r.shut].sort(), r.zoom ?? null]);
}

export class LayoutEngine {
  private worker: Worker | undefined;
  private inPlace: Engine | undefined;
  private broken = false;
  private readonly entries = new Map<string, Entry>();
  private readonly urgent: Entry[] = [];
  private readonly later: Entry[] = [];
  private running: { readonly id: number; readonly entry: Entry; readonly start: number } | undefined;
  private nextId = 1;

  constructor(private readonly kit: LayoutKit, private readonly source: EngineSource) {
    try {
      const url = 'url' in source ? source.url : URL.createObjectURL(new Blob([source.text], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = (e: MessageEvent<EngineReply>) => this.reply(e.data);
      // A worker the page refuses (a content policy, a file the browser will not load) fails here, not at construction.
      w.onerror = () => this.fallBack();
      w.postMessage({ type: 'kit', kit } satisfies EngineMessage);
      this.worker = w;
    } catch {
      this.fallBack();
    }
  }

  /** A picture already laid out, without waiting. */
  peek(req: PictureRequest): BundlePicture | undefined {
    return this.entries.get(keyOf(req))?.picture;
  }

  /** The picture for a request; `urgent` runs it before everything laid out in advance. Undefined when the engine cannot draw it. */
  request(req: PictureRequest, urgent: boolean): Promise<BundlePicture | undefined> {
    const key = keyOf(req);
    let e = this.entries.get(key);
    if (e?.done) {
      this.entries.delete(key);
      this.entries.set(key, e);
      return Promise.resolve(e.picture);
    }
    if (!e) {
      e = { key, req, done: false, waiting: [] };
      this.entries.set(key, e);
      (urgent ? this.urgent : this.later).push(e);
    } else if (urgent && this.later.includes(e)) {
      this.later.splice(this.later.indexOf(e), 1);
      this.urgent.push(e);
    }
    const entry = e;
    const p = new Promise<BundlePicture | undefined>((resolve) => entry.waiting.push(resolve));
    this.pump();
    return p;
  }

  /** Drops the advance work nobody waits on yet: the reader moved on. */
  dropLater(): void {
    for (const e of this.later.splice(0)) if (!e.waiting.length) this.entries.delete(e.key);
  }

  close(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.broken = true;
    const held = this.running ? [this.running.entry] : [];
    this.running = undefined;
    for (const e of [...held, ...this.urgent.splice(0), ...this.later.splice(0)]) this.finish(e, undefined);
  }

  private pump(): void {
    if (this.running || (!this.worker && !this.inPlace && !this.broken)) return;
    const entry = this.urgent.shift() ?? this.later.shift();
    if (!entry) return;
    if (this.broken) {
      this.finish(entry, undefined);
      return this.pump();
    }
    const id = this.nextId++;
    this.running = { id, entry, start: performance.now() };
    if (this.worker) return this.worker.postMessage({ type: 'picture', id, req: entry.req } satisfies EngineMessage);
    // In place: one layout per task, so the page paints between them.
    setTimeout(() => {
      try {
        const picture = this.inPlace!.picture(entry.req);
        this.reply(picture ? { id, picture } : { id, error: `no view ${entry.req.view}` });
      } catch (err) {
        this.reply({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }, 0);
  }

  private reply(r: EngineReply): void {
    const run = this.running;
    if (!run || run.id !== r.id) return;
    this.running = undefined;
    if ('error' in r) reportError(new Error(r.error), 'engine');
    else reportLayout(performance.now() - run.start, this.worker ? 'worker' : 'page');
    this.finish(run.entry, 'picture' in r ? (r.picture as unknown as BundlePicture) : undefined);
    this.pump();
  }

  private finish(e: Entry, picture: BundlePicture | undefined): void {
    e.picture = picture;
    e.done = true;
    for (const w of e.waiting.splice(0)) w(picture);
    if (picture === undefined) this.entries.delete(e.key);
    for (const [key, old] of this.entries) {
      if (this.entries.size <= KEEP) break;
      if (old.done) this.entries.delete(key);
    }
  }

  /** No worker: load the engine on the page and run it here. */
  private fallBack(): void {
    if (this.inPlace || this.broken) return;
    this.worker?.terminate();
    this.worker = undefined;
    // The job the worker held runs again in place.
    if (this.running) this.urgent.unshift(this.running.entry);
    this.running = undefined;
    const ready = (): void => {
      if (!window.VantageEngine) return this.fail(new Error('the layout engine did not load'));
      this.inPlace = new window.VantageEngine(this.kit);
      this.pump();
    };
    if (window.VantageEngine) return ready();
    const s = document.createElement('script');
    if ('url' in this.source) {
      s.src = this.source.url;
      s.onload = ready;
      s.onerror = () => this.fail(new Error('the layout engine did not load'));
      document.head.appendChild(s);
    } else {
      s.textContent = this.source.text;
      document.head.appendChild(s);
      ready();
    }
  }

  private fail(err: Error): void {
    reportError(err, 'engine');
    this.broken = true;
    this.pump();
  }
}
