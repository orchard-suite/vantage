/**
 * Resolves every view: relation views expand `extends` and `include` into a
 * concrete relation list; sequence, flow, and walkthrough views have their
 * node references checked.
 */
import { type Document, type FlowStep, type LifecycleView, type RelationView, type SequenceStep, type StateClass } from './schema.ts';
import type { ModelNode, ModelRelation, ResolvedPath, ResolvedView, ResolvedRelationView } from './model.ts';
import type { DiagnosticBag } from './diagnostics.ts';
import { expandRelation, type RefResolver } from './resolve.ts';

type Views = Document['views'];

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
}

/** True when `n` is `x` or sits anywhere inside it. */
function within(n: string, x: string, nodes: ReadonlyMap<string, ModelNode>): boolean {
  for (let c: string | undefined = n; c !== undefined; c = nodes.get(c)?.parentId) if (c === x) return true;
  return false;
}

/** Does this view draw `x` (or, when `inside`, only something strictly inside `x`)? Its own hidden nodes do not count. */
function draws(v: ResolvedRelationView, x: string, inside: boolean, nodes: ReadonlyMap<string, ModelNode>): boolean {
  const hidden = (n: string): boolean => v.hide.some((h) => within(n, h, nodes));
  const hit = (n: string): boolean => (inside ? n !== x : true) && within(n, x, nodes) && !hidden(n);
  const ends = v.relations.flatMap((r) => [r.from, r.to, ...r.via]);
  return [...ends, ...v.extraNodes].some(hit) || v.subtree.some((s) => !hidden(s) && (hit(s) || within(x, s, nodes) && s !== x));
}

/**
 * A composed view draws everything any of its parents draws. A parent's
 * `hide` or `collapse` is inherited only where no other parent draws what it
 * would remove; the composing view's own lists always apply.
 */
function inherit(
  parents: readonly ResolvedRelationView[],
  key: 'hide' | 'collapse',
  nodes: ReadonlyMap<string, ModelNode>,
): string[] {
  return parents.flatMap((p) =>
    p[key].filter((x) =>
      parents.every((q) => q === p || q[key].some((y) => within(x, y, nodes)) || !draws(q, x, key === 'collapse', nodes)),
    ),
  );
}

