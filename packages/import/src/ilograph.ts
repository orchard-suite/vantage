/**
 * Ilograph to Vantage. Ilograph files are a model (a resource tree with
 * `instanceOf` types from imported libraries) and perspectives (relations,
 * sequences, walkthroughs, overrides). The two languages are close:
 * resources become nodes, library resources become types, perspectives
 * become views, `overrides.parentId` becomes `reparent`, `extends` stays
 * `extends`. There is no geometry to pin; Ilograph never had any.
 */
import { parse } from 'yaml';
import type { DocumentInput, NodeInput, RelationInput } from '@vantage/model';
import type { PageReport } from './build.ts';
import { matchFamily } from './color.ts';
import { CSS_COLORS } from './css-colors.ts';

interface IloResource {
  id?: string;
  name?: string;
  subtitle?: string;
  description?: string;
  icon?: string;
  instanceOf?: string;
  abstract?: boolean;
  style?: string;
  color?: string;
  url?: string;
  children?: IloResource[];
}

interface IloRelation {
  from?: string;
  to?: string;
  label?: string;
  description?: string;
  color?: string;
  via?: string;
  arrowDirection?: string;
  bidirectional?: boolean;
}

interface IloOverride {
  resourceId?: string;
  parentId?: string;
  detail?: string;
}

interface IloStep {
  to?: string;
  toAndBack?: string;
  toAsync?: string;
  restartAt?: string;
  subSequence?: { name?: string; steps?: IloStep[] };
  label?: string;
  description?: string;
}

interface IloSlide {
  text?: string;
  select?: string;
  highlight?: string;
  expand?: string;
}

interface IloPerspective {
  name?: string;
  id?: string;
  hidden?: boolean;
  notes?: string;
  color?: string;
  extends?: string;
  relations?: IloRelation[];
  overrides?: IloOverride[];
  sequence?: { start?: string; steps?: IloStep[] };
  walkthrough?: IloSlide[];
}

interface IloFile {
  imports?: { from: string; namespace: string }[];
  description?: string;
  resources?: IloResource[];
  perspectives?: IloPerspective[];
  contexts?: unknown[];
}

export interface IlographOptions {
  readonly filename: string;
  /** Reads an imported library relative to the main file; undefined when it cannot be found. */
  readonly readRelative?: ((path: string) => string | undefined) | undefined;
  /** Maps an Ilograph icon path such as `Azure/Web/App Services.svg` to one of our icon ids. */
  readonly iconResolver?: ((hint: string) => string | undefined) | undefined;
}

export interface IlographResult {
  readonly input: DocumentInput;
  readonly pages: PageReport[];
  readonly warnings: string[];
  readonly hints: string[];
  readonly counts: { nodes: number; containers: number; relations: number; dropped: number };
}

interface Indexed {
  readonly id: string;
  /** The id as written in the Ilograph file, before ours was made unique and legal. */
  readonly origId?: string;
  readonly name: string;
  readonly path: string[];
  readonly parent?: string;
  readonly children: string[];
}

const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
/** Splits an Ilograph reference list on commas outside brackets, then expands `a/[x, y]/b` into one reference per item. */
export const list = (s: string | undefined): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s ?? '') {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean).flatMap(expandBrackets);
};

function expandBrackets(ref: string): string[] {
  const m = ref.match(/^(.*?)\[([^\]]*)\](.*)$/);
  if (!m) return [ref];
  const items = m[2]!.split(',').map((x) => x.trim()).filter(Boolean);
  if (items.some((i) => i.includes('*'))) return items.map((i) => `${m[1]}${i}${m[3]}`).flatMap(expandBrackets);
  return items.map((i) => `${m[1]}${i}${m[3]}`).flatMap(expandBrackets);
}

