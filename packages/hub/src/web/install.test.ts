import { describe, expect, test } from 'bun:test';
import { testApp } from '../testing.ts';
import { page, viewerHtml } from './html.ts';

// A Home Screen or a desktop install fetches the icon and the manifest the page names, with no session.
// A path that misses gives the device nothing to draw, and it draws a letter instead.
const SIZES: Record<string, string> = { '/apple-touch-icon.png': '180x180', '/icon-192.png': '192x192', '/icon-512.png': '512x512' };

function pngSize(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

describe('installing the hub as an app', () => {
  test('the icons and the manifest answer anyone, at the sizes they claim', async () => {
    const t = await testApp();
    expect((await t.app.request('/')).status).toBe(401);
    for (const [path, size] of Object.entries(SIZES)) {
      const res = await t.app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toBe(size);
    }
    const res = await t.app.request('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/manifest+json');
    const manifest = (await res.json()) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; purpose: string }[] };
    expect(manifest.name).toBe('Vantage');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of manifest.icons) expect(SIZES[icon.src]).toBe(icon.sizes);
    await t.ctx.db.close();
  });

  test('every hub page head names the icon and the manifest', () => {
    for (const html of [page('Home', '', 'n'), viewerHtml('w/d', 'A diagram', 'n')]) {
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain('<link rel="icon"');
      expect(head).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
      expect(head).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">');
      expect(head).toContain('<meta name="apple-mobile-web-app-title" content="Vantage">');
      expect(head).toContain('<meta name="theme-color"');
    }
  });
});
