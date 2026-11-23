/**
 * One model from many pages. A box that appears on several pages with the
 * same name, subtitle, type, and place in the tree is one node; its views
 * each keep their own pins. Nothing merges inside a single page, so two
 * boxes drawn twice on one page stay two.
 */
import type { NodeInput, RelationInput } from '@vantage/model';
import type { RelationViewInput } from './build.ts';

export interface PageParts {
  readonly nodes: NodeInput[];
  readonly relations: RelationInput[];
  readonly view: RelationViewInput;
}

export interface Merged {
  readonly nodes: NodeInput[];
  readonly relations: RelationInput[];
  readonly views: RelationViewInput[];
  /** One line per node that repeated, for the report. */
  readonly notes: readonly string[];
}

function keyOf(n: NodeInput, parentKey: string): string {
  return `${parentKey}/${n.type ?? ''}|${n.name}|${n.subtitle ?? ''}`;
}

type Rename = ReadonlyMap<string, string>;

function renameId(id: string, rename: Rename): string {
  return rename.get(id) ?? id;
}

function renameIds(ids: string | string[], rename: Rename): string | string[] {
  return Array.isArray(ids) ? ids.map((i) => renameId(i, rename)) : renameId(ids, rename);
}

function renameList(ids: readonly string[] | undefined, rename: Rename): string[] | undefined {
  if (!ids) return undefined;
  return [...new Set(ids.map((i) => renameId(i, rename)))];
}

function renameView(v: RelationViewInput, rename: Rename): RelationViewInput {
  const include = v.include
    ? {
        ...v.include,
        ...(v.include.nodes ? { nodes: renameList(v.include.nodes, rename)! } : {}),
        ...(v.include.subtree ? { subtree: renameList(v.include.subtree, rename)! } : {}),
      }
    : undefined;
  const arrange = v.arrange?.map((a) => ({
    ...a,
    node: renameId(a.node, rename),
    ...(a.center !== undefined ? { center: renameId(a.center, rename) } : {}),
    ...(a.order ? { order: renameList(a.order, rename)! } : {}),
  }));
  const highlights = v.highlights?.map((h) => ({ ...h, nodes: renameList(h.nodes, rename)! }));
  const pins = v.pins
    ? {
        nodes: Object.fromEntries(Object.entries(v.pins.nodes ?? {}).map(([id, r]) => [renameId(id, rename), r])),
        ...(v.pins.edges ? { edges: Object.fromEntries(Object.entries(v.pins.edges).map(([k, pts]) => [k.split('>').map((i) => renameId(i, rename)).join('>'), pts])) } : {}),
      }
    : undefined;
  return {
    ...v,
    ...(include ? { include } : {}),
    ...(arrange ? { arrange } : {}),
    ...(highlights ? { highlights } : {}),
    ...(pins ? { pins } : {}),
  };
}

/** Fields the first sighting lacked are taken from a later one; nothing is overwritten. */
function fillFrom(target: NodeInput, source: NodeInput): void {
  if (target.description === undefined && source.description !== undefined) target.description = source.description;
  if (!target.facts?.length && source.facts?.length) target.facts = [...source.facts];
  if (!target.bullets?.length && source.bullets?.length) target.bullets = [...source.bullets];
  if (target.shape === undefined && source.shape !== undefined) target.shape = source.shape;
  if (target.color === undefined && source.color !== undefined) target.color = source.color;
}

export function mergePages(pages: readonly PageParts[]): Merged {
  const canonical = new Map<string, NodeInput>();
  const pagesOf = new Map<string, Set<string>>();
  const rename = new Map<string, string>();
  const nodes: NodeInput[] = [];
  const relations: RelationInput[] = [];
  const views: RelationViewInput[] = [];

  for (const page of pages) {
    const fresh: { key: string; node: NodeInput }[] = [];
    const place = (list: NodeInput[], parentKey: string, into: NodeInput[] | undefined): void => {
      for (const n of list) {
        const key = keyOf(n, parentKey);
        const seen = canonical.get(key);
        if (seen && n.id !== undefined && seen.id !== undefined) {
          rename.set(n.id, seen.id);
          pagesOf.get(key)!.add(page.view.id);
          fillFrom(seen, n);
          if (n.children?.length) {
            seen.children ??= [];
            place(n.children, key, seen.children);
          }
          continue;
        }
        fresh.push({ key, node: n });
        into?.push(n);
        if (n.children?.length) place(n.children, key, undefined);
      }
    };
    place(page.nodes, '', nodes);
    // The page's own nodes become known only once it is done, so a page never merges with itself.
    for (const f of fresh) {
      if (canonical.has(f.key)) continue;
      canonical.set(f.key, f.node);
      pagesOf.set(f.key, new Set([page.view.id]));
    }
    relations.push(...page.relations.map((r) => ({ ...r, from: renameIds(r.from, rename), to: renameIds(r.to, rename) })));
    views.push(renameView(page.view, rename));
  }

  // The same arrow drawn on two pages is one relation shown in both views.
  const byKey = new Map<string, RelationInput>();
  for (const r of relations) {
    const key = `${String(r.from)}>${String(r.to)}|${r.label ?? ''}|${r.kind ?? ''}|${r.style ?? ''}|${JSON.stringify(r.heads ?? null)}`;
    const seen = byKey.get(key);
    if (seen) seen.tags = [...new Set([...(seen.tags ?? []), ...(r.tags ?? [])])];
    else byKey.set(key, r);
  }
  const notes = [...pagesOf.entries()].filter(([, p]) => p.size > 1).map(([key, p]) => `${canonical.get(key)!.id}: on ${p.size} pages (${[...p].join(', ')}), kept once`);
  return { nodes, relations: [...byKey.values()], views, notes };
}
