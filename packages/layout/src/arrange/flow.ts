/**
 * The flow arrangement: a layered layout for the children of one container.
 *
 * Differences from a stock Sugiyama pass, each chosen to make the result
 * read like a human drew it:
 *  - cycles are broken by reversing the fewest edges (greedy feedback arc
 *    set), never by deleting them;
 *  - entry points (children that receive from outside the container) are
 *    pulled to the first layer and exits to the last, so flow enters on one
 *    side and leaves on the other;
 *  - type roles bias isolated children (actors first, data last);
 *  - order inside a layer is barycenter sweeps with the author's source order
 *    as the tie-breaker, so the text order is the intent and reordering the
 *    file still works when the author wants it to.
 */
import type { NodeRole } from '@vantage/model';

export interface FlowItem {
  readonly id: string;
  readonly role: NodeRole;
  /** Position in the author's file; the tiebreaker everywhere. */
  readonly order: number;
  readonly externalIn: number;
  readonly externalOut: number;
}

export interface FlowEdgeIn {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
}

export interface FlowResult {
  /** Layer index per item, 0 is the start of the flow. */
  readonly layer: Map<string, number>;
  /** Items per layer in their final order. */
  readonly layers: string[][];
  readonly reversed: Set<string>;
}

const ROLE_RANK: Record<NodeRole, number> = { actor: 0, edge: 1, compute: 2, platform: 2, boundary: 2, data: 3, external: 3 };

export function arrangeFlow(items: readonly FlowItem[], edgesIn: readonly FlowEdgeIn[], explicitOrder: readonly string[] = [], explicitLayers: readonly (readonly string[])[] = []): FlowResult {
  const ids = items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = new Map(ids.map((id, i) => [id, i]));
  for (const [i, id] of explicitOrder.entries()) if (order.has(id)) order.set(id, i - explicitOrder.length);

  const edges = dedupe(edgesIn.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to));
  const reversed = breakCycles(ids, edges, order);
  const dag = edges.map((e) => (reversed.has(`${e.from}>${e.to}`) ? { from: e.to, to: e.from, weight: e.weight } : e));

  const layer = assignLayers(ids, dag, byId, order);
  applyTiers(layer, explicitLayers);
  const layers = orderLayers(ids, dag, layer, order);
  return { layer, layers, reversed };
}

/** Author-named tiers win over computed layers; unnamed children keep their computed layer, shifted to fit after the tiers they depend on. */
function applyTiers(layer: Map<string, number>, tiers: readonly (readonly string[])[]): void {
  if (!tiers.length) return;
  const named = new Map<string, number>();
  tiers.forEach((tier, i) => tier.forEach((id) => named.set(id, i)));
  if (![...named.keys()].some((id) => layer.has(id))) return;
  for (const [id, t] of named) if (layer.has(id)) layer.set(id, t);
  const used = [...new Set([...layer.values()])].sort((a, b) => a - b);
  const remap = new Map(used.map((l, i) => [l, i]));
  for (const [id, l] of layer) layer.set(id, named.has(id) ? named.get(id)! : remap.get(l)!);
}

function dedupe(edges: readonly FlowEdgeIn[]): FlowEdgeIn[] {
  const m = new Map<string, FlowEdgeIn>();
  for (const e of edges) {
    const k = `${e.from}>${e.to}`;
    const prev = m.get(k);
    m.set(k, prev ? { ...prev, weight: prev.weight + e.weight } : e);
  }
  return [...m.values()];
}

/** Eades, Lin, Smyth greedy feedback arc set; ties broken by source order so results are stable. */
function breakCycles(ids: readonly string[], edges: readonly FlowEdgeIn[], order: Map<string, number>): Set<string> {
  const remaining = new Set(ids);
  const outs = new Map<string, FlowEdgeIn[]>();
  const ins = new Map<string, FlowEdgeIn[]>();
  for (const id of ids) {
    outs.set(id, []);
    ins.set(id, []);
  }
  for (const e of edges) {
    outs.get(e.from)!.push(e);
    ins.get(e.to)!.push(e);
  }
  const s1: string[] = [];
  const s2: string[] = [];
  const degree = (list: FlowEdgeIn[] | undefined): number => (list ?? []).filter((e) => remaining.has(e.from) && remaining.has(e.to)).reduce((a, e) => a + e.weight, 0);
  while (remaining.size) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...remaining].sort((a, b) => order.get(a)! - order.get(b)!)) {
        if (degree(outs.get(id)) === 0) {
          s2.unshift(id);
          remaining.delete(id);
          changed = true;
        } else if (degree(ins.get(id)) === 0) {
          s1.push(id);
          remaining.delete(id);
          changed = true;
        }
      }
    }
    if (!remaining.size) break;
    let best: string | undefined;
    let bestScore = -Infinity;
    for (const id of [...remaining].sort((a, b) => order.get(a)! - order.get(b)!)) {
      const score = degree(outs.get(id)) - degree(ins.get(id));
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    s1.push(best!);
    remaining.delete(best!);
  }
  const pos = new Map([...s1, ...s2].map((id, i) => [id, i]));
  const reversed = new Set<string>();
  for (const e of edges) if (pos.get(e.from)! > pos.get(e.to)!) reversed.add(`${e.from}>${e.to}`);
  return reversed;
}

