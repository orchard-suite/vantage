/**
 * Flow view layout: a flowchart with optional swimlanes. Steps are layered
 * with the same flow arrangement as relation views; lanes fix the cross
 * axis so a step always sits in the band of whoever owns it.
 */
import type { FlowStep, Model, ModelNode, ResolvedFlowView } from '@vantage/model';
import { arrangeFlow, type FlowItem } from './arrange/flow.ts';
import { shiftLayout } from './shift.ts';
import { placeLayers } from './arrange/place.ts';
import { assignPorts, type PortRequest, type Side } from './ports.ts';
import { DEFAULT_ROUTER, OrthogonalRouter, type RouteObstacle } from './route.ts';
import { straighten } from './straighten.ts';
import { placeLabel } from './labels.ts';
import { measureQuality } from './metrics.ts';
import { wrapText } from './text/measure.ts';
import { syntheticNode } from './synthetic.ts';
import { DEFAULT_STYLE, type LayoutStyle } from './style.ts';
import type { Extra, Layout, LayoutBox, LayoutEdge, TextBlock } from './types.ts';
import type { Rect } from './geometry.ts';

const SHAPE_OF: Record<NonNullable<FlowStep['shape']>, LayoutBox['shape']> = {
  start: 'pill',
  end: 'pill',
  process: 'rounded',
  decision: 'hexagon',
  io: 'box',
  subprocess: 'box',
  wait: 'pill',
  document: 'document',
};

function sizeStep(s: FlowStep, style: LayoutStyle): { w: number; h: number; text: ReturnType<typeof wrapText> } {
  const shape = s.shape ?? 'process';
  const f = style.flowStep;
  const decision = shape === 'decision';
  const text = wrapText(s.text, style.nameSize, 'medium', decision ? f.decisionMaxText : f.maxText, 3);
  const padX = decision ? f.decisionPadX : shape === 'start' || shape === 'end' ? f.pillPadX : f.padX;
  const padY = decision ? f.decisionPadY : f.padY;
  return { w: Math.max(decision ? f.decisionMinWidth : f.minWidth, Math.ceil(text.width + padX * 2)), h: Math.ceil(text.height + padY * 2), text };
}