function resolveRelationView(
  view: RelationView,
  index: number,
  all: Views,
  nodes: ReadonlyMap<string, ModelNode>,
  modelRelations: readonly ModelRelation[],
  resolve: RefResolver,
  bag: DiagnosticBag,
  stack: string[],
  cache: Map<string, ResolvedRelationView>,
): ResolvedRelationView {
  const cached = cache.get(view.id);
  if (cached) return cached;
  const path = `views[${index}]`;
  if (stack.includes(view.id)) {
    bag.error('extends-cycle', `view ${view.id} extends itself through ${stack.join(' > ')}`, { path: `${path}.extends` });
    return emptyView(view);
  }
  const relations: ModelRelation[] = [];
  const extraNodes: string[] = [];
  const subtree: string[] = [];
  const arrange = [...(view.arrange ?? [])];
  const expand = [...(view.expand ?? [])];
  const parents: ResolvedRelationView[] = [];

  for (const parentId of view.extends ?? []) {
    const pi = all.findIndex((v) => v.id === parentId);
    const parent = pi >= 0 ? all[pi] : undefined;
    if (!parent || parent.kind !== 'relation') {
      bag.error('unknown-view', `view ${view.id} extends unknown relation view ${parentId}`, {
        path: `${path}.extends`,
        hint: `Relation views in this file: ${all.filter((v) => v.kind === 'relation').map((v) => v.id).join(', ')}`,
      });
      continue;
    }
    const r = resolveRelationView(parent, pi, all, nodes, modelRelations, resolve, bag, [...stack, view.id], cache);
    parents.push(r);
    relations.push(...r.relations);
    extraNodes.push(...r.extraNodes);
    subtree.push(...r.subtree);
    arrange.unshift(...r.arrange);
    expand.push(...r.expand);
  }
  const collapse = [...inherit(parents, 'collapse', nodes), ...(view.collapse ?? [])];
  const hide = [...inherit(parents, 'hide', nodes), ...(view.hide ?? [])];

  const inc = view.include;
  if (inc) {
    if (inc.tags) relations.push(...modelRelations.filter((r) => r.tags.some((t) => inc.tags!.includes(t))));
    if (inc.relations) {
      for (const id of inc.relations) {
        const found = modelRelations.filter((r) => r.id === id || r.id.startsWith(`${id}-`));
        if (!found.length) bag.error('unknown-relation', `view ${view.id} includes unknown relation id ${id}`, { path: `${path}.include.relations` });
        relations.push(...found);
      }
    }
    for (const n of inc.nodes ?? []) {
      const id = resolve(n, `${path}.include.nodes`);
      if (id) extraNodes.push(id);
    }
    for (const n of inc.subtree ?? []) {
      const id = resolve(n, `${path}.include.subtree`);
      if (id) subtree.push(id);
    }
  }
  (view.relations ?? []).forEach((r, i) => expandRelation(r, `${view.id}-rel-${i}`, `${path}.relations[${i}]`, resolve, view.id, relations));
  const paths = resolvePaths(view, path, relations, resolve, bag);

  const checkList = (list: string[], key: string): string[] =>
    list.map((n) => resolve(n, `${path}.${key}`)).filter((x): x is string => x !== undefined);

  const resolved: ResolvedRelationView = {
    kind: 'relation',
    id: view.id,
    title: view.title,
    ...(view.group !== undefined ? { group: view.group } : {}),
    ...(view.hidden ? { hidden: true } : {}),
    ...(view.question !== undefined ? { question: view.question } : {}),
    ...(view.notes !== undefined ? { notes: view.notes } : {}),
    tags: view.tags ?? [],
    direction: view.direction ?? 'right',
    relations: uniqueBy(relations, (r) => `${r.from}>${r.to}>${r.label ?? ''}>${r.via.join('>')}`),
    extraNodes: [...new Set(extraNodes)],
    subtree: [...new Set(subtree)],
    ...(view.detail !== undefined ? { detail: view.detail } : {}),
    expand: checkList([...new Set(expand)], 'expand'),
    collapse: checkList([...new Set(collapse)], 'collapse'),
    hide: checkList([...new Set(hide)], 'hide'),
    reparent: Object.fromEntries(
      Object.entries(view.reparent ?? {}).flatMap(([n, p]) => {
        const id = resolve(n, `${path}.reparent`);
        const parent = p === 'root' ? 'root' : resolve(p, `${path}.reparent`);
        return id !== undefined && parent !== undefined ? [[id, parent]] : [];
      }),
    ),
    arrange: arrange.map((a) => ({
      ...(a.node === 'root' ? a : { ...a, node: resolve(a.node, `${path}.arrange`) ?? a.node }),
      ...(a.order ? { order: a.order.map((o) => resolve(o, `${path}.arrange.order`) ?? o) } : {}),
    })),
    legend: view.legend ?? 'auto',
    ...(view.openItems ? { openItems: true } : {}),
    paths,
    annotations: (view.annotations ?? []).map((a) => (a.at === undefined ? a : { ...a, at: resolve(a.at, `${path}.annotations`) ?? a.at })),
    highlights: (view.highlights ?? []).map((h) => ({ ...h, nodes: checkList(h.nodes, 'highlights') })),
    narrative: view.narrative ?? paths.length > 0,
    ...(view.pins ? { pins: resolvePins(view.pins, path, resolve) } : {}),
  };
  if (resolved.relations.length === 0 && resolved.extraNodes.length === 0 && resolved.subtree.length === 0) {
    bag.warn('view-without-relations', `view ${view.id} has no relations: it is an inventory, not a story`, {
      path,
      hint: 'Add relations with labels that say what happens, or include model relations by tag',
    });
  }
  cache.set(view.id, resolved);
  return resolved;
}

const PATH_COLORS = ['blue', 'emerald', 'amber', 'violet', 'red', 'teal', 'pink'];

