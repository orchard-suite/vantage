/**
 * The hub's HTML: the shared page head, the viewer page per document, the
 * embed page per view. The sign in, passcode, device and message pages are
 * auth-pages.ts; the home page is home.ts, inside the app frame of frame.ts. Inline scripts carry the response nonce for the CSP.
 */
import { FAVICON } from '@vantage/render';
import { SHELL_CSS } from './look.ts';
import { HUB_VERSION } from '../version.ts';
import { INSTALL_TAGS } from './install.ts';
import { dayOf } from '../day.ts';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Browser tab titles: the page, then the product, so a row of tabs still reads. */
export function pageTitle(title: string): string {
  return title === 'Vantage' ? title : `${title} · Vantage`;
}

/** The browser telemetry, first in the head so its fetch spans cover the page's own first calls. */
function telemetryTag(nonce: string): string {
  return `<script nonce="${nonce}" src="/telemetry.js?v=${HUB_VERSION}" data-version="${HUB_VERSION}"></script>`;
}

/** A hub page: the shared head (title, icons, the install tags, the shell stylesheet, the browser telemetry), the body, and an optional nonce'd script. A light or dark `theme` is the reader's pick; without one the page follows their system. */
export function page(title: string, body: string, nonce: string, script = '', theme?: 'light' | 'dark'): string {
  return `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(pageTitle(title))}</title>${FAVICON}${INSTALL_TAGS}${telemetryTag(nonce)}<style>${SHELL_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

/**
 * A search snippet as safe HTML. Postgres marks the hits with <b> but
 * leaves the source text raw, so everything is escaped first and only the
 * hit markers come back, as <mark>.
 */
export function snippetHtml(headline: string): string {
  return escapeHtml(headline).replace(/&lt;b&gt;/g, '<mark>').replace(/&lt;\/b&gt;/g, '</mark>');
}

/** "3h ago" for recent changes, the date for older ones; the exact time rides in the title. */
export function updatedLabel(d: Date, now = Date.now()): string {
  const m = Math.floor((now - d.getTime()) / 60_000);
  if (m < 1) return 'Updated just now';
  if (m < 60) return `Updated ${m}m ago`;
  if (m < 60 * 24) return `Updated ${Math.round(m / 60)}h ago`;
  if (m < 60 * 24 * 14) return `Updated ${Math.round(m / 1440)}d ago`;
  return `Updated ${dayOf(d)}`;
}

/** The viewer page for one document, with the browser telemetry. The boot script pins `?file=` so the viewer's own /api/bundle and /api/events calls name the document. */
export function viewerHtml(file: string, title: string, nonce: string): string {
  const boot = `if(!new URLSearchParams(location.search).has('file')){var p=new URLSearchParams(location.search);p.set('file',${JSON.stringify(file)});history.replaceState(null,'',location.pathname+'?'+p.toString()+location.hash);}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(pageTitle(title))}</title>${FAVICON}${INSTALL_TAGS}${telemetryTag(nonce)}</head><body><div id="vantage"></div><script nonce="${nonce}">${boot}</script><script nonce="${nonce}" src="/viewer.js?v=${HUB_VERSION}"></script></body></html>`;
}

/** A read-only embed: the bundle is inlined with one view, no live reload, no fetches, no telemetry from the page it sits in. */
export function embedHtml(bundle: Record<string, unknown>, nonce: string): string {
  const json = JSON.stringify(bundle).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(String(bundle['title'] ?? 'Vantage'))}</title>${FAVICON}</head><body><div id="vantage"></div><script nonce="${nonce}">window.__VANTAGE__=${json};</script><script nonce="${nonce}" src="/viewer.js?v=${HUB_VERSION}"></script></body></html>`;
}

export { deviceApproveHtml, messageHtml, oauthApproveHtml, passcodeHtml, signInHtml } from './auth-pages.ts';
