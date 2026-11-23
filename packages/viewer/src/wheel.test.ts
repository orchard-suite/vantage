import { describe, expect, test } from 'bun:test';
import { wheelZoom, ZOOM_STEP, type WheelInput } from './wheel.ts';

const wheel = (over: Partial<WheelInput>): WheelInput => ({ deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...over });

describe('wheel', () => {
  test('a mouse notch of 120 pixels zooms one button step, in when rolled up', () => {
    expect(wheelZoom(wheel({ deltaY: -120 }))).toBeCloseTo(ZOOM_STEP);
    expect(wheelZoom(wheel({ deltaY: 120 }))).toBeCloseTo(1 / ZOOM_STEP);
  });

  test('a fast spin zooms no more than one step per event', () => {
    expect(wheelZoom(wheel({ deltaY: 400 }))).toBeCloseTo(1 / ZOOM_STEP);
  });

  test('a wheel that counts in lines zooms one step per event', () => {
    expect(wheelZoom(wheel({ deltaY: 3, deltaMode: 1 }))).toBeCloseTo(1 / ZOOM_STEP);
  });

  test('a small trackpad scroll zooms a little, never pans', () => {
    const f = wheelZoom(wheel({ deltaY: -2 }));
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThan(1.01);
  });

  test('a sideways wheel does nothing', () => {
    expect(wheelZoom(wheel({ deltaY: 0 }))).toBe(1);
  });

  test('a trackpad pinch zooms by its size, faster than a scroll', () => {
    expect(wheelZoom(wheel({ deltaY: -10, ctrlKey: true }))).toBeCloseTo(Math.exp(0.1));
  });

  test('control with a mouse wheel zooms no more than one step per notch', () => {
    expect(wheelZoom(wheel({ deltaY: 120, ctrlKey: true }))).toBeCloseTo(1 / ZOOM_STEP);
  });
});
