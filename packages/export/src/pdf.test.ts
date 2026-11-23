import { describe, expect, test } from 'bun:test';
import { pdfPageCount, renderPdf } from './pdf.ts';
import { icons, layoutsOf } from './fixture.test-helper.ts';

describe('pdf', () => {
  test('one page per view with the Inter faces embedded', async () => {
    const [a, b, c] = layoutsOf('harbor', ['context', 'requests', 'cutover']);
    const pdf = await renderPdf([{ layout: a! }, { layout: b! }, { layout: c! }], { icons, page: 'A4' });
    expect(pdf[0]).toBe(0x25);
    expect(pdfPageCount(pdf)).toBe(3);
    const text = Buffer.from(pdf).toString('latin1');
    expect(text).toContain('Inter-SemiBold');
    expect(text).toContain('Inter-Medium');
    expect(text).toContain('\n(vantage)\n');
  });

  test('fit pages take the layout size plus margins and carry the title block', async () => {
    const [layout] = layoutsOf('shop', ['context']);
    const block = { title: 'Shop', author: 'Platform team', published: '2026-10-28' };
    const pdf = await renderPdf([{ layout: layout!, titleBlock: block }], { page: 'fit', margin: 10 });
    expect(pdfPageCount(pdf)).toBe(1);
    const text = Buffer.from(pdf).toString('latin1');
    expect(text).toMatch(new RegExp(`/MediaBox \\[0 0 ${layout!.width + 20} `));
    expect(text).toContain('\n(Shop)\n');
    expect(text).toContain('\n(Platform team)\n');
  });

  test('orientation follows the picture unless forced', async () => {
    const [layout] = layoutsOf('shop', ['context']);
    const auto = Buffer.from(await renderPdf([{ layout: layout! }], { page: 'Letter' })).toString('latin1');
    const portrait = Buffer.from(await renderPdf([{ layout: layout! }], { page: 'Letter', orientation: 'portrait' })).toString('latin1');
    expect(auto).toContain(layout!.width > layout!.height ? '/MediaBox [0 0 792 612]' : '/MediaBox [0 0 612 792]');
    expect(portrait).toContain('/MediaBox [0 0 612 792]');
  });
});