function resolvePins(pins: NonNullable<RelationView['pins']>, path: string, resolve: RefResolver): NonNullable<RelationView['pins']> {
  const nodes: Record<string, (typeof pins.nodes)[string]> = {};
  for (const [ref, rect] of Object.entries(pins.nodes)) {
    const id = resolve(ref, `${path}.pins.nodes`);
    if (id !== undefined) nodes[id] = rect;
  }
  const edges: Record<string, NonNullable<typeof pins.edges>[string]> = {};
  for (const [key, pts] of Object.entries(pins.edges ?? {})) {
    const [a, b] = key.split('>');
    if (a === undefined || b === undefined) continue;
    const from = resolve(a, `${path}.pins.edges`), to = resolve(b, `${path}.pins.edges`);
    if (from !== undefined && to !== undefined) edges[`${from}>${to}`] = pts;
  }
  return { nodes, ...(Object.keys(edges).length ? { edges } : {}) };
}

/**
 * A path step names an arrow by its ends (and label when several exist).
 * A step whose arrow is not in the view adds it, so a path can be written
 * first and the arrows follow.
 */
function resolvePaths(view: RelationView, path: string, relations: ModelRelation[], resolve: RefResolver, bag: DiagnosticBag): ResolvedPath[] {
  return (view.paths ?? []).map((p, pi) => {
    const id = p.id ?? `path-${pi}`;
    let n = 0;
    const steps = p.steps.flatMap((s, si) => {
      const sp = `${path}.paths[${pi}].steps[${si}]`;
      const from = resolve(s.from, `${sp}.from`);
      const to = resolve(s.to, `${sp}.to`);
      if (from === undefined || to === undefined) return [];
      const existing = relations.filter((r) => r.from === from && r.to === to && (s.label === undefined || r.label === s.label));
      if (!existing.length) {
        relations.push({ id: `${view.id}-${id}-${si}`, from, to, ...(s.label !== undefined ? { label: s.label } : {}), kind: 'sync', via: [], tags: [], both: false, weight: 1, style: 'orthogonal', viewId: view.id });
      }
      const badge = s.id ?? String(++n);
      if (s.id !== undefined && /^\d+$/.test(s.id)) n = Number(s.id);
      return [{ from, to, ...(s.label !== undefined ? { label: s.label } : {}), ...(s.text !== undefined ? { text: s.text } : {}), badge }];
    });
    if (!steps.length) bag.error('empty-path', `path ${id} in view ${view.id} has no resolvable steps`, { path: `${path}.paths[${pi}]` });
    return { ...p, id, color: p.color ?? PATH_COLORS[pi % PATH_COLORS.length]!, steps };
  });
}

function emptyView(view: RelationView): ResolvedRelationView {
  return {
    kind: 'relation',
    id: view.id,
    title: view.title,
    tags: [],
    direction: 'right',
    relations: [],
    extraNodes: [],
    subtree: [],
    expand: [],
    collapse: [],
    hide: [],
    reparent: {},
    arrange: [],
    legend: false,
    paths: [],
    annotations: [],
    highlights: [],
    narrative: false,
  };
}

function checkSequenceSteps(steps: readonly SequenceStep[], path: string, resolve: RefResolver, bag: DiagnosticBag): void {
  steps.forEach((s, i) => {
    const p = `${path}[${i}]`;
    if (s.from !== undefined) resolve(s.from, `${p}.from`);
    if (s.to !== undefined) resolve(s.to, `${p}.to`);
    if (s.from !== undefined && s.to === undefined) bag.error('sequence-step', `step ${i} has from but no to`, { path: p });
    for (const o of s.over ?? []) resolve(o, `${p}.over`);
    if (s.steps) checkSequenceSteps(s.steps, `${p}.steps`, resolve, bag);
    if (s.else) checkSequenceSteps(s.else, `${p}.else`, resolve, bag);
  });
}

