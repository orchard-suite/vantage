import { describe, expect, test } from 'bun:test';
import { declaredSize, PictureTooLargeError, PNG_PIXEL_BUDGET, pngSize, renderPng } from './png.ts';

const square = (side: number, attrs = `width="${side}" height="${side}"`): string => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="${side}" height="${side}" fill="#36c"/></svg>`;

describe('png pixel budget', () => {
  test('a small picture draws at the scale asked for', () => {
    const png = renderPng(square(40), { scale: 2 });
    expect([png.width, png.height, png.scale, png.wanted]).toEqual([80, 80, 2, 2]);
    expect([...png.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  test('a picture past the budget at 2x draws smaller, within the budget', () => {
    const png = renderPng(square(4000), { scale: 2 });
    expect(png.wanted).toBe(2);
    expect(png.scale).toBeCloseTo(Math.sqrt(PNG_PIXEL_BUDGET / 16_000_000), 3);
    expect(png.width * png.height).toBeLessThanOrEqual(PNG_PIXEL_BUDGET);
  });

  test('the budget holds when only a viewBox gives the size, and for a width request', () => {
    expect(renderPng(square(4000, 'viewBox="0 0 4000 4000"'), { scale: 2 }).width).toBeLessThan(5700);
    expect(renderPng(square(4000), { width: 12_000 }).width).toBeLessThan(5700);
  });

  test('a picture too large to read even at the smallest scale is refused before drawing', () => {
    const start = performance.now();
    expect(() => renderPng(square(20_000), { scale: 2 })).toThrow(PictureTooLargeError);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  test('a PNG says its size in its header', () => {
    expect(pngSize(renderPng(square(30), { scale: 2 }).bytes)).toEqual({ width: 60, height: 60 });
    expect(pngSize(new TextEncoder().encode('not a png at all, not at all'))).toBeUndefined();
  });

  test('the size comes from the root element without parsing the picture', () => {
    expect(declaredSize('<svg width="7814" height="6267" viewBox="0 0 7814 6267">')).toEqual({ width: 7814, height: 6267 });
    expect(declaredSize('<svg viewBox="0 0 10 20">')).toEqual({ width: 10, height: 20 });
    expect(declaredSize('<svg width="100%" height="50%">')).toBeUndefined();
  });
});
