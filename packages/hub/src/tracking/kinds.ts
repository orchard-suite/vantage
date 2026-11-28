/**
 * Kinds (VAN-3015, VAN-3025). A kind is a document with a kind block, and
 * its lifecycle is a view of kind `lifecycle` in it, or the one its base
 * follows: a shipped kind, or another kind whose chain of bases ends at
 * one. Saving the document registers the kind in the same transaction as
 * the version (`register.ts`), so a kind the hub enforces is always one a
 * document says. Nothing here runs because an item moved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_KINDS, BUILT_IN_ROLES, parseDocumentText, type BaseKind, type Document, type KindLabel, type LifecycleMove, type LifecycleState, type StateClass } from '@vantage/model';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { badRequest } from '../http.ts';

/** A kind as the hub enforces it: the kind block with its base laid under it and its lifecycle read out of the view. */
export interface KindDef {
  readonly prefix: string;
  readonly name: string;
  /** What it builds on, as its file names it: a shipped kind, or another kind's prefix (VAN-3025). */
  readonly base?: string;
  /** The shipped kind its chain of bases ends at; absent for a kind that builds on none. */
  readonly root?: BaseKind;
  /** The system that keeps the content; absent when the hub does, and then an item has a body. */
  readonly owner?: string;
  readonly labels: readonly KindLabel[];
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly parts: readonly string[];
  /** Where the lifecycle is drawn: a view in the kind's document, a shipped kind's, or the document of the kind it builds on. */
  readonly drawnIn: { readonly view: string; readonly shipped?: BaseKind; readonly kind?: string };
  readonly states: readonly LifecycleState[];
  readonly moves: readonly LifecycleMove[];
}

export interface KindRow {
  readonly id: string;
  readonly org_id: string;
  readonly workspace_id: string;
  readonly document_id: string;
  readonly prefix: string;
  readonly name: string;
  readonly definition: KindDef;
  readonly version_id: string;
  readonly next_number: number;
}

export const SHIPPED_DIR = join(import.meta.dir, '..', '..', 'kinds');

const shippedCache = new Map<BaseKind, Document>();

/** A kind the hub ships, as its file says. */
export function shippedKind(base: BaseKind): Document {
  const hit = shippedCache.get(base);
  if (hit) return hit;
  const parsed = parseDocumentText(readFileSync(join(SHIPPED_DIR, `${base}.vantage.yaml`), 'utf8'), `${base}.vantage.yaml`);
  if (!parsed.document?.kind) throw new Error(`the shipped kind ${base} does not parse`);
  shippedCache.set(base, parsed.document);
  return parsed.document;
}

/** The text of a shipped kind's file, for an agent to read before it builds on one. */
export function shippedKindText(base: BaseKind): string {
  return readFileSync(join(SHIPPED_DIR, `${base}.vantage.yaml`), 'utf8');
}

function lifecycleOf(doc: Document, viewId: string): { states: LifecycleState[]; moves: LifecycleMove[] } | undefined {
  const v = doc.views.find((x) => x.id === viewId);
  return v?.kind === 'lifecycle' ? { states: v.states, moves: v.moves } : undefined;
}

/** Whether a base names a kind the hub ships, not another kind's prefix. */
export function isShipped(base: string): base is BaseKind {
  return (BASE_KINDS as readonly string[]).includes(base);
}

/** The shipped kind a kind's chain ends at; a definition saved before chains carried it names a shipped base itself. */
export function rootOf(def: Pick<KindDef, 'base' | 'root'>): BaseKind | undefined {
  return def.root ?? (def.base !== undefined && isShipped(def.base) ? def.base : undefined);
}

const shippedDefs = new Map<BaseKind, KindDef>();

/** A shipped kind as the hub enforces it. */
export function shippedDef(base: BaseKind): KindDef {
  let def = shippedDefs.get(base);
  if (!def) {
    def = kindOf(shippedKind(base))!;
    shippedDefs.set(base, def);
  }
  return def;
}

/**
 * The kind a document defines, with its base laid under it, or undefined
 * when it has no kind block. A base that is another kind's prefix comes in
 * as `built`, that kind as the hub already enforces it; a shipped base is
 * read here. Throws a 400 naming what is wrong: a move that names a role
 * nobody declared, a need on a label the kind lacks.
 */