function assignLayers(ids: readonly string[], dag: readonly FlowEdgeIn[], byId: Map<string, FlowItem>, order: Map<string, number>): Map<string, number> {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of dag) {
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
  }
  const layer = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    let l = 0;
    for (const p of preds.get(id)!) l = Math.max(l, visit(p, stack) + 1);
    stack.delete(id);
    layer.set(id, l);
    return l;
  };
  for (const id of ids) visit(id, new Set());

  const connected = new Set<string>();
  for (const e of dag) {
    connected.add(e.from);
    connected.add(e.to);
  }
  let max = Math.max(0, ...[...connected].map((id) => layer.get(id)!));

  // Sinks with slack sit next to their last predecessor instead of in the final layer,
  // unless they are exits (send outside) or data stores, which read better at the end.
  for (const id of connected) {
    const item = byId.get(id)!;
    if (succs.get(id)!.length === 0 && item.externalOut === 0 && item.role !== 'data' && item.role !== 'external') {
      const p = Math.max(-1, ...preds.get(id)!.map((x) => layer.get(x)!));
      layer.set(id, p + 1);
    }
  }
  // Entry points move to the first layer when nothing inside feeds them.
  for (const id of connected) {
    const item = byId.get(id)!;
    if (item.externalIn > 0 && preds.get(id)!.length === 0) layer.set(id, 0);
    if (item.externalOut > 0 && succs.get(id)!.length === 0 && item.externalIn === 0) layer.set(id, max);
  }
  // Isolated children: by role, so actors lead and stores trail even with no arrows.
  const isolated = ids.filter((id) => !connected.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  if (isolated.length) {
    if (!connected.size) {
      isolated.forEach((id) => layer.set(id, 0));
    } else {
      for (const id of isolated) {
        const item = byId.get(id)!;
        if (item.externalIn > 0 && item.externalOut === 0) layer.set(id, 0);
        else if (item.externalOut > 0 && item.externalIn === 0) layer.set(id, max);
        else {
          const rank = ROLE_RANK[item.role];
          layer.set(id, rank === 0 ? 0 : rank >= 3 ? max : Math.min(max, Math.round(max / 2)));
        }
      }
    }
  }
  max = Math.max(0, ...[...layer.values()]);
  // Compact empty layers.
  const used = [...new Set([...layer.values()])].sort((a, b) => a - b);
  const remap = new Map(used.map((l, i) => [l, i]));
  for (const [id, l] of layer) layer.set(id, remap.get(l)!);
  return layer;
}

/** Prefix of the stand-ins a long edge leaves on each layer it skips, so ordering sees where it passes. */
const VIA = '\u0000via:';

/**
 * Layer order with long edges counted: an edge that skips layers gets a
 * stand-in on each one, ordered like a box, so the sweeps untangle it too.
 * The stand-ins are dropped from the result.
 */
function orderLayers(ids: readonly string[], dag: readonly FlowEdgeIn[], layer: Map<string, number>, order: Map<string, number>): string[][] {
  const allIds = [...ids];
  const allDag: FlowEdgeIn[] = [];
  const lay = new Map(layer);
  const ord = new Map(order);
  dag.forEach((e, i) => {
    const lf = layer.get(e.from)!, lt = layer.get(e.to)!;
    if (Math.abs(lt - lf) <= 1) return allDag.push(e);
    const step = lt > lf ? 1 : -1;
    let prev = e.from;
    for (let l = lf + step; l !== lt; l += step) {
      const v = `${VIA}${i}:${l}`;
      allIds.push(v);
      lay.set(v, l);
      ord.set(v, order.get(e.from)!);
      allDag.push({ from: prev, to: v, weight: e.weight });
      prev = v;
    }
    allDag.push({ from: prev, to: e.to, weight: e.weight });
  });
  return orderWithStandIns(allIds, allDag, lay, ord).map((l) => l.filter((id) => !id.startsWith(VIA)));
}