export function resolveViews(
  doc: Document,
  nodes: ReadonlyMap<string, ModelNode>,
  modelRelations: readonly ModelRelation[],
  resolve: RefResolver,
  bag: DiagnosticBag,
): ResolvedView[] {
  const all = doc.views;
  const ids = new Set<string>();
  const cache = new Map<string, ResolvedRelationView>();
  const out: ResolvedView[] = [];
  all.forEach((view, i) => {
    const path = `views[${i}]`;
    if (ids.has(view.id)) {
      bag.error('duplicate-view', `view id ${view.id} is declared twice`, { path });
      return;
    }
    ids.add(view.id);
    switch (view.kind) {
      case 'relation':
        out.push(resolveRelationView(view, i, all, nodes, modelRelations, resolve, bag, [], cache));
        break;
      case 'sequence': {
        for (const p of view.participants ?? []) resolve(p, `${path}.participants`);
        checkSequenceSteps(view.steps, `${path}.steps`, resolve, bag);
        out.push({ ...view, tags: view.tags ?? [] });
        break;
      }
      case 'flow': {
        const stepIds = new Set(view.steps.map((s) => s.id));
        view.steps.forEach((s, j) => {
          if (s.node !== undefined) resolve(s.node, `${path}.steps[${j}].node`);
          if (s.lane !== undefined && view.lanes && !view.lanes.includes(s.lane)) {
            bag.error('unknown-lane', `step ${s.id} uses lane ${s.lane} which is not in lanes`, { path: `${path}.steps[${j}].lane` });
          }
        });
        view.edges.forEach((e, j) => {
          for (const end of [e.from, e.to]) {
            if (!stepIds.has(end)) bag.error('unknown-step', `flow edge refers to unknown step ${end}`, { path: `${path}.edges[${j}]` });
          }
        });
        out.push({ ...view, tags: view.tags ?? [] });
        break;
      }
      case 'lifecycle': {
        checkLifecycle(view, path, bag);
        out.push(lifecycleAsFlow(view));
        break;
      }
      case 'walkthrough': {
        const base = all.find((v) => v.id === view.view);
        if (!base || base.kind !== 'relation') {
          bag.error('unknown-view', `walkthrough ${view.id} plays over unknown relation view ${view.view}`, { path: `${path}.view` });
        }
        view.steps.forEach((s, j) => {
          if (s.focus !== undefined) resolve(s.focus, `${path}.steps[${j}].focus`);
          if (s.view !== undefined && !all.some((v) => v.id === s.view)) bag.error('unknown-view', `step ${j} switches to unknown view ${s.view}`, { path: `${path}.steps[${j}].view` });
        });
        out.push({ ...view, tags: view.tags ?? [] });
        break;
      }
      case 'timeline': {
        const ids = new Set(view.items.map((it, j) => it.id ?? `item-${j}`));
        view.items.forEach((it, j) => {
          if (it.node !== undefined) resolve(it.node, `${path}.items[${j}].node`);
          if (view.scale !== 'ordinal' && Number.isNaN(Date.parse(it.start))) bag.error('timeline-date', `item ${it.id ?? j} has a start that is not a date: ${it.start}`, { path: `${path}.items[${j}].start`, hint: 'Use an ISO date like 2026-03-01, or set scale: ordinal' });
          if (it.end !== undefined && view.scale !== 'ordinal' && Number.isNaN(Date.parse(it.end))) bag.error('timeline-date', `item ${it.id ?? j} has an end that is not a date: ${it.end}`, { path: `${path}.items[${j}].end` });
        });
        (view.dependencies ?? []).forEach((d, j) => {
          for (const end of [d.from, d.to]) if (!ids.has(end)) bag.error('unknown-item', `dependency refers to unknown item ${end}`, { path: `${path}.dependencies[${j}]` });
        });
        out.push({ ...view, tags: view.tags ?? [] });
        break;
      }
      case 'page': {
        view.panels.forEach((p, j) => {
          if (p.view !== undefined && !all.some((v) => v.id === p.view && v.kind !== 'page' && v.kind !== 'doc')) {
            bag.error('unknown-view', `panel ${j} embeds unknown view ${p.view}`, { path: `${path}.panels[${j}].view`, hint: 'Pages embed relation, sequence, and flow views, not other pages' });
          }
        });
        out.push({ ...view, tags: view.tags ?? [] });
        break;
      }
      case 'doc': {
        if ((view.file === undefined) === (view.text === undefined)) {
          bag.error('doc-source', `doc view ${view.id} needs one of file or text`, { path, hint: 'Name a Markdown file with `file:`, or write a short page in `text:`' });
        }
        if (view.beside !== undefined && !all.some((v) => v.id === view.beside && v.kind !== 'doc' && v.kind !== 'walkthrough')) {
          bag.error('unknown-view', `doc view ${view.id} sits beside unknown view ${view.beside}`, { path: `${path}.beside`, hint: 'Name a relation, sequence, flow, timeline, or page view' });
        }
        out.push({ ...view, tags: view.tags ?? [] });
        break;
      }
    }
  });
  void nodes;
  return out;
}

