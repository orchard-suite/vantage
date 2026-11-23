/**
 * Installing the hub as an app: the Home Screen and desktop icons, the web
 * app manifest, and the head tags that name them. A device fetches the
 * icons and the manifest without a session, so the hub serves them to
 * anyone, before it looks for a sign in. A sign-in proxy in front of the hub
 * still wants its cookie, and a browser sends none with a manifest fetch
 * unless the link asks for credentials.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { DARK } from '@vantage/render';
import type { HubEnv } from './env.ts';

const APP_DIR = join(import.meta.dir, '..', '..', 'assets', 'app');
const NAME = 'Vantage';
const CACHE = 'public, max-age=86400';

/** Each icon by its path, rendered from app-icon.svg beside it. */
const ICONS = ['/apple-touch-icon.png', '/icon-192.png', '/icon-512.png'] as const;

const MANIFEST = JSON.stringify({
  name: NAME,
  short_name: NAME,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: DARK.bg,
  theme_color: DARK.bg,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

/** The head tags every hub page carries, so it opens as its own app once added to a Home Screen or installed. */
export const INSTALL_TAGS = [
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">',
  `<meta name="theme-color" content="${DARK.bg}">`,
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  `<meta name="apple-mobile-web-app-title" content="${NAME}">`,
  '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
].join('');

export function installRoutes(): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  for (const path of ICONS) {
    const bytes = new Uint8Array(readFileSync(join(APP_DIR, path.slice(1))));
    app.get(path, (c) => c.body(bytes, 200, { 'content-type': 'image/png', 'cache-control': CACHE }));
  }
  app.get('/manifest.webmanifest', (c) => c.body(MANIFEST, 200, { 'content-type': 'application/manifest+json', 'cache-control': CACHE }));
  return app;
}