export function layoutFlowView(model: Model, view: ResolvedFlowView, style: LayoutStyle = DEFAULT_STYLE): Layout {
  const direction = view.direction ?? 'down';
  const horizontal = direction === 'right';
  const sized = new Map(view.steps.map((s) => [s.id, sizeStep(s, style)]));
  const items: FlowItem[] = view.steps.map((s, i) => ({ id: s.id, role: s.shape === 'start' ? 'actor' : s.shape === 'end' ? 'data' : 'compute', order: i, externalIn: 0, externalOut: 0 }));
  const edges = view.edges.map((e) => ({ from: e.from, to: e.to, weight: 1 }));
  const flow = arrangeFlow(items, edges, [], view.layers ?? []);
  const lanes = view.lanes ?? [];
  const laneOf = new Map(view.steps.map((s) => [s.id, s.lane !== undefined ? lanes.indexOf(s.lane) : -1]));

  let placed: { id: string; rect: Rect }[];
  let size: { w: number; h: number };
  const extras: Extra[] = [];
  const labelRoom = new Map<number, number>();
  for (const e of view.edges) {
    if (!e.label) continue;
    const l = Math.min(flow.layer.get(e.from)!, flow.layer.get(e.to)!);
    const lw = wrapText(e.label, style.labelSize, 'regular', 120, 2);
    labelRoom.set(l, Math.max(labelRoom.get(l) ?? 0, horizontal ? lw.width + 24 : lw.height + 16));
  }
  const sizes = view.steps.map((s) => ({ id: s.id, size: { w: sized.get(s.id)!.w, h: sized.get(s.id)!.h } }));
  if (!lanes.length) {
    ({ placed, size } = placeLayers(flow, sizes, edges, { direction, siblingGap: style.siblingGap, layerGap: style.layerGap - 8, labelRoom, align: 'center' }));
  } else {
    // Lane bands along the cross axis; inside a band, stack by layer order.
    const laneTitle = 36;
    const laneGap = 0;
    const bandSize: number[] = lanes.map(() => 0);
    const laneLayerItems = new Map<string, string[]>();
    for (const [li, layer] of flow.layers.entries()) {
      for (const id of layer) {
        const k = `${laneOf.get(id)}|${li}`;
        laneLayerItems.set(k, [...(laneLayerItems.get(k) ?? []), id]);
      }
    }
    for (const [k, ids] of laneLayerItems) {
      const lane = Number(k.split('|')[0]);
      if (lane < 0) continue;
      const span = ids.reduce((a, id) => a + (horizontal ? sized.get(id)!.h : sized.get(id)!.w), 0) + (ids.length - 1) * style.siblingGap;
      bandSize[lane] = Math.max(bandSize[lane]!, span);
    }
    const bandStart: number[] = [];
    let c = 0;
    for (let i = 0; i < lanes.length; i++) {
      bandStart.push(c);
      bandSize[i] = Math.max(bandSize[i]!, 80) + 48;
      c += bandSize[i]! + laneGap;
    }
    const layerStart: number[] = [];
    const layerThick: number[] = [];
    let m = laneTitle + 24;
    for (const [li, layer] of flow.layers.entries()) {
      const thick = Math.max(0, ...layer.map((id) => (horizontal ? sized.get(id)!.w : sized.get(id)!.h)));
      layerStart.push(m);
      layerThick.push(thick);
      m += thick + style.layerGap - 8 + (labelRoom.get(li) ?? 0);
    }
    const mainTotal = m - (style.layerGap - 8) + 12;
    placed = [];
    for (const [k, ids] of laneLayerItems) {
      const [laneS, layerS] = k.split('|');
      const lane = Number(laneS), li = Number(layerS);
      const span = ids.reduce((a, id) => a + (horizontal ? sized.get(id)!.h : sized.get(id)!.w), 0) + (ids.length - 1) * style.siblingGap;
      let cross = (lane < 0 ? 0 : bandStart[lane]!) + ((lane < 0 ? c : bandSize[lane]!) - span) / 2;
      for (const id of ids) {
        const s = sized.get(id)!;
        const along = layerStart[li]! + (layerThick[li]! - (horizontal ? s.w : s.h)) / 2;
        placed.push({ id, rect: horizontal ? { x: along, y: cross, w: s.w, h: s.h } : { x: cross, y: along, w: s.w, h: s.h } });
        cross += (horizontal ? s.h : s.w) + style.siblingGap;
      }
    }
    size = horizontal ? { w: mainTotal, h: c } : { w: c, h: mainTotal };
    for (const [i, lane] of lanes.entries()) {
      const rect: Rect = horizontal
        ? { x: style.canvasPad, y: style.canvasPad + bandStart[i]!, w: mainTotal, h: bandSize[i]! }
        : { x: style.canvasPad + bandStart[i]!, y: style.canvasPad, w: bandSize[i]!, h: mainTotal };
      const title: TextBlock = horizontal
        ? { lines: [lane], size: style.nameSize, weight: 'semibold', x: 14, y: rect.h / 2 - style.nameSize * 0.6, lineHeight: style.nameSize * 1.25, anchor: 'start' }
        : { lines: [lane], size: style.nameSize, weight: 'semibold', x: rect.w / 2, y: 10, lineHeight: style.nameSize * 1.25, anchor: 'middle' };
      extras.push({ kind: 'lane', id: `lane-${i}`, rect, title });
    }
  }

  const boxes: LayoutBox[] = placed.map((p) => {
    const step = view.steps.find((s) => s.id === p.id)!;
    const sz = sized.get(p.id)!;
    const linked = step.node !== undefined ? model.nodes.get(step.node) : undefined;
    const node: ModelNode = linked ?? syntheticNode(step.id, step.text, { color: step.shape === 'decision' ? 'amber' : step.shape === 'start' || step.shape === 'end' ? 'emerald' : 'blue', ...(step.description !== undefined ? { description: step.description } : {}) });
    const text: TextBlock = { lines: sz.text.lines, size: style.nameSize, weight: 'medium', x: sz.w / 2, y: (sz.h - sz.text.height) / 2, lineHeight: sz.text.lineHeight, anchor: 'middle' };
    return { id: p.id, kind: 'leaf', depth: 0, node: { ...node, name: step.text }, shape: SHAPE_OF[step.shape ?? 'process'], frame: 'box', iconOnly: false, x: style.canvasPad + p.rect.x, y: style.canvasPad + p.rect.y, w: p.rect.w, h: p.rect.h, name: text };
  });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const branching = new Map<string, number>();
  for (const e of view.edges) branching.set(e.from, (branching.get(e.from) ?? 0) + 1);
  const requests: PortRequest[] = view.edges.map((e, i) => {
    const from = byId.get(e.from)!, to = byId.get(e.to)!;
    const sides = (branching.get(e.from) ?? 0) > 1 && from.shape === 'hexagon' ? branchSides(from, to, direction) : undefined;
    return { edgeId: `${e.from}>${e.to}#${i}`, from, to, fromId: e.from, toId: e.to, ...(sides ? { sides } : {}) };
  });
  const ports = assignPorts(requests, direction);
  const obstacles: RouteObstacle[] = boxes.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, hard: true }));
  const router = new OrthogonalRouter(obstacles, [...ports.values()].flatMap((p) => [p.fromPoint, p.toPoint]), { ...DEFAULT_ROUTER, margin: style.edgeMargin });
  // A line running along a lane border reads as the border: hold the borders like drawn lines, so routes cross them and keep off them.
  router.reserve(extras.flatMap((x, i, all) => {
    if (x.kind !== 'lane' || !all.slice(0, i).some((y) => y.kind === 'lane')) return [];
    const r = x.rect;
    return [horizontal ? { from: { x: r.x, y: r.y }, to: { x: r.x + r.w, y: r.y } } : { from: { x: r.x, y: r.y }, to: { x: r.x, y: r.y + r.h } }];
  }));
  const labelRects: Rect[] = [];
  const raw = view.edges.map((e, i) => {
    const id = `${e.from}>${e.to}#${i}`;
    const p = ports.get(id)!;
    return router.route({ id, from: p.fromPoint, to: p.toPoint, fromSide: p.fromSide, toSide: p.toSide, transparent: new Set([e.from, e.to]) });
  });
  const boxOf = new Map(boxes.map((b) => [b.id, b]));
  const straight = straighten(view.edges.map((e, i) => ({ id: String(i), points: raw[i]!, from: boxOf.get(e.from)!, to: boxOf.get(e.to)!, transparent: new Set([e.from, e.to]) })), boxes);
  const routes = raw.map((r, i) => straight.get(String(i)) ?? r);
  // A branch is named where it leaves its decision, so yes and no sit beside the step that asks.
  const decisions = new Set(view.steps.filter((s) => s.shape === 'decision').map((s) => s.id));
  const outgoing = new Map<string, number>();
  for (const e of view.edges) outgoing.set(e.from, (outgoing.get(e.from) ?? 0) + 1);
  const layoutEdges: LayoutEdge[] = view.edges.map((e, i) => {
    const id = `${e.from}>${e.to}#${i}`;
    const points = routes[i]!;
    const others = routes.flatMap((r, j) => (j === i ? [] : r.slice(1).map((q, k) => ({ a: r[k]!, b: q }))));
    const span = (outgoing.get(e.from) ?? 0) > 1 && decisions.has(e.from) ? points.slice(0, 3) : points;
    const label = e.label ? placeLabel(e.label, span, boxes, labelRects, { size: style.labelSize, pad: style.labelPad, maxWidth: 120 }, others) : undefined;
    if (label) labelRects.push(label);
    return {
      id,
      relation: { id, from: e.from, to: e.to, kind: e.kind ?? 'sync', via: [], tags: [], both: false, weight: 1, style: 'orthogonal', ...(e.label !== undefined ? { label: e.label } : {}) },
      from: e.from,
      to: e.to,
      kind: e.kind ?? 'sync',
      points,
      ...(label ? { label } : {}),
      both: false,
      bundled: 1,
      members: [`${e.from}>${e.to}`],
      reversed: flow.reversed.has(`${e.from}>${e.to}`),
      style: 'orthogonal',
    };
  });
  // A label or a line routed around the steps may hang past them; grow the canvas to hold it, and shift everything when it hangs past the origin.
  const pad = style.canvasPad;
  const hung: Rect[] = [...labelRects, ...layoutEdges.flatMap((e) => e.points.map((q) => ({ x: q.x, y: q.y, w: 0, h: 0 })))];
  const minX = Math.min(0, ...hung.map((r) => r.x - pad)), minY = Math.min(0, ...hung.map((r) => r.y - pad));
  const width = Math.ceil(Math.max(size.w + pad * 2, ...hung.map((r) => r.x + r.w + pad)) - minX);
  const height = Math.ceil(Math.max(size.h + pad * 2, ...hung.map((r) => r.y + r.h + pad)) - minY);
  const layout: Layout = { viewId: view.id, title: view.title, width, height, boxes, edges: layoutEdges, extras, metrics: measureQuality(boxes, layoutEdges, width, height, extras) };
  return minX < 0 || minY < 0 ? shiftLayout(layout, -minX, -minY) : layout;
}

/**
 * A decision's branches leave by its sides, the way a flowchart is drawn by
 * hand: a branch whose step sits off to one side leaves by that side and
 * drops onto the step's near edge; a branch straight ahead leaves by the front.
 */
function branchSides(from: Rect, to: Rect, direction: string): { fromSide: Side; toSide: Side } | undefined {
  const down = direction === 'down';
  const fc = down ? from.x + from.w / 2 : from.y + from.h / 2;
  const tc = down ? to.x + to.w / 2 : to.y + to.h / 2;
  const half = (down ? from.w : from.h) / 4;
  if (Math.abs(tc - fc) <= half) return undefined;
  if (down) return { fromSide: tc < fc ? 'left' : 'right', toSide: 'top' };
  return { fromSide: tc < fc ? 'top' : 'bottom', toSide: 'left' };
}
