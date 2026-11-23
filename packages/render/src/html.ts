/** A self-contained interactive HTML file: viewer script, layout engine, fonts, and the bundle, nothing fetched. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markSvg } from './kit.ts';

const VIEWER_DIST = join(import.meta.dir, '..', '..', 'viewer', 'dist', 'viewer.js');
const ENGINE_DIST = join(import.meta.dir, '..', '..', 'viewer', 'dist', 'engine.js');
const EDITOR_DIST = join(import.meta.dir, '..', '..', 'viewer', 'dist', 'editor.js');
const TELEMETRY_DIST = join(import.meta.dir, '..', '..', 'viewer', 'dist', 'telemetry.js');

/** The color mark as an inline favicon, so no page asks the server for one; it reads down to 16px. */
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(markSvg(128).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}">`;

export function viewerScript(): string {
  if (!existsSync(VIEWER_DIST)) throw new Error(`viewer not built: expected ${VIEWER_DIST}; run \`bun run build\``);
  return readFileSync(VIEWER_DIST, 'utf8');
}

/** The layout engine the viewer runs in a worker; served beside the viewer, or carried inside a file that stands alone. */
export function engineScript(): string {
  if (!existsSync(ENGINE_DIST)) throw new Error(`layout engine not built: expected ${ENGINE_DIST}; run \`bun run build\``);
  return readFileSync(ENGINE_DIST, 'utf8');
}

/** The YAML editor the hub's viewer loads when an author edits, and the New page loads with the page. */
export function editorScript(): string {
  if (!existsSync(EDITOR_DIST)) throw new Error(`editor not built: expected ${EDITOR_DIST}; run \`bun run build\``);
  return readFileSync(EDITOR_DIST, 'utf8');
}

/** The hub pages' browser telemetry, a bundle of its own so no exported file carries it. */
export function telemetryScript(): string {
  if (!existsSync(TELEMETRY_DIST)) throw new Error(`browser telemetry not built: expected ${TELEMETRY_DIST}; run \`bun run build\``);
  return readFileSync(TELEMETRY_DIST, 'utf8');
}

export interface RefreshOptions {
  /** URL that answers `{ version, bundle }` for this document to a reader the hub allows. */
  readonly url: string;
  /** The version embedded in this file; a different answer replaces the embedded bundle. */
  readonly version: string;
  /** How long to wait for the hub before showing the embedded copy. */
  readonly timeoutMs?: number;
}

export function standaloneHtml(bundle: Record<string, unknown>, opts: { title?: string; refresh?: RefreshOptions } = {}): string {
  const json = JSON.stringify(bundle).replace(/<\/script/gi, '<\\/script');
  const title = opts.title ?? String(bundle['title'] ?? 'Vantage');
  // The engine is text the viewer starts a worker from, so the page never parses it unless no worker can run.
  const engine = bundle['kit'] || opts.refresh ? `<script type="text/plain" id="vantage-engine">${engineScript()}</script>` : '';
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)}</title>${FAVICON}</head><body><div id="vantage"></div><script>window.__VANTAGE__=${json};</script>${engine}`;
  if (!opts.refresh) return `${head}<script>${viewerScript()}</script></body></html>`;
  // Self-refreshing: ask the hub for a newer version first, with a short timeout, then boot the viewer either way.
  const r = opts.refresh;
  const loader = `(function(){var u=${JSON.stringify(r.url)},v=${JSON.stringify(r.version)},t=${r.timeoutMs ?? 2500};function boot(){var s=document.createElement('script');s.textContent=document.getElementById('vantage-viewer').textContent;document.body.appendChild(s);}var c=new AbortController();var k=setTimeout(function(){c.abort();},t);fetch(u,{credentials:'include',signal:c.signal}).then(function(r){return r.ok?r.json():null;}).then(function(j){clearTimeout(k);if(j&&j.bundle&&j.version&&j.version!==v){j.bundle.refreshedFrom=v;window.__VANTAGE__=j.bundle;}boot();}).catch(function(){clearTimeout(k);boot();});})();`;
  return `${head}<script type="text/plain" id="vantage-viewer">${viewerScript()}</script><script>${loader}</script></body></html>`;
}

export function liveHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Vantage</title>${FAVICON}</head><body><div id="vantage"></div><script src="/viewer.js"></script></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