function orderWithStandIns(ids: readonly string[], dag: readonly FlowEdgeIn[], layer: Map<string, number>, order: Map<string, number>): string[][] {
  const count = Math.max(0, ...[...layer.values()]) + 1;
  const layers: string[][] = Array.from({ length: count }, () => []);
  for (const id of [...ids].sort((a, b) => order.get(a)! - order.get(b)!)) layers[layer.get(id)!]!.push(id);
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of dag) {
    if (layer.get(e.from)! < layer.get(e.to)!) {
      preds.get(e.to)!.push(e.from);
      succs.get(e.from)!.push(e.to);
    } else if (layer.get(e.from)! > layer.get(e.to)!) {
      preds.get(e.from)!.push(e.to);
      succs.get(e.to)!.push(e.from);
    }
  }
  const pos = new Map<string, number>();
  const refresh = (): void => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  refresh();
  const bary = (id: string, neighbours: string[]): number | undefined => {
    if (!neighbours.length) return undefined;
    return neighbours.reduce((a, n) => a + pos.get(n)!, 0) / neighbours.length;
  };
  let best = layers.map((l) => [...l]);
  let bestCrossings = countCrossings(layers, dag, layer, pos);
  for (let iter = 0; iter < 12; iter++) {
    const down = iter % 2 === 0;
    const range = down ? layers.keys() : [...layers.keys()].reverse();
    for (const li of range) {
      const l = layers[li]!;
      const keyed = l.map((id) => ({ id, b: bary(id, down ? preds.get(id)! : succs.get(id)!), o: order.get(id)! }));
      const fixed = keyed.filter((k) => k.b === undefined);
      const moving = keyed.filter((k) => k.b !== undefined).sort((a, b) => a.b! - b.b! || a.o - b.o);
      // Items with no neighbours keep their relative order and stay where the author put them.
      const merged: typeof keyed = [];
      let mi = 0;
      for (const k of keyed) {
        if (k.b === undefined) merged.push(k);
        else merged.push(moving[mi++]!);
      }
      void fixed;
      layers[li] = merged.map((k) => k.id);
    }
    refresh();
    transpose(layers, dag, layer, pos);
    refresh();
    const c = countCrossings(layers, dag, layer, pos);
    if (c < bestCrossings) {
      bestCrossings = c;
      best = layers.map((l) => [...l]);
    }
    if (c === 0) break;
  }
  return best;
}

function countCrossings(layers: string[][], dag: readonly FlowEdgeIn[], layer: Map<string, number>, pos: Map<string, number>): number {
  let crossings = 0;
  const spans = dag.filter((e) => layer.get(e.from) !== layer.get(e.to));
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!, b = spans[j]!;
      const al0 = Math.min(layer.get(a.from)!, layer.get(a.to)!), bl0 = Math.min(layer.get(b.from)!, layer.get(b.to)!);
      if (al0 !== bl0) continue;
      const [a1, a2] = layer.get(a.from)! < layer.get(a.to)! ? [a.from, a.to] : [a.to, a.from];
      const [b1, b2] = layer.get(b.from)! < layer.get(b.to)! ? [b.from, b.to] : [b.to, b.from];
      const d1 = pos.get(a1)! - pos.get(b1)!, d2 = pos.get(a2)! - pos.get(b2)!;
      if (d1 * d2 < 0) crossings++;
    }
  }
  void layers;
  return crossings;
}

function transpose(layers: string[][], dag: readonly FlowEdgeIn[], layer: Map<string, number>, pos: Map<string, number>): void {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 20) {
    improved = false;
    for (const l of layers) {
      for (let i = 0; i + 1 < l.length; i++) {
        const before = countCrossings(layers, dag, layer, pos);
        [l[i], l[i + 1]] = [l[i + 1]!, l[i]!];
        l.forEach((id, k) => pos.set(id, k));
        const after = countCrossings(layers, dag, layer, pos);
        if (after < before) {
          improved = true;
        } else {
          [l[i], l[i + 1]] = [l[i + 1]!, l[i]!];
          l.forEach((id, k) => pos.set(id, k));
        }
      }
    }
  }
}
