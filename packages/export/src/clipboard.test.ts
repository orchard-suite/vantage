import { describe, expect, test } from 'bun:test';
import { unzlibSync } from 'fflate';
import { clipboardPng, clipboardSvg } from './clipboard.ts';
import { icons, layoutsOf } from './fixture.test-helper.ts';

describe('clipboard', () => {
  test('svg embeds the Inter faces as data urls', () => {
    const [layout] = layoutsOf('shop', ['context']);
    const svg = clipboardSvg(layout!, { icons });
    expect(svg).toContain('@font-face{font-family:Inter;');
    expect(svg.match(/url\(data:font\/woff2;base64,/g)?.length).toBe(3);
    expect(svg).toContain('class="v-canvas"');
    expect(clipboardSvg(layout!, { transparent: true })).not.toContain('class="v-canvas"');
  });

  test('png renders with and without a background', () => {
    const [layout] = layoutsOf('shop', ['context']);
    const opaque = clipboardPng(layout!, { icons, scale: 1 });
    const clear = clipboardPng(layout!, { icons, scale: 1, transparent: true });
    expect(opaque[0]).toBe(0x89);
    expect(clear[0]).toBe(0x89);
    expect(firstPixelAlpha(opaque)).toBe(255);
    expect(firstPixelAlpha(clear)).toBe(0);
  });
});

/** Alpha of the top left pixel: the first pixel of the first scanline has no neighbours, so every PNG filter leaves it raw. */
function firstPixelAlpha(png: Uint8Array): number {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off < png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === 'IHDR') expect(png[off + 8 + 9]).toBe(6);
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = unzlibSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  return raw[4]!;
}
