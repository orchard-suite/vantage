import { describe, expect, test } from 'bun:test';
import { fitAll, frame, MAX_FRAME, NO_INSETS, opening, OPEN_FLOOR, PHONE_FLOOR, wholeFrame, regionCamera, reveal, union, visibleRegion, type Viewport } from './camera.ts';

const vp: Viewport = { width: 1000, height: 600, insets: NO_INSETS };

describe('camera', () => {
  test('fit all centres the picture in the visible area left by the insets', () => {
    const cam = fitAll({ ...vp, insets: { top: 0, right: 200, bottom: 0, left: 0 } }, { w: 400, h: 200 }, 0);
    expect(cam.scale).toBe(1.6);
    expect(cam.tx + 200 * cam.scale).toBe(400);
  });

  test('a tall picture opens fitted to the width at the top instead of shrunk to a strip', () => {
    const tall = { w: 800, h: 4000 };
    expect(fitAll(vp, tall, 20).scale).toBeLessThan(0.2);
    const cam = opening(vp, tall, 20);
    expect(cam.scale).toBe(1);
    expect(cam.ty).toBe(20);
  });

  test('a picture too big to read whole opens at its width when that reads, and readable at its left edge when not', () => {
    const phone: Viewport = { width: 390, height: 700, insets: NO_INSETS };
    const cam = opening(phone, { w: 1500, h: 600 }, 12);
    expect(cam.scale).toBe(PHONE_FLOOR);
    expect(cam.tx).toBe(12);
    const wide = opening(vp, { w: 1600, h: 2400 }, 20);
    expect(wide.tx + 1600 * wide.scale).toBeCloseTo(1000 - 20);
  });

  test('a picture too wide to read even at its width opens framed on its first story step, as the story frames it', () => {
    const step = { x: 2000, y: 400, w: 300, h: 100 };
    const content = { w: 4000, h: 900 };
    expect(opening(vp, content, 20, 900, step)).toEqual(frame(vp, content, step, 20));
    expect(opening(vp, content, 20, 900, step).scale).toBe(MAX_FRAME);
  });

  test('a drawing that reads whole opens whole with the prose under it left to scroll to', () => {
    const cam = opening(vp, { w: 900, h: 1100 }, 20, 520);
    expect(cam.scale).toBeGreaterThanOrEqual(OPEN_FLOOR);
    expect(cam.ty + 520 * cam.scale).toBeLessThanOrEqual(600 - 20);
  });

  test('a picture that reads at the whole fit opens at the whole fit', () => {
    expect(opening(vp, { w: 900, h: 500 }, 20)).toEqual(fitAll(vp, { w: 900, h: 500 }, 20));
  });

  test('a step frame zooms in on a small rect, capped, and centres it', () => {
    const cam = frame(vp, { w: 4000, h: 4000 }, { x: 1000, y: 1000, w: 100, h: 50 }, 40);
    expect(cam.scale).toBe(MAX_FRAME);
    expect(cam.tx + 1050 * cam.scale).toBe(500);
    expect(cam.ty + 1025 * cam.scale).toBe(300);
  });

  test('a step frame never zooms out past the whole-picture fit', () => {
    const content = { w: 500, h: 300 };
    expect(frame(vp, content, { x: 0, y: 0, w: 500, h: 300 }, 40).scale).toBe(Math.min(fitAll(vp, content, 40).scale, MAX_FRAME));
  });

  test('reveal pans only as far as needed to clear a panel', () => {
    const insets = { top: 0, right: 300, bottom: 0, left: 0 };
    const cam = reveal({ ...vp, insets }, { scale: 1, tx: 0, ty: 0 }, { x: 650, y: 100, w: 100, h: 50 }, 20);
    expect(cam.tx).toBe(-70);
    expect(cam.ty).toBe(0);
  });

  test('union bounds several rects', () => {
    expect(union([{ x: 0, y: 10, w: 5, h: 5 }, { x: 20, y: 0, w: 5, h: 5 }])).toEqual({ x: 0, y: 0, w: 25, h: 15 });
    expect(union([])).toBeUndefined();
  });

  test('a follower sees the region the leader sees, whole and centred in its own viewport', () => {
    const leader: Viewport = { width: 1000, height: 600, insets: { top: 100, right: 0, bottom: 0, left: 0 } };
    const r = visibleRegion(leader, { scale: 2, tx: -100, ty: 50 });
    expect(r).toEqual({ x: 50, y: 25, w: 500, h: 250 });
    const phone: Viewport = { width: 400, height: 800, insets: NO_INSETS };
    const cam = regionCamera(phone, r);
    expect(cam.scale).toBe(0.8);
    // The region's centre lands on the phone's centre.
    expect(cam.tx + 300 * cam.scale).toBe(200);
    expect(cam.ty + 150 * cam.scale).toBe(400);
    expect(visibleRegion(leader, regionCamera(leader, r))).toEqual(r);
    // A region too small to show at the deepest zoom stays centred at that zoom.
    const deep = regionCamera(phone, { x: 100, y: 100, w: 2, h: 2 }, (s) => Math.min(s, 4));
    expect(deep.scale).toBe(4);
    expect(deep.tx + 101 * 4).toBe(200);
  });

  test('a step frame takes in a box it would cut in half when most of it shows, and leaves one mostly outside', () => {
    const content = { w: 4000, h: 4000 };
    const step = { x: 1000, y: 1000, w: 400, h: 200 };
    const region = visibleRegion(vp, frame(vp, content, step, 20));
    const mostlyIn = { x: region.x + region.w - 60, y: 1050, w: 100, h: 60 };
    const mostlyOut = { x: region.x - 90, y: 1050, w: 100, h: 60 };
    const whole = wholeFrame(vp, content, step, [mostlyIn, mostlyOut], 20);
    expect(whole.x + whole.w).toBe(mostlyIn.x + mostlyIn.w);
    expect(whole.x).toBe(step.x);
  });
});
