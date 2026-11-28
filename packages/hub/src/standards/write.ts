/**
 * A change to the estate's standard settings at `standard`. The lists,
 * the steward gate, and the withheld words are an admin's; a scope's packs
 * are its steward's or an admin's. Every change rebuilds the standards in
 * the same transaction. A scope's own standard is built, so a write to
 * `standard/<scope>` is refused with where its lines come from.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { audit, type Surface } from '../audit.ts';
import { whoOf } from '../decisions/write.ts';
import { badRequest, forbidden } from '../http.ts';
import { actsFor } from './steward.ts';
import { listScopes } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import { sha256 } from '../crypto.ts';
import { kindByPrefix } from '../tracking/kinds.ts';
import { ESTATE } from './model.ts';
import { rebuildStandards, type Built } from './publish.ts';
import { lockStandards } from './repo.ts';
import { setStandardSetting, standardSetting } from './setting.ts';
import { parseSettingsText, settingsText, STANDARD } from './text.ts';

export interface StandardWrite {
  readonly status: 'saved' | 'unchanged';
  readonly version: string;
  readonly message: string;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const builtText = (built: readonly Built[]): string => built.map((b) => `${b.scope} edition ${b.version} ${b.state}`).join(', ');

export async function writeStandardSettings(ctx: AppContext, p: Principal, text: string, surface: Surface): Promise<StandardWrite> {
  const next = parseSettingsText(text);
  const now = await standardSetting(ctx.db, p.orgId);
  const said: string[] = [];
  for (const k of ['bindings', 'binds', 'steward_gate', 'withhold', 'clash', 'ranked', 'checks', 'exceptions'] as const) {
    if (same(now[k], next[k])) continue;
    if (!p.admin) throw forbidden(`only an admin changes ${STANDARD}#${k}`);
    said.push(`${k} set`);
  }
  if (next.checks !== undefined && next.checks !== now.checks && !(await kindByPrefix(ctx.db, p.orgId, next.checks))) throw badRequest(`checks: no kind ${next.checks}; name a kind of tracked items, built on base: work-item, for the hub to file its checking into (guide#kinds-and-items)`);
  const tree = await listScopes(ctx.db, p.orgId, (await scopeSetting(ctx.db, p.orgId)).source);
  const stewards = new Map(tree.map((s) => [s.id, s.steward]));
  for (const name of new Set([...Object.keys(now.packs), ...Object.keys(next.packs)])) {
    if (same(now.packs[name] ?? [], next.packs[name] ?? [])) continue;
    if (name !== ESTATE && !stewards.has(name)) throw badRequest(`packs.${name}: no scope ${name} in the tree; a scope's id, or ${ESTATE} for the whole estate`);
    if (!(await actsFor(ctx.db, p, stewards.get(name)))) throw forbidden(`only the steward of ${name} or an admin changes the packs it adopts`);
    const ids = (next.packs[name] ?? []).map((x) => x.pack);
    const twice = ids.find((id, i) => ids.indexOf(id) !== i);
    if (twice) throw badRequest(`packs.${name} adopts ${twice} twice; a scope adopts a pack once`);
    said.push(`${name} adopts ${ids.length ? ids.join(', ') : 'no pack'}`);
  }
  const version = (await sha256(settingsText(next))).slice(0, 16);
  if (!said.length) return { status: 'unchanged', version, message: `unchanged: ${STANDARD} is still version ${version}` };
  const built = await ctx.db.transaction(async (tx) => {
    await lockStandards(tx, p.orgId);
    await setStandardSetting(tx, p.orgId, next);
    return rebuildStandards(ctx, tx, p.orgId, whoOf(p));
  });
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: whoOf(p), what: 'standard.settings', surface, target: STANDARD, details: { changes: said } });
  return { status: 'saved', version, message: `saved ${STANDARD} version ${version}: ${said.join('; ')}${built.length ? `; built ${builtText(built)}` : ''}` };
}

/** A scope's standard is never written by hand. */
export function refuseStandardWrite(address: string): never {
  throw badRequest(`${address} is built from records and is never written: change a record's position: block, or the packs a scope adopts at ${STANDARD}#packs (guide#standards)`);
}
