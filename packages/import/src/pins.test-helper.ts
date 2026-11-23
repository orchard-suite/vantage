/** Shared check: every pinned box of a laid-out view sits at its pin, up to the canvas offset. */
import { expect } from 'bun:test';
import { layoutView } from '@vantage/layout';
import type { Model } from '@vantage/model';

export function expectPinsHonoured(model: Model, viewId: string): void {
  const view = model.views.find((v) => v.id === viewId);
  if (!view || view.kind !== 'relation' || !view.pins) throw new Error(`no pinned relation view ${viewId}`);
  const layout = layoutView(model, view);
  let offset: { x: number; y: number } | undefined;
  for (const b of layout.boxes) {
    const pin = view.pins.nodes[b.id];
    expect(pin).toBeDefined();
    if (!pin) continue;
    offset ??= { x: b.x - pin.x, y: b.y - pin.y };
    expect(Math.abs(b.x - pin.x - offset.x)).toBeLessThan(0.5);
    expect(Math.abs(b.y - pin.y - offset.y)).toBeLessThan(0.5);
    expect(Math.abs(b.w - pin.w)).toBeLessThan(0.5);
    expect(Math.abs(b.h - pin.h)).toBeLessThan(0.5);
  }
  expect(layout.boxes.length).toBe(Object.keys(view.pins.nodes).length);
}
