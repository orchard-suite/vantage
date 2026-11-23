/** A finished picture as the viewer receives it: the SVG and the geometry it morphs and wires. Runs in a browser too. */
import type { Layout } from '@vantage/layout';

export type Json = Record<string, unknown>;

function boxesOf(layout: Layout): Json[] {
  return layout.boxes.map((b) => ({
    id: b.id,
    name: b.node.name,
    kind: b.kind,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    ...(b.parentId !== undefined ? { parentId: b.parentId } : {}),
    ...(b.node.subtitle !== undefined ? { subtitle: b.node.subtitle } : {}),
    ...(b.node.description !== undefined ? { description: b.node.description } : {}),
    ...(b.node.url !== undefined ? { url: b.node.url } : {}),
    ...(b.node.decisions?.length ? { decisions: b.node.decisions } : {}),
    type: b.node.typeName,
    tags: b.node.tags,
    ...(b.node.facts.length ? { facts: b.node.facts } : {}),
    ...(b.node.bullets.length ? { bullets: b.node.bullets } : {}),
    ...(b.node.value !== undefined ? { value: b.node.value } : {}),
    ...(b.node.note !== undefined ? { note: b.node.note } : {}),
    ...(b.node.openItems?.length ? { openItems: b.node.openItems } : {}),
  }));
}

function edgesOf(layout: Layout): Json[] {
  return layout.edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    ...(e.label ? { label: e.label.text } : {}),
    ...(e.relation.description !== undefined ? { description: e.relation.description } : {}),
    kind: e.kind,
    members: e.members,
    ...(e.pathIds ? { pathIds: e.pathIds } : {}),
  }));
}

export function picture(layout: Layout, svg: string): Json {
  return { svg, width: layout.width, height: layout.height, ...(layout.figureHeight !== undefined ? { figureHeight: layout.figureHeight } : {}), boxes: boxesOf(layout), edges: edgesOf(layout) };
}