/** The flow shape each class of state draws as: where work starts, is worked, ends, or waits. */
const CLASS_SHAPE: Record<StateClass, FlowStep['shape']> = { 'not-started': 'start', 'in-progress': 'process', done: 'end', parked: 'wait' };

const PEOPLE_ROLES: readonly string[] = ['author', 'holder', 'asker'];

const CLASS_TEXT: Record<StateClass, string> = { 'not-started': 'not started', 'in-progress': 'in progress', done: 'done', parked: 'parked' };

/**
 * A lifecycle draws as a flow: each state a step shaped by its class, each
 * move an arrow labelled with what it is and who may make it. The hub reads
 * the states and moves from the view as written; the picture is this flow.
 */
export function lifecycleAsFlow(view: LifecycleView): ResolvedView {
  const steps: FlowStep[] = view.states.map((s) => ({ id: s.id, text: s.text, shape: CLASS_SHAPE[s.class], description: [CLASS_TEXT[s.class], s.description].filter(Boolean).join('. ') }));
  const edges = view.moves.map((m) => {
    // The roles everyone has (author, holder, asker) would crowd every arrow; proof and a role the kind names are worth their words.
    const who = (m.who ?? []).filter((w) => !PEOPLE_ROLES.includes(w));
    const label = [m.label, who.length ? `(${who.join(', ')})` : undefined].filter(Boolean).join(' ');
    return { from: m.from, to: m.to, ...(label ? { label } : {}) };
  });
  const { states: _states, moves: _moves, kind: _kind, ...base } = view;
  return { ...base, kind: 'flow', steps, edges, layers: lifecycleLayers(view), tags: view.tags ?? [] };
}

/** Each state's column: how many moves it is from where an item starts, and done last, so work reads left to right and a move back is drawn as one. */
function lifecycleLayers(view: LifecycleView): string[][] {
  const depth = new Map<string, number>([[view.states[0]!.id, 0]]);
  const queue = [view.states[0]!.id];
  while (queue.length) {
    const at = queue.shift()!;
    for (const m of view.moves) {
      if (m.from !== at || depth.has(m.to)) continue;
      depth.set(m.to, depth.get(at)! + 1);
      queue.push(m.to);
    }
  }
  // Where work ends reads last: a done state takes the column after every other.
  const last = Math.max(0, ...view.states.filter((s) => s.class !== 'done').map((s) => depth.get(s.id) ?? 0)) + 1;
  const layers: string[][] = [];
  for (const s of view.states) {
    const d = s.class === 'done' && depth.has(s.id) ? last : depth.get(s.id);
    if (d !== undefined) (layers[d] ??= []).push(s.id);
  }
  return layers.filter((l) => l?.length);
}

function checkLifecycle(view: LifecycleView, path: string, bag: DiagnosticBag): void {
  const ids = new Set<string>();
  view.states.forEach((s, j) => {
    if (ids.has(s.id)) bag.error('duplicate-state', `state ${s.id} is declared twice`, { path: `${path}.states[${j}]` });
    ids.add(s.id);
  });
  const pairs = new Set<string>();
  view.moves.forEach((m, j) => {
    for (const end of [m.from, m.to]) if (!ids.has(end)) bag.error('unknown-state', `move refers to unknown state ${end}`, { path: `${path}.moves[${j}]`, hint: `States: ${[...ids].join(', ')}` });
    if (m.from === m.to) bag.error('unknown-state', `a move from ${m.from} to itself changes nothing`, { path: `${path}.moves[${j}]` });
    const pair = `${m.from}>${m.to}`;
    if (pairs.has(pair)) bag.error('duplicate-move', `two moves go from ${m.from} to ${m.to}; a move is named by where it goes`, { path: `${path}.moves[${j}]` });
    pairs.add(pair);
  });
}