export function kindOf(doc: Document, built?: KindDef): KindDef | undefined {
  const k = doc.kind;
  if (!k) return undefined;
  const base = k.base === undefined ? undefined : isShipped(k.base) ? shippedDef(k.base) : built;
  if (k.base !== undefined && !base) throw badRequest(`kind ${k.prefix} builds on ${k.base}, which is neither a shipped kind (${BASE_KINDS.join(', ')}) nor a kind the hub has`);
  const own = k.lifecycle ? lifecycleOf(doc, k.lifecycle) : undefined;
  if (k.lifecycle && !own) throw badRequest(`kind ${k.prefix} follows ${k.lifecycle}, which is not a lifecycle view in its file`);
  if (!own && !base) throw badRequest(`kind ${k.prefix} names no lifecycle; name a lifecycle view with lifecycle: <view id>, or build on a shipped kind with base: work-item`);
  // A kind adds its labels, roles, and parts to its base's; a label or a role it names again takes the base's place.
  const ownLabels = k.labels ?? [];
  const labels = [...(base?.labels ?? []).filter((b) => !ownLabels.some((l) => l.name === b.name)), ...ownLabels];
  const roles = { ...(base?.roles ?? {}), ...(k.roles ?? {}) };
  const parts = [...new Set([...(base?.parts ?? []), ...(k.parts ?? [])])];
  const root = k.base === undefined ? undefined : isShipped(k.base) ? k.base : base?.root;
  const drawnIn: KindDef['drawnIn'] = own
    ? { view: k.lifecycle! }
    : isShipped(k.base!)
      ? { view: base!.drawnIn.view, shipped: k.base }
      : base!.drawnIn.shipped || base!.drawnIn.kind
        ? base!.drawnIn
        : { view: base!.drawnIn.view, kind: base!.prefix };
  const def: KindDef = {
    prefix: k.prefix,
    name: k.name,
    ...(k.base ? { base: k.base } : {}),
    ...(root ? { root } : {}),
    ...(k.owner ? { owner: k.owner } : {}),
    labels,
    roles,
    parts,
    drawnIn,
    states: own?.states ?? base!.states,
    moves: own?.moves ?? base!.moves,
  };
  checkKind(def);
  return def;
}

function checkKind(def: KindDef): void {
  const labels = new Set(def.labels.map((l) => l.name));
  for (const l of def.labels) {
    if (l.type === 'choice' && !l.choices?.length) throw badRequest(`label ${l.name} is a choice and names no choices`);
    if (l.type !== 'choice' && l.choices) throw badRequest(`label ${l.name} is a ${l.type}; only a choice names choices`);
  }
  if (labels.size !== def.labels.length) throw badRequest(`kind ${def.prefix} names a label twice`);
  for (const m of def.moves) {
    for (const w of m.who ?? []) {
      if (!BUILT_IN_ROLES.includes(w) && !(w in def.roles)) throw badRequest(`the move from ${m.from} to ${m.to} names role ${w}, which kind ${def.prefix} does not declare; declare it under kind.roles, or use author, holder, or asker`);
    }
    for (const n of m.needs ?? []) {
      if (n.startsWith('label:') && !labels.has(n.slice(6))) throw badRequest(`the move from ${m.from} to ${m.to} needs label ${n.slice(6)}, which kind ${def.prefix} does not have`);
    }
  }
  for (const [role, who] of Object.entries(def.roles)) {
    if (BUILT_IN_ROLES.includes(role)) throw badRequest(`${role} is a role every kind has; name a role of your own`);
    for (const w of who) if (!w.startsWith('team:') && !w.includes('@')) throw badRequest(`role ${role} names ${w}; name a person by email or a team as team:<slug>`);
  }
}

/** Where an item starts: the first state the lifecycle draws. */
export function startState(def: KindDef): LifecycleState {
  return def.states[0]!;
}

export function stateOf(def: KindDef, id: string): LifecycleState | undefined {
  return def.states.find((s) => s.id === id);
}

export function classOf(def: KindDef, id: string): StateClass | undefined {
  return stateOf(def, id)?.class;
}

export async function kindByPrefix(db: Db, orgId: string, prefix: string): Promise<KindRow | undefined> {
  return maybe<KindRow>(db, 'select * from item_kinds where org_id = $1 and prefix = $2', [orgId, prefix.toUpperCase()]);
}

/** The kind a document defines, when it defines one. */
export async function kindOfDocument(db: Db, documentId: string): Promise<KindRow | undefined> {
  return maybe<KindRow>(db, 'select * from item_kinds where document_id = $1', [documentId]);
}

export async function kindById(db: Db, id: string): Promise<KindRow | undefined> {
  return maybe<KindRow>(db, 'select * from item_kinds where id = $1', [id]);
}

export async function kindsIn(db: Db, orgId: string, workspaceIds: readonly string[]): Promise<KindRow[]> {
  return db.query<KindRow>('select * from item_kinds where org_id = $1 and workspace_id = any($2::text[]) order by prefix', [orgId, [...workspaceIds]]);
}

/** Whether a prefix is taken in the organization by a registry or a kind other than `except`. */
export async function prefixTaken(db: Db, orgId: string, prefix: string, except?: { kindDocument?: string }): Promise<'registry' | 'kind' | undefined> {
  if (await maybe(db, 'select 1 as x from decision_registries where org_id = $1 and prefix = $2', [orgId, prefix])) return 'registry';
  const k = await maybe<{ document_id: string }>(db, 'select document_id from item_kinds where org_id = $1 and prefix = $2', [orgId, prefix]);
  if (k && k.document_id !== except?.kindDocument) return 'kind';
  return undefined;
}
