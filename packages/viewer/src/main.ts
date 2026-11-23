/** Viewer entry: boots from the embedded bundle or from the server, which also streams reloads; hub bundles add the collaboration dock, the Export and Share dialogs, presence, and voice walkthroughs. */
import { App } from './app.ts';
import type { Bundle } from './bundle.ts';
import { Collab } from './collab.ts';
import { Talk } from './talk.ts';
import { wireDocumentActions } from './actions.ts';
import { startPresence } from './follow.ts';
import { wireEditor, type EditPanel } from './edit-panel.ts';
import { reportError, reportReady } from './report.ts';
import { LayoutEngine, type EngineSource } from './engine.ts';
import type { LayoutKit } from '@vantage/render/engine';

/** Read while this script first runs: the viewer's own address, beside which the engine bundle sits. */
const viewerSrc = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '';

/** The layout engine: inside the page for a file that stands alone, else beside the viewer script. */
function engineSource(): EngineSource | undefined {
  const text = document.getElementById('vantage-engine')?.textContent;
  if (text) return { text };
  if (!viewerSrc) return undefined;
  const url = new URL(viewerSrc);
  url.pathname = url.pathname.replace(/viewer\.js$/, 'engine.js');
  return { url: url.toString() };
}

/**
 * The hub's bundle: the stored body with this reader's fields (version,
 * render, hub panels, theme) from the X-Vantage-Reader header laid over it.
 * A bundle that lists its views has each view's entry read from its own
 * address, which names the entry's digest: the browser keeps an entry it
 * has, so a save brings only the views it changed.
 */
async function fetchBundle(url: string): Promise<Bundle> {
  const res = await fetch(url);
  const body = (await res.json()) as Bundle;
  const reader = res.headers.get('x-vantage-reader');
  const bytes = reader ? Uint8Array.from(atob(reader.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)) : undefined;
  const bundle: Bundle = bytes ? { ...body, ...(JSON.parse(new TextDecoder().decode(bytes)) as Partial<Bundle>) } : body;
  if (!bundle.lazy) return bundle;
  const base = besideBundle(url, 'view');
  const listed = bundle.views as unknown as readonly { id: string; digest: string }[];
  const views = await Promise.all(
    listed.map(async (v) => {
      const u = new URL(base);
      u.searchParams.set('view', v.id);
      u.searchParams.set('d', v.digest);
      const r = await fetch(u);
      if (!r.ok) throw new Error(`view ${v.id} answered ${r.status}`);
      return (await r.json()) as Bundle['views'][number];
    }),
  );
  return { ...bundle, views, lazy: false };
}

/** The address beside the bundle's: `/api/bundle` becomes `/api/bundle/<leaf>`. */
function besideBundle(url: string, leaf: string): URL {
  const u = new URL(url, location.href);
  u.pathname = u.pathname.replace(/\/api\/bundle$/, `/api/bundle/${leaf}`);
  return u;
}

/**
 * While the hub draws a newer version than the one on the stage, the
 * viewer reads that version's layout kit and lays the view on the stage
 * out itself, so the change shows at once; the hub's picture follows.
 */
function drawAhead(app: App, bundleUrl: string, source: EngineSource | undefined): (bundle: Bundle) => void {
  let asked: string | undefined;
  return (bundle) => {
    const head = bundle.hub?.version;
    if (!bundle.drawing || !source || head === undefined || head === asked) return;
    asked = head;
    const u = besideBundle(bundleUrl, 'kit');
    u.searchParams.set('version', head);
    void fetch(u)
      .then(async (r) => (r.ok ? ((await r.json()) as LayoutKit) : undefined))
      .then(async (kit) => {
        if (!kit) return;
        const engine = new LayoutEngine(kit, source);
        await app.drawAhead(engine).finally(() => engine.close());
      })
      .catch((err: unknown) => reportError(err, 'engine'));
  };
}

async function boot(): Promise<void> {
  const mount = document.getElementById('vantage') ?? document.body;
  let bundle = window.__VANTAGE__;
  const params = new URLSearchParams(location.search);
  const file = params.get('file');
  const theme = params.get('theme');
  const bundleUrl = `/api/bundle${file ? `?file=${encodeURIComponent(file)}` : ''}${theme ? `${file ? '&' : '?'}theme=${theme}` : ''}`;
  if (!bundle) {
    bundle = await fetchBundle(bundleUrl);
  }
  const source = engineSource();
  const app = new App(bundle, mount, source);
  reportReady();
  const ahead = drawAhead(app, bundleUrl, source);
  ahead(bundle);
  let shown: string | undefined = bundle.hub?.version;
  let shownRender = bundle.render;
  let collab: Collab | undefined;
  let editor: EditPanel | undefined;
  let talk: Talk | undefined;
  /** Fetches the bundle; a newer rendered head goes on the stage and to the dock. A pending answer is left alone. */
  const refresh = async (): Promise<Bundle> => {
    const next = await fetchBundle(bundleUrl);
    if (next.pending) return next;
    if (next.hub?.version === undefined || next.hub.version !== shown || next.render !== shownRender) {
      shown = next.hub?.version;
      shownRender = next.render;
      app.update(next);
      collab?.onBundle(next);
      editor?.onBundle(next);
      talk?.onBundle(next);
    }
    ahead(next);
    return next;
  };
  if (bundle.hub && app.dock) collab = new Collab(app, { ...bundle, hub: bundle.hub }, refresh);
  if (bundle.hub) wireDocumentActions(app, bundle.hub, bundle.title);
  if (bundle.hub?.canEdit) editor = wireEditor(app, bundle.hub, bundle.theme);
  if (bundle.recordings) talk = new Talk(app, bundle, (leaf) => besideBundle(bundleUrl, leaf));
  if (bundle.live) {
    const es = new EventSource(`/api/events${file ? `?file=${encodeURIComponent(file)}` : ''}`);
    es.onmessage = (e: MessageEvent<string>) => {
      if (!collab?.live(e.data)) void refresh();
    };
    // A stream that ends (the pod it was on is stopping) reconnects; anything rendered in between is fetched once.
    let opened = false;
    es.onopen = () => {
      if (opened) void refresh();
      opened = true;
    };
    if (bundle.presence) startPresence(app, file, es);
  }
}

boot().catch((err: unknown) => {
  reportError(err, 'boot');
  // A blank page tells nobody anything; say what broke.
  const mount = document.getElementById('vantage') ?? document.body;
  const pre = document.createElement('pre');
  pre.style.cssText = 'padding:16px;font:13px/1.5 ui-monospace,Menlo,monospace;color:#7a1f1f;white-space:pre-wrap';
  pre.textContent = `Vantage could not start.\n${err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)}`;
  mount.replaceChildren(pre);
});
