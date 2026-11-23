/**
 * Kinds (VAN-3008). A kind is a document with a kind block, and
 * its lifecycle is a view of kind `lifecycle` in it, or the one a shipped
 * kind draws when it builds on one. Saving the document registers the kind
 * in the same transaction as the version, so a kind the hub enforces is
 * always one a document says. Nothing here runs because an item moved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_ROLES, parseDocumentText, type BaseKind, type Document, type KindLabel, type LifecycleMove, type LifecycleState, type StateClass } from '@vantage/model';
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { randomId } from '../crypto.ts';
import { badRequest } from '../http.ts';

/** A kind as the hub enforces it: the kind block with its base laid under it and its lifecycle read out of the view. */
export interface KindDef {
  readonly prefix: string;
  readonly name: string;
  readonly base?: BaseKind;
  /** The system that keeps the content; absent when the hub does, and then an item has a body. */
  readonly owner?: string;
  readonly labels: readonly KindLabel[];
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly parts: readonly string[];
  /** Where the lifecycle is drawn: a view in the kind's document, or a shipped kind's. */
  readonly drawnIn: { readonly view: string; readonly shipped?: BaseKind };
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

/**
 * The kind a document defines, with its base laid under it, or undefined
 * when it has no kind block. Throws a 400 naming what is wrong: a move that
 * names a role nobody declared, a need on a label the kind lacks.
 */
export function kindOf(doc: Document): KindDef | undefined {
  const k = doc.kind;
  if (!k) return undefined;
  const base = k.base ? shippedKind(k.base).kind! : undefined;
  const lifecycle = k.lifecycle ?? base?.lifecycle;
  if (!lifecycle) throw badRequest(`kind ${k.prefix} names no lifecycle; name a lifecycle view with lifecycle: <view id>, or build on a shipped kind with base: work-item`);
  const own = k.lifecycle ? lifecycleOf(doc, k.lifecycle) : undefined;
  const drawn = own ?? (k.base ? lifecycleOf(shippedKind(k.base), lifecycle) : undefined);
  if (!drawn) throw badRequest(`kind ${k.prefix} follows ${lifecycle}, which is not a lifecycle view in its file`);
  // A kind adds its labels to its base's; one it names again takes the base's place.
  const ownLabels = k.labels ?? [];
  const labels = [...(base?.labels ?? []).filter((b) => !ownLabels.some((l) => l.name === b.name)), ...ownLabels];
  const roles = { ...(base?.roles ?? {}), ...(k.roles ?? {}) };
  const def: KindDef = {
    prefix: k.prefix,
    name: k.name,
    ...(k.base ? { base: k.base } : {}),
    ...(k.owner ? { owner: k.owner } : {}),
    labels,
    roles,
    parts: [...(k.parts ?? [])],
    drawnIn: own ? { view: k.lifecycle! } : { view: lifecycle, ...(k.base ? { shipped: k.base } : {}) },
    states: drawn.states,
    moves: drawn.moves,
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

/**
 * Registers, changes, or drops the kind a document's head defines, inside
 * the save's transaction, so a save that would break a kind saves nothing.
 * A kind with items keeps its block and its prefix, and keeps every state
 * an item is in.
 */
export async function registerKind(tx: Db, input: { orgId: string; workspaceId: string; documentId: string; versionId: string; doc: Document | undefined }): Promise<KindRow | undefined> {
  const existing = await maybe<KindRow>(tx, 'select * from item_kinds where document_id = $1', [input.documentId]);
  const def = input.doc ? kindOf(input.doc) : undefined;
  const counted = existing ? await tx.query<{ state: string; n: number }>('select state, count(*)::int as n from items where kind_id = $1 group by state', [existing.id]) : [];
  const items = counted.reduce((s, r) => s + Number(r.n), 0);
  if (!def) {
    if (!existing) return undefined;
    if (items) throw badRequest(`this document defines kind ${existing.prefix}, which has ${items} item(s); a kind with items keeps its kind block`);
    await tx.query('delete from item_kinds where id = $1', [existing.id]);
    return undefined;
  }
  if (existing && existing.prefix !== def.prefix && items) throw badRequest(`kind ${existing.prefix} has ${items} item(s), so its prefix never changes; keep prefix: ${existing.prefix}`);
  const taken = await prefixTaken(tx, input.orgId, def.prefix, { kindDocument: input.documentId });
  if (taken) throw badRequest(`the prefix ${def.prefix} is taken in this organization by ${taken === 'registry' ? 'a decision registry' : 'another kind'}; prefixes, registries, and workspace names share one namespace, so pick another`);
  for (const r of counted) {
    if (!def.states.some((s) => s.id === r.state)) throw badRequest(`${r.n} item(s) of kind ${def.prefix} are in state ${r.state}, which the lifecycle no longer draws; keep the state, or move them out first`);
  }
  if (existing) {
    await tx.query('update item_kinds set prefix = $2, name = $3, definition = $4, version_id = $5, workspace_id = $6, updated_at = now() where id = $1', [existing.id, def.prefix, def.name, JSON.stringify(def), input.versionId, input.workspaceId]);
    return { ...existing, prefix: def.prefix, name: def.name, definition: def, version_id: input.versionId, workspace_id: input.workspaceId };
  }
  const id = randomId();
  await tx.query('insert into item_kinds (id, org_id, workspace_id, document_id, prefix, name, definition, version_id) values ($1, $2, $3, $4, $5, $6, $7, $8)', [id, input.orgId, input.workspaceId, input.documentId, def.prefix, def.name, JSON.stringify(def), input.versionId]);
  return { id, org_id: input.orgId, workspace_id: input.workspaceId, document_id: input.documentId, prefix: def.prefix, name: def.name, definition: def, version_id: input.versionId, next_number: 1 };
}