const globToRegex = (g: string): RegExp => new RegExp(`^${g.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

/** Role and shape from a type name, the way a reader would guess them. */
function guessBase(name: string): string {
  const n = name.toLowerCase();
  const rules: [RegExp, string][] = [
    [/database|sql|cosmos|postgres|table/, 'database'], [/cache|redis/, 'cache'], [/storage|blob|bucket|disk|nas/, 'storage'],
    [/queue/, 'queue'], [/topic|event|bus|grid/, 'topic'], [/function|lambda/, 'function'], [/scheduler|job|cron/, 'job'],
    [/container|pod|docker|kubernetes|statefulset|node pool/, 'container'], [/virtual machine|server|vm\b|hypervisor|host/, 'vm'],
    [/api management|gateway|front door|application gateway|ingress/, 'gateway'], [/load balancer/, 'loadbalancer'], [/firewall|waf|nsg/, 'firewall'],
    [/dns|domain/, 'dns'], [/cdn/, 'cdn'], [/vpn|tunnel|express/, 'tunnel'], [/network|vnet|subnet|wireless|switch|router|port|interface|isp|ont|ip\b/, 'network'],
    [/key vault|secret|certificate/, 'secret'], [/entra|identity|app registration|role|user|group|tenant/, 'identity'],
    [/monitor|insights|log analytics|grafana|prometheus/, 'monitoring'], [/config/, 'config'], [/registry/, 'registry'],
    [/pipeline|workflow|logic app|devops|gitlab|action/, 'pipeline'], [/repo|git/, 'repo'],
    [/subscription|account|billing/, 'subscription'], [/resource group|rack|datacenter|cloud|region|zone|environment/, 'cloud'],
    [/endpoint|route|get|post|put|patch|del/, 'api'], [/code|method|script|csharp|go|python|rust|powershell|service/, 'component'],
    [/web|site|console|app|application|m365|microsoft 365/, 'app'], [/workload|system|platform/, 'system'],
  ];
  for (const [re, base] of rules) if (re.test(n)) return base;
  return 'service';
}

const BOUNDARY = new Set(['subscription', 'cloud', 'network']);

function colorFamily(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const hex = CSS_COLORS[color.toLowerCase()] ?? (color.startsWith('#') ? color : undefined);
  if (!hex) return undefined;
  const m = matchFamily(hex);
  return m?.family;
}

export function importIlograph(text: string, opts: IlographOptions): IlographResult {
  const warnings: string[] = [];
  const hints: string[] = [];
  const main = (parse(text) ?? {}) as IloFile;

  // Libraries: abstract resources become types, keyed `Ns.Name`.
  const types: Record<string, { extends?: string; icon?: string; color?: string; description?: string }> = {};
  const typeIcon = new Map<string, string | undefined>();
  const typeSubtitle = new Map<string, string | undefined>();
  const libTemplates = new Map<string, IloResource>();
  const addType = (key: string, r: IloResource): void => {
    const base = guessBase(`${r.name ?? ''} ${r.subtitle ?? ''}`);
    const icon = r.icon ? opts.iconResolver?.(r.icon) : undefined;
    const color = colorFamily(r.color);
    types[key] = { extends: base, ...(icon ? { icon } : {}), ...(color ? { color } : {}), ...(r.subtitle ? { description: r.subtitle } : {}) };
    typeIcon.set(key, icon);
    typeSubtitle.set(key, r.subtitle);
    libTemplates.set(key, r);
  };
  for (const imp of main.imports ?? []) {
    const lib = opts.readRelative?.(imp.from);
    if (lib === undefined) {
      warnings.push(`import ${imp.from} not found; its types fall back to guesses`);
      continue;
    }
    const parsed = (parse(lib) ?? {}) as IloFile;
    for (const r of parsed.resources ?? []) if (r.name) addType(`${imp.namespace}.${r.name.replace(/::/g, '.')}`, r);
  }
  for (const r of main.resources ?? []) {
    if (!r.abstract) continue;
    if (r.name) addType(r.name.replace(/::/g, '.'), r);
    if (r.id && r.id !== r.name) addType(r.id, r);
  }

  // Any resource may serve as an instanceOf template, abstract or not; index them all by id and name.
  const allRes = new Map<string, IloResource>();
  const walkAll = (rs: IloResource[]): void => {
    for (const r of rs) {
      if (r.id && !allRes.has(r.id)) allRes.set(r.id, r);
      if (r.name && !allRes.has(r.name)) allRes.set(r.name, r);
      walkAll(r.children ?? []);
    }
  };
  walkAll(main.resources ?? []);

  /** `Az.App Service`, or a bare `Application` that one library defines, or a local resource used as a template. */
  const resolveType = (key: string): string | undefined => {
    if (types[key]) return key;
    const leaf = key.split('.').pop() ?? key;
    const hits = Object.keys(types).filter((k) => k === leaf || k.endsWith(`.${leaf}`));
    if (hits.length) return hits[0];
    const local = allRes.get(key) ?? allRes.get(leaf);
    if (local) {
      addType(key, local);
      return key;
    }
    return undefined;
  };

  // Resources to nodes, with an index for every way Ilograph refers to them.
  const index = new Map<string, Indexed>();
  const byName = new Map<string, string[]>();
  const used = new Set<string>();
  const uniqueId = (want: string, parentId: string | undefined): string => {
    let id = want;
    if (used.has(id) && parentId) id = `${parentId}-${want}`;
    let n = 2;
    while (used.has(id)) id = `${want}-${n++}`;
    used.add(id);
    return id;
  };
  let containers = 0;
  const toNode = (r: IloResource, path: string[], parentId: string | undefined): NodeInput | undefined => {
    if (r.abstract) return undefined;
    const name = r.name ?? r.id ?? 'unnamed';
    // Ilograph ids may hold spaces or colons; ours may not, but references still resolve through the original id.
    const id = uniqueId(r.id !== undefined && /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(r.id) ? r.id : slug(r.id ?? name), parentId);
    const fullPath = [...path, r.id ?? name];
    const typeKey = r.instanceOf?.replace(/::/g, '.');
    const type = typeKey ? resolveType(typeKey) : undefined;
    if (typeKey && !type) warnings.push(`${name}: unknown type ${r.instanceOf}; left untyped`);
    const template = type ? libTemplates.get(type) : undefined;
    const children = (r.children ?? template?.children ?? []).map((c) => toNode(c, fullPath, id)).filter((c): c is NodeInput => c !== undefined);
    if (children.length) containers++;
    const icon = r.icon ? opts.iconResolver?.(r.icon) : undefined;
    const base = type ? (types[type]?.extends ?? 'service') : guessBase(name);
    const node: NodeInput = {
      id,
      name,
      ...(type ? { type } : children.length || BOUNDARY.has(base) ? { type: 'group' } : {}),
      ...(r.subtitle ? { subtitle: r.subtitle } : type && typeSubtitle.get(type) && !r.subtitle ? {} : {}),
      ...(r.description ? { description: r.description.trim() } : {}),
      ...(icon ? { icon } : {}),
      ...(r.url ? { url: r.url } : {}),
      ...(r.style === 'plural' ? { style: { plural: true } } : {}),
      ...(colorFamily(r.color) ? { color: colorFamily(r.color)! } : {}),
      ...(children.length ? { children } : {}),
    };
    index.set(id, { id, ...(r.id !== undefined ? { origId: r.id } : {}), name, path: fullPath, ...(parentId !== undefined ? { parent: parentId } : {}), children: children.map((c) => c.id!) });
    byName.set(name, [...(byName.get(name) ?? []), id]);
    if (r.id) byName.set(r.id, [...(byName.get(r.id) ?? []), id]);
    return node;
  };
  const nodes = (main.resources ?? []).map((r) => toNode(r, [], undefined)).filter((n): n is NodeInput => n !== undefined);

  const dropped: string[] = [];
  /** Resolves `id`, `name`, or `A/B/C` paths, with globs; every match for a glob, one otherwise, none with a note. */
  const resolveAll = (ref: string, where: string): string[] => {
    const r = ref.trim();
    if (index.has(r)) return [r];
    const segs = r.split('/').map((s) => s.trim());
    const matches = (k: string, seg: string): boolean => {
      const n = index.get(k)!;
      if (seg.includes('*')) {
        const re = globToRegex(seg);
        return re.test(n.name) || re.test(k) || (n.origId !== undefined && re.test(n.origId));
      }
      return n.name === seg || k === seg || n.origId === seg;
    };
    if (segs.length > 1) {
      const first = segs[0]!;
      let candidates = first.includes('*') ? [...index.keys()].filter((k) => matches(k, first)) : (byName.get(first) ?? []);
      for (const seg of segs.slice(1)) {
        candidates = candidates.flatMap((c) => index.get(c)!.children.filter((k) => matches(k, seg)));
      }
      if (candidates.length > 1 && segs.some((s) => s.includes('*'))) return [...new Set(candidates)];
      if (candidates.length === 1) return [candidates[0]!];
      if (candidates.length > 1) {
        warnings.push(`${where}: ${r} is ambiguous (${candidates.length} matches); first taken`);
        return [candidates[0]!];
      }
      const leaf = segs[segs.length - 1]!;
      const byLeaf = byName.get(leaf) ?? [];
      if (byLeaf.length === 1) return [byLeaf[0]!];
    } else if (r.includes('*')) {
      const all = [...index.keys()].filter((k) => matches(k, r));
      if (all.length) return all;
    }
    const named = byName.get(r) ?? [];
    if (named.length === 1) return [named[0]!];
    if (named.length > 1) {
      warnings.push(`${where}: ${r} names ${named.length} resources; first taken`);
      return [named[0]!];
    }
    dropped.push(`${where}: ${r} not found`);
    return [];
  };
  const resolve = (ref: string, where: string): string | undefined => resolveAll(ref, where)[0];

  // Perspectives to views.
  const views: ViewInput[] = [];
  const pages: PageReport[] = [];
  const viewIds = new Map<string, string>();
  for (const p of main.perspectives ?? []) viewIds.set(p.name ?? p.id ?? '', slug((p.name ?? p.id ?? 'view').replace(/::/g, ' ')));
  (main.perspectives ?? []).forEach((p, i) => {
    const name = p.name ?? p.id ?? `perspective-${i}`;
    const id = viewIds.get(name)!;
    // "Workloads::Identity::Code" is a path: the last segment is the title, the rest is the picker group.
    const segments = name.split('::').map((s) => s.trim()).filter(Boolean);
    const title = segments[segments.length - 1] ?? name;
    const group = segments.slice(0, -1).join(' / ');
    const where = `perspective ${name}`;
    const base = {
      id,
      title,
      ...(group ? { group } : {}),
      ...(p.hidden ? { hidden: true } : {}),
      ...(p.notes ? { question: firstSentence(p.notes), notes: p.notes.trim() } : {}),
    };
    if (p.sequence) {
      const steps = sequenceSteps(p.sequence, resolve, where);
      if (!steps.length) {
        warnings.push(`${where}: sequence has no resolvable steps; skipped`);
        return;
      }
      views.push({ ...base, kind: 'sequence', steps });
      pages.push(page(name, i, steps.length, 0, []));
      return;
    }
    const relations: RelationInput[] = [];
    for (const r of p.relations ?? []) {
      const from = list(r.from).flatMap((f) => resolveAll(f, where));
      const to = list(r.to).flatMap((t) => resolveAll(t, where));
      if (!from.length) continue;
      if (!to.length) {
        // Ilograph shows a resource with no arrow when only `from` is given.
        continue;
      }
      const backward = r.arrowDirection === 'backward';
      const via = list(r.via).flatMap((v) => resolveAll(v, where));
      const color = colorFamily(r.color);
      relations.push({
        from: backward ? to : from,
        to: backward ? from : to,
        ...(r.label ? { label: r.label } : {}),
        ...(r.description ? { description: r.description.trim() } : {}),
        ...(via.length ? { via } : {}),
        ...(r.bidirectional || r.arrowDirection === 'bidirectional' ? { both: true } : {}),
        ...(color ? { color } : {}),
      });
    }
    const reparent: Record<string, string> = {};
    const collapse: string[] = [];
    const expand: string[] = [];
    for (const o of p.overrides ?? []) {
      const ids = list(o.resourceId).flatMap((x) => resolveAll(x, where));
      const parent = o.parentId !== undefined ? (o.parentId === 'none' ? 'root' : resolve(o.parentId, where)) : undefined;
      for (const n of ids) {
        if (parent !== undefined) reparent[n] = parent;
        if (o.detail === 'minimize') collapse.push(n);
        if (o.detail === 'maximize') expand.push(n);
      }
    }
    const extendsIds = list(p.extends).map((e) => viewIds.get(e)).filter((x): x is string => x !== undefined);
    const extraNodes = (p.relations ?? []).filter((r) => r.from && !r.to).flatMap((r) => list(r.from).flatMap((f) => resolveAll(f, where)));
    views.push({
      ...base,
      kind: 'relation',
      ...(extendsIds.length ? { extends: extendsIds } : {}),
      ...(relations.length ? { relations } : {}),
      ...(extraNodes.length ? { include: { nodes: extraNodes } } : {}),
      ...(Object.keys(reparent).length ? { reparent } : {}),
      ...(collapse.length ? { collapse } : {}),
      ...(expand.length ? { expand } : {}),
    });
    pages.push(page(name, i, relations.length, 0, []));
    if (p.walkthrough?.length) {
      const steps = p.walkthrough.map((s, k) => {
        const ids = [...list(s.select), ...list(s.highlight)].flatMap((x) => resolveAll(x, `${where} slide ${k}`));
        const text = (s.text ?? '').trim();
        return { title: text.split(/[.!?]\s/)[0]?.slice(0, 60) || `Step ${k + 1}`, ...(text ? { text } : {}), ...(ids.length ? { highlight: ids, focus: ids[0]! } : {}) };
      });
      views.push({ id: `${id}-tour`, title: `${title} (walkthrough)`, kind: 'walkthrough', view: id, steps });
    }
    if (Object.keys(reparent).length) hints.push(`${name}: ${Object.keys(reparent).length} resources re-parented for this view (from overrides)`);
  });
  for (const d of dropped) warnings.push(d);
  if (main.contexts?.length) warnings.push(`${main.contexts.length} contexts were not imported; express them as reparent on the views that need them`);

  const title = opts.filename.replace(/^.*[\\/]/, '').replace(/\.ilograph$/i, '');
  const input: DocumentInput = {
    vantage: 1,
    title,
    ...(main.description ? { description: main.description.trim() } : {}),
    ...(Object.keys(types).length ? { types } : {}),
    nodes,
    views: views.length ? views : [{ id: 'all', title: 'All', kind: 'relation', include: { subtree: nodes.slice(0, 1).map((n) => n.id!) } }],
  };
  return { input, pages, warnings, hints, counts: { nodes: index.size, containers, relations: views.reduce((a, v) => a + (v.kind === 'relation' ? (v.relations?.length ?? 0) : 0), 0), dropped: dropped.length } };
}

function page(name: string, index: number, relations: number, nodes: number, dropped: string[]): PageReport {
  return { name, index, shapes: 0, edges: relations, nodes, containers: 0, relations, dropped, hints: [], unmappedStyles: [], warnings: [] };
}

function firstSentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.{10,160}?[.!?])(\s|$)/);
  return (m ? m[1]! : t.slice(0, 160)).trim();
}

type ViewInput = NonNullable<DocumentInput['views']>[number];
type SeqStep = Extract<ViewInput, { kind: 'sequence' }>['steps'][number];

function sequenceSteps(seq: NonNullable<IloPerspective['sequence']>, resolve: (ref: string, where: string) => string | undefined, where: string): SeqStep[] {
  const out: SeqStep[] = [];
  let current = seq.start ? resolve(seq.start, where) : undefined;
  const walk = (steps: IloStep[], into: SeqStep[]): void => {
    for (const s of steps) {
      if (s.restartAt !== undefined) {
        current = resolve(s.restartAt, where) ?? current;
        continue;
      }
      if (s.subSequence) {
        const inner: SeqStep[] = [];
        walk(s.subSequence.steps ?? [], inner);
        into.push({ opt: s.subSequence.name ?? 'sub-sequence', steps: inner });
        continue;
      }
      const targetRef = s.to ?? s.toAndBack ?? s.toAsync;
      if (targetRef === undefined || current === undefined) continue;
      const target = resolve(targetRef, where);
      if (target === undefined) continue;
      const step: SeqStep = { from: current, to: target, ...(s.label ? { label: s.label } : {}), ...(s.description ? { description: s.description.trim() } : {}) };
      if (s.toAsync !== undefined) into.push({ ...step, kind: 'async' });
      else if (s.toAndBack !== undefined) into.push({ ...step, reply: 'returns' });
      else into.push(step);
      if (s.toAndBack === undefined) current = target;
    }
  };
  walk(seq.steps ?? [], out);
  return out;
}
