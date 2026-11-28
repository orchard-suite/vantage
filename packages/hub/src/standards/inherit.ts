/**
 * A record's map of the lines it inherits (VAN-3019). Each entry names a
 * line in a published edition of the record's own scope and how the record
 * stands against it. A refinement is at least as strict as the line it
 * refines, so musts only grow. An accepted record never departs without an
 * exception in force, and never marks a line whose open conflict holds both
 * lines until its ruling.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { badRequest } from '../http.ts';
import { placedById, placedByRef, refOf } from '../decisions/repo.ts';
import type { DecisionStatus, Inherit, InheritInput, Position } from '../decisions/types.ts';
import { listScopes } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import { BOTH, bindingKey, scopeKey, scopeName, type ScopeKey } from './model.ts';
import { editionOf } from './repo.ts';
import { standardSetting } from './setting.ts';
import { excepted, inForceExceptions } from './exceptions.ts';

/** The key of the edition that binds a workspace's records: its owner's, or its owner and program's, as far as the tree has them. */
export async function bindingOf(db: Db, orgId: string, workspaceId: string): Promise<ScopeKey> {
  const row = await maybe<{ scope: string | null; program: string | null }>(db, 'select scope, program from workspaces where id = $1', [workspaceId]);
  if (!row?.scope && !row?.program) return '';
  const ids = new Set((await listScopes(db, orgId, (await scopeSetting(db, orgId)).source)).map((s) => s.id));
  const owner = row.scope && ids.has(row.scope) ? row.scope : '';
  return bindingKey(owner, row.program && ids.has(row.program) ? row.program : null);
}

/** Checks a map against the editions it names, and answers it as the record keeps it. */
export async function resolveInherits(db: Db, orgId: string, self: { readonly id?: string; readonly registryId: string; readonly scope: ScopeKey; readonly position: Position | null }, input: readonly InheritInput[]): Promise<Inherit[]> {
  const out: Inherit[] = [];
  const bindings = (await standardSetting(db, orgId)).bindings;
  for (const entry of input) {
    const row = await placedByRef(db, orgId, entry.line, self.registryId);
    if (!row) throw badRequest(`inherits: no record ${entry.line}`);
    if (row.id === self.id) throw badRequest(`inherits: a record does not inherit its own line`);
    if (out.some((x) => x.line === row.id)) throw badRequest(`inherits: ${refOf(row)} is named twice; a record stands one way against a line`);
    const [name, n] = entry.edition.split('@') as [string, string];
    if (scopeKey(name) !== self.scope) throw badRequest(`inherits: ${refOf(row)} names edition ${entry.edition}, but this record is bound by standard/${scopeName(self.scope)}; read it and name its edition (guide#standards)`);
    const edition = await editionOf(db, orgId, self.scope, Number(n));
    if (!edition || edition.state !== 'published') throw badRequest(`inherits: ${scopeName(self.scope)} has no published edition ${n}; vantage_outline standard/${scopeName(self.scope)} lists them`);
    const line = edition.body.lines.find((l) => l.record === row.id);
    if (!line) throw badRequest(`inherits: ${refOf(row)} sets no line in standard/${entry.edition}; a record marks only the lines that reach its scope`);
    if (entry.stance === 'refines') {
      if (!self.position) throw badRequest(`inherits: a record that refines ${refOf(row)} carries a position: the stricter line it sets (guide#standards)`);
      const mine = bindings.indexOf(self.position.binding);
      const theirs = bindings.indexOf(line.position.binding);
      if (mine > theirs) throw badRequest(`inherits: ${refOf(row)} binds "${line.position.binding}" and this line binds "${self.position.binding}"; a refinement is at least as strict, so this is a departure (stance: departs), which needs an exception`);
    }
    out.push({ line: row.id, stance: entry.stance, scope: self.scope, version: edition.version });
  }
  return out;
}

/** A kept map as a writer would send it, to check it again against a changed position. */
export async function inheritInputs(db: Db, orgId: string, inherits: readonly Inherit[]): Promise<InheritInput[]> {
  const out: InheritInput[] = [];
  for (const i of inherits) {
    const r = await placedById(db, orgId, i.line);
    if (r) out.push({ line: refOf(r), stance: i.stance, edition: `${scopeName(i.scope)}@${i.version}` });
  }
  return out;
}

/**
 * Refuses an accepted record that departs with no exception in force, or that
 * marks a line an open conflict holds with its rival until the ruling.
 */
export async function checkStanding(db: Db, orgId: string, row: { readonly id?: string; readonly ref: string; readonly status: DecisionStatus; readonly scope: ScopeKey; readonly inherits: readonly Inherit[] }): Promise<void> {
  if (row.status !== 'accepted' || !row.inherits.length) return;
  const granted = row.inherits.some((i) => i.stance === 'departs') ? await inForceExceptions(db, orgId) : [];
  const byId = new Map((await listScopes(db, orgId, (await scopeSetting(db, orgId)).source)).map((s) => [s.id, s]));
  const name = async (id: string): Promise<string> => {
    const r = await placedById(db, orgId, id);
    return r ? refOf(r) : id;
  };
  for (const i of row.inherits) {
    if (i.stance === 'departs' && !excepted(granted, i.line, row.id, row.scope, byId)) throw badRequest(`${row.ref} departs from ${await name(i.line)}, and no exception in force covers it; a record that departs is accepted only with an exception granted by that line's steward (VAN-3020). Keep it proposed until then.`);
  }
  const edition = await editionOf(db, orgId, row.scope);
  for (const c of edition?.body.conflicts ?? []) {
    if (c.holds !== BOTH) continue;
    const marked = await Promise.all(row.inherits.map(async (i) => name(i.line)));
    const hit = c.lines.find((l) => marked.includes(l));
    if (hit) throw badRequest(`${row.ref} marks ${hit}, which conflicts/${c.conflict} holds beside ${c.lines.find((l) => l !== hit)} until its steward rules; keep the record proposed until then (vantage_read conflicts/${c.conflict})`);
  }
}
