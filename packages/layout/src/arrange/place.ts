/**
 * Coordinates for a flow arrangement. Layers run along the main axis; inside
 * a layer, children stack along the cross axis. A straightening pass pulls
 * every child toward the centre of its neighbours so single-successor
 * chains become straight lines, which is what the eye follows.
 */
import type { Direction } from '@vantage/model';
import type { Rect, Size } from '../geometry.ts';
import type { FlowResult, FlowEdgeIn } from './flow.ts';

export interface PlaceOptions {
  readonly direction: Direction;
  readonly siblingGap: number;
  readonly layerGap: number;
  /** Extra main-axis room after each layer index for edge labels. */
  readonly labelRoom: ReadonlyMap<number, number>;
  readonly align: 'start' | 'center' | 'end';
}

export function placeLayers(flow: FlowResult, sizes: readonly { id: string; size: Size }[], edges: readonly FlowEdgeIn[], opts: PlaceOptions): { placed: { id: string; rect: Rect }[]; size: Size } {
  const horizontal = opts.direction === 'right' || opts.direction === 'left';
  const sizeOf = new Map(sizes.map((s) => [s.id, s.size]));
  const main = (id: string): number => (horizontal ? sizeOf.get(id)!.w : sizeOf.get(id)!.h);
  const cross = (id: string): number => (horizontal ? sizeOf.get(id)!.h : sizeOf.get(id)!.w);

  // Main axis: each layer is as thick as its thickest child.
  const layerStart: number[] = [];
  const layerThick: number[] = [];
  let m = 0;
  flow.layers.forEach((layer, i) => {
    const thick = Math.max(0, ...layer.map(main));
    layerStart.push(m);
    layerThick.push(thick);
    m += thick + opts.layerGap + (opts.labelRoom.get(i) ?? 0);
  });
  const mainTotal = m - opts.layerGap - (opts.labelRoom.get(flow.layers.length - 1) ?? 0);

  // Cross axis: initial stacking, centred per layer.
  const pos = new Map<string, number>();
  const layerSpan = flow.layers.map((layer) => layer.reduce((a, id) => a + cross(id), 0) + Math.max(0, layer.length - 1) * opts.siblingGap);
  const maxSpan = Math.max(0, ...layerSpan);
  flow.layers.forEach((layer, i) => {
    let c = (maxSpan - layerSpan[i]!) / 2;
    for (const id of layer) {
      pos.set(id, c);
      c += cross(id) + opts.siblingGap;
    }
  });

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of sizeOf.keys()) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of edges) {
    const lf = flow.layer.get(e.from)!, lt = flow.layer.get(e.to)!;
    if (lf < lt) {
      preds.get(e.to)!.push(e.from);
      succs.get(e.from)!.push(e.to);
    } else if (lf > lt) {
      preds.get(e.from)!.push(e.to);
      succs.get(e.to)!.push(e.from);
    }
  }
  const centre = (id: string): number => pos.get(id)! + cross(id) / 2;

  const sweep = (layers: string[][], neighbours: Map<string, string[]>): void => {
    for (const layer of layers) {
      const targets = new Map<string, number>();
      for (const id of layer) {
        const ns = neighbours.get(id)!;
        if (ns.length) targets.set(id, ns.reduce((a, n) => a + centre(n), 0) / ns.length - cross(id) / 2);
      }
      if (!targets.size) continue;
      // Place in order with minimum gaps, pulling toward targets; two passes resolve pushes both ways.
      const byPriority = [...layer].sort((a, b) => (neighbours.get(b)!.length - neighbours.get(a)!.length) || layer.indexOf(a) - layer.indexOf(b));
      for (const id of byPriority) {
        const t = targets.get(id);
        if (t === undefined) continue;
        const i = layer.indexOf(id);
        const lo = i > 0 ? pos.get(layer[i - 1]!)! + cross(layer[i - 1]!) + opts.siblingGap : -Infinity;
        const hi = i + 1 < layer.length ? pos.get(layer[i + 1]!)! - cross(id) - opts.siblingGap : Infinity;
        pos.set(id, Math.max(lo, Math.min(hi, t)));
      }
      // Resolve any overlap left by priority placement.
      for (let i = 1; i < layer.length; i++) {
        const prev = layer[i - 1]!, cur = layer[i]!;
        const min = pos.get(prev)! + cross(prev) + opts.siblingGap;
        if (pos.get(cur)! < min) pos.set(cur, min);
      }
      for (let i = layer.length - 2; i >= 0; i--) {
        const next = layer[i + 1]!, cur = layer[i]!;
        const max = pos.get(next)! - cross(cur) - opts.siblingGap;
        if (pos.get(cur)! > max) pos.set(cur, max);
      }
    }
  };
  for (let round = 0; round < 3; round++) {
    sweep(flow.layers.slice(1), preds);
    sweep([...flow.layers].reverse().slice(1), succs);
  }
  sweep(flow.layers.slice(1), preds);

  const minPos = Math.min(0, ...[...pos.values()]);
  const crossTotal = Math.max(...[...pos.entries()].map(([id, p]) => p - minPos + cross(id)));
  const placed = [...sizeOf.keys()].map((id) => {
    const l = flow.layer.get(id)!;
    const along = layerStart[l]! + (opts.align === 'center' ? (layerThick[l]! - main(id)) / 2 : opts.align === 'end' ? layerThick[l]! - main(id) : 0);
    const across = pos.get(id)! - minPos;
    const flipMain = opts.direction === 'left' || opts.direction === 'up';
    const a = flipMain ? mainTotal - along - main(id) : along;
    const s = sizeOf.get(id)!;
    return { id, rect: horizontal ? { x: a, y: across, w: s.w, h: s.h } : { x: across, y: a, w: s.w, h: s.h } };
  });
  return { placed, size: horizontal ? { w: mainTotal, h: crossTotal } : { w: crossTotal, h: mainTotal } };
}
