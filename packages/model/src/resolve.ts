/**
 * Turns a validated Document (plus its imports) into a Model. Reports every
 * unresolved reference with its YAML path so an agent can fix it.
 */
import { ARTIFACT_DIR } from './schema-docs.ts';
import { BUILTIN_TYPES, DEFAULT_TYPE, type NodeType } from './types.ts';
import { PROFILES, profileTypes } from './profiles.ts';
import type { Document, NodeOutput, RelationKind, TypeDef } from './schema.ts';
import type { Model, ModelNode, ModelRelation } from './model.ts';
import { DiagnosticBag } from './diagnostics.ts';
import { isDocumentPath } from './model.ts';
import { citableRef } from './decision-ref.ts';
import { resolveViews } from './views.ts';

export interface ImportedDocument {
  readonly prefix: string;
  readonly document: Document;
  readonly imports: readonly ImportedDocument[];
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface TypeTable {
  readonly get: (name: string) => NodeType | undefined;
}

/** A type from any profile by its qualified name, `azure.keyvault`, whether or not the document lists the profile. */
function qualifiedType(name: string): NodeType | undefined {
  const dot = name.indexOf('.');
  return dot > 0 ? PROFILES.get(name.slice(0, dot))?.types.get(name.slice(dot + 1)) : undefined;
}

function buildTypes(doc: Document, bag: DiagnosticBag): TypeTable {
  for (const p of doc.profiles ?? []) {
    if (!PROFILES.has(p)) bag.error('unknown-profile', `unknown profile ${p}`, { path: 'profiles', hint: `Profiles: ${[...PROFILES.keys()].join(', ')}` });
  }
  const table = profileTypes(doc.profiles ?? []);
  const known = (name: string): NodeType | undefined => table.get(name) ?? qualifiedType(name);
  const local = new Map<string, NodeType>();
  for (const [name, def] of Object.entries(doc.types ?? {})) {
    local.set(name, mergeType(name, def, bag, known));
  }
  return { get: (name) => local.get(name) ?? known(name) };
}

function mergeType(name: string, def: TypeDef, bag: DiagnosticBag, known: (name: string) => NodeType | undefined): NodeType {
  const base = def.extends ? known(def.extends) : undefined;
  if (def.extends && !base) {
    bag.error('unknown-type', `type ${name} extends unknown type ${def.extends}`, {
      path: `types.${name}.extends`,
      hint: 'Extend a built-in type, a type of a listed profile, or a qualified profile type such as azure.keyvault',
    });
  }
  const b = base ?? DEFAULT_TYPE;
  const icon = def.icon ?? b.icon;
  const frame = def.frame ?? b.frame;
  return {
    name,
    role: def.role ?? b.role,
    shape: def.shape ?? b.shape,
    color: def.color ?? b.color,
    ...(icon !== undefined ? { icon } : {}),
    ...(frame !== undefined ? { frame } : {}),
    description: def.description ?? b.description,
  };
}

interface Collected {
  nodes: Map<string, ModelNode>;
  roots: string[];
  relations: ModelRelation[];
  icons: Map<string, string>;
}

/** Where relative image paths resolve from: the directory of the document being loaded. */
let baseDir: string | undefined;

function locateImage(ref: string, dir: string | undefined): string {
  if (/^(https?:|data:|\/)/.test(ref) || dir === undefined) return ref;
  return `${dir.replace(/\/$/, '')}/${ref}`;
}

function collectNodes(
  list: readonly NodeOutput[],
  prefix: string,
  parentId: string | undefined,
  depth: number,
  types: TypeTable,
  bag: DiagnosticBag,
  out: Collected,
  path: string,
  nameIndex: Map<string, string>,
): string[] {
  const ids: string[] = [];
  list.forEach((n, i) => {
    const p = `${path}[${i}]`;
    const localId = n.id ?? slug(n.name);
    const id = prefix ? `${prefix}.${localId}` : localId;
    if (out.nodes.has(id)) {
      bag.error('duplicate-id', `node id ${id} is declared twice`, { path: p, hint: 'Give one of them an explicit, distinct `id`' });
      return;
    }
    for (const [i, d] of (n.decisions ?? []).entries()) {
      if (!citableRef(d)) bag.error('bad-decision-ref', `node ${id} cites ${JSON.stringify(d)}, which is not a decision record citation`, { path: `${p}.decisions[${i}]`, hint: 'Cite a record as its registry prefix and number, SHOP-2001, or as adr:<ULID>' });
    }
    const type = n.type ? types.get(n.type) : undefined;
    if (n.type && !type) {
      bag.error('unknown-type', `node ${id} has unknown type ${n.type}`, {
        path: `${p}.type`,
        hint: `Use a built-in type, a profile type (azure.keyvault, aws.lambda, k8s.deployment), or declare it under \`types:\`. Built-ins: ${[...BUILTIN_TYPES.keys()].join(', ')}`,
      });
    }
    const t = type ?? DEFAULT_TYPE;
    const icon = n.icon ?? (n.image !== undefined ? undefined : t.icon);
    const style = t.frame !== undefined && n.style?.frame === undefined ? { ...(n.style ?? {}), frame: t.frame } : (n.style ?? {});
    const image = n.image !== undefined ? locateImage(n.image, baseDir) : undefined;
    const node: ModelNode = {
      id,
      name: n.name,
      typeName: t.name,
      role: t.role,
      shape: n.shape ?? t.shape,
      color: n.color ?? t.color,
      ...(icon !== undefined ? { icon } : {}),
      ...(image !== undefined ? { image, imageSize: { w: n.imageWidth ?? 160, h: n.imageHeight ?? 100 } } : {}),
      ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
      ...(n.description !== undefined ? { description: n.description } : {}),
      ...(n.url !== undefined ? { url: n.url } : {}),
      ...(n.decisions?.length ? { decisions: [...new Set(n.decisions)] } : {}),
      tags: n.tags ?? [],
      style,
      ...(n.count !== undefined ? { count: n.count } : {}),
      facts: n.facts ?? [],
      bullets: n.bullets ?? [],
      ...(n.value !== undefined ? { value: n.value } : {}),
      size: n.size ?? 'normal',
      ...(n.note !== undefined ? { note: n.note } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      childIds: [],
      depth,
      ...(prefix ? { namespace: prefix } : {}),
      ...(n.bind !== undefined ? { bind: n.bind } : {}),
      ...(n.provenance !== undefined ? { provenance: n.provenance } : {}),
      ...(n.openItems?.length ? { openItems: n.openItems } : {}),
    };
    out.nodes.set(id, node);
    nameIndex.set(prefix ? `${prefix}.${slug(n.name)}` : slug(n.name), id);
    ids.push(id);
    const childIds = collectNodes(n.children ?? [], prefix, id, depth + 1, types, bag, out, `${p}.children`, nameIndex);
    out.nodes.set(id, { ...node, childIds });
  });
  return ids;
}

export interface RefResolver {
  (ref: string, path: string): string | undefined;
}

function makeResolver(nodes: Map<string, ModelNode>, nameIndex: Map<string, string>, bag: DiagnosticBag): RefResolver {
  return (ref, path) => {
    if (nodes.has(ref)) return ref;
    const byName = nameIndex.get(slug(ref));
    if (byName !== undefined) return byName;
    const candidates = [...nodes.keys()].filter((k) => k.endsWith(`.${ref}`) || k === slug(ref));
    if (candidates.length === 1) return candidates[0];
    const near = [...nodes.keys()].filter((k) => k.includes(slug(ref).slice(0, 4))).slice(0, 5);
    bag.error('unknown-node', `no node with id ${ref}`, {
      path,
      hint: near.length ? `Did you mean: ${near.join(', ')}` : 'Declare it under `nodes:` or fix the id',
    });
    return undefined;
  };
}

export function expandRelation(
  r: Document['relations'] extends (infer R)[] | undefined ? R : never,
  idBase: string,
  path: string,
  resolve: RefResolver,
  viewId: string | undefined,
  out: ModelRelation[],
): void {
  const froms = r.from.map((f) => resolve(f, `${path}.from`)).filter((x): x is string => x !== undefined);
  const tos = r.to.map((f) => resolve(f, `${path}.to`)).filter((x): x is string => x !== undefined);
  const via = (r.via ?? []).map((v) => resolve(v, `${path}.via`)).filter((x): x is string => x !== undefined);
  let n = 0;
  for (const from of froms) {
    for (const to of tos) {
      const id = r.id ? (froms.length * tos.length > 1 ? `${r.id}-${n}` : r.id) : `${idBase}-${n}`;
      n++;
      out.push({
        id,
        from,
        to,
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...(r.description !== undefined ? { description: r.description } : {}),
        kind: (r.kind ?? 'sync') as RelationKind,
        via,
        tags: r.tags ?? [],
        both: r.both ?? false,
        weight: r.weight ?? 1,
        ...(r.color !== undefined ? { color: r.color } : {}),
        style: r.style ?? 'orthogonal',
        ...(r.heads !== undefined ? { heads: { ...(r.heads.from !== undefined ? { from: r.heads.from } : {}), ...(r.heads.to !== undefined ? { to: r.heads.to } : {}) } } : {}),
        ...(viewId !== undefined ? { viewId } : {}),
      });
    }
  }
}

function collectDocument(doc: Document, prefix: string, imports: readonly ImportedDocument[], bag: DiagnosticBag, out: Collected, nameIndex: Map<string, string>): void {
  for (const imp of imports) {
    const childPrefix = prefix ? `${prefix}.${imp.prefix}` : imp.prefix;
    collectDocument(imp.document, childPrefix, imp.imports, bag, out, nameIndex);
  }
  for (const [id, ref] of Object.entries(doc.icons ?? {})) {
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) {
      bag.error('bad-icon-id', `icon id ${id} is not pack/name`, { path: `icons.${id}`, hint: 'Use lowercase letters, digits, and dashes, with your own pack name: acme/logo' });
      continue;
    }
    const located = locateImage(ref, baseDir);
    const had = out.icons.get(id);
    if (had !== undefined && had !== located) bag.warn('duplicate-icon', `icon ${id} is declared twice with different files; the root document wins`, { path: `icons.${id}` });
    out.icons.set(id, located);
  }
  const types = buildTypes(doc, bag);
  const roots = collectNodes(doc.nodes, prefix, undefined, 0, types, bag, out, prefix ? `import(${prefix}).nodes` : 'nodes', nameIndex);
  out.roots.push(...roots);
}

export function resolveModel(doc: Document, imports: readonly ImportedDocument[] = [], file?: string): Model {
  const bag = new DiagnosticBag(file);
  baseDir = file !== undefined && file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : undefined;
  const out: Collected = { nodes: new Map(), roots: [], relations: [], icons: new Map() };
  const nameIndex = new Map<string, string>();
  collectDocument(doc, '', imports, bag, out, nameIndex);
  const resolve = makeResolver(out.nodes, nameIndex, bag);

  const addModelRelations = (d: Document, prefix: string, imps: readonly ImportedDocument[]): void => {
    for (const imp of imps) addModelRelations(imp.document, prefix ? `${prefix}.${imp.prefix}` : imp.prefix, imp.imports);
    (d.relations ?? []).forEach((r, i) => {
      const scoped = (ref: string, p: string): string | undefined => resolve(prefix && !out.nodes.has(ref) ? `${prefix}.${ref}` : ref, p);
      expandRelation(r, prefix ? `${prefix}.rel-${i}` : `rel-${i}`, prefix ? `import(${prefix}).relations[${i}]` : `relations[${i}]`, scoped, undefined, out.relations);
    });
  };
  addModelRelations(doc, '', imports);

  // A doc view's file, and the files its page embeds, resolve from the document's folder, as a picture does.
  const dir = baseDir;
  checkKind(doc, bag);
  const views = resolveViews(doc, out.nodes, out.relations, resolve, bag).map((v) => (v.kind === 'doc' ? { ...v, ...(v.file !== undefined ? { file: locateImage(v.file, dir) } : {}), ...(dir !== undefined ? { dir } : {}) } : v));
  checkDocs(doc, out.nodes, views, bag);

  return {
    title: doc.title ?? 'Untitled',
    ...(doc.author !== undefined ? { author: doc.author } : {}),
    ...(doc.updated !== undefined ? { updated: doc.updated } : {}),
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    theme: doc.theme ?? 'light',
    nodes: out.nodes,
    roots: out.roots,
    relations: out.relations,
    views,
    icons: out.icons,
    ...(doc.docs !== undefined ? { docs: doc.docs } : {}),
    artifacts: (doc.artifacts ?? []).filter((a) => artifactPath(a.file)).map((a) => ({ ...a, file: locateImage(a.file, dir) })),
    evidence: doc.evidence ?? [],
    diagnostics: bag.items,
  };
}

function artifactPath(file: string): boolean {
  return file.startsWith(ARTIFACT_DIR) && isDocumentPath(file);
}

/** The contract's pages are doc views, artifacts live under artifacts/, and every tie points at a box or a view. Page anchors are checked with the pages. */
function checkDocs(doc: Document, nodes: ReadonlyMap<string, ModelNode>, views: readonly { id: string; kind: string }[], bag: DiagnosticBag): void {
  const kinds = new Map(views.map((v) => [v.id, v.kind]));
  (doc.docs?.pages ?? []).forEach((id, i) => {
    if (kinds.get(id) !== 'doc') bag.error('docs-page-missing', `the contract asks for page ${id}, and the document has no doc view ${id}`, { path: `docs.pages[${i}]`, hint: `Write the page as a kind: doc view with id ${id}, or take it out of docs.pages. Doc views here: ${views.filter((v) => v.kind === 'doc').map((v) => v.id).join(', ') || 'none'}` });
  });
  (doc.artifacts ?? []).forEach((a, i) => {
    if (!artifactPath(a.file)) bag.error('artifact-path', `artifact ${a.file} is not a path under ${ARTIFACT_DIR}`, { path: `artifacts[${i}].file`, hint: `Keep artifacts in the document's ${ARTIFACT_DIR} folder, such as ${ARTIFACT_DIR}SPEC.md; no .. and no leading /` });
  });
  (doc.evidence ?? []).forEach((e, i) => {
    const hash = e.to.indexOf('#');
    const view = hash >= 0 ? e.to.slice(0, hash) : e.to;
    const known = hash >= 0 ? kinds.get(view) === 'doc' : nodes.has(e.to) || kinds.has(e.to);
    if (!known) bag.error('evidence-unknown-target', `evidence ${i} points at ${e.to}, which is not a box, a view, or a section of a page`, { path: `evidence[${i}].to`, hint: 'Give a box id, a view id, or a page section as page#anchor' });
    e.files.forEach((f, j) => {
      if (f.startsWith('/') || f.split('/').some((p) => p === '..')) bag.error('evidence-path', `evidence ${i} names ${f}, which is not a path inside the repository`, { path: `evidence[${i}].files[${j}]`, hint: 'Write repository paths from its root, such as src/orders/ or src/api.ts' });
    });
  });
}

/** A kind follows a lifecycle: a lifecycle view in its own file, or the one its base kind ships. */
function checkKind(doc: Document, bag: DiagnosticBag): void {
  const kind = doc.kind;
  if (!kind) return;
  if (kind.lifecycle === undefined) {
    if (kind.base === undefined) bag.error('kind-lifecycle', `kind ${kind.prefix} names no lifecycle`, { path: 'kind', hint: 'Name a lifecycle view in this file with lifecycle: <view id>, or build on a shipped kind with base: work-item' });
    return;
  }
  const view = doc.views.find((v) => v.id === kind.lifecycle);
  if (!view || view.kind !== 'lifecycle') bag.error('kind-lifecycle', `kind ${kind.prefix} follows ${kind.lifecycle}, which is not a lifecycle view in this file`, { path: 'kind.lifecycle', hint: `Lifecycle views here: ${doc.views.filter((v) => v.kind === 'lifecycle').map((v) => v.id).join(', ') || 'none'}` });
}
