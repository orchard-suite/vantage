/**
 * A scope's standard as text at `standard/<scope>`: a header with its
 * edition and manifest, then one section per area with a line each, then
 * the packs, the procedure pages, and what changed. `standard/<scope>@<n>`
 * is edition n. It is read with the five verbs like every other thing
 * (VAN-5002) and is never written: change a record's position instead.
 * The estate's settings are text at `standard`.
 */
import { parse, stringify } from 'yaml';
import { sha256 } from '../crypto.ts';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { badRequest, HttpError } from '../http.ts';
import { listScopes } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import type { Change, Edition, PackPin, StandardLine } from './model.ts';
import { ESTATE, scopeKey, scopeName } from './model.ts';
import { editionOf } from './repo.ts';
import { StandardSettingSchema, standardSetting, type StandardSetting } from './setting.ts';
import { dayOf } from '../day.ts';

/** The address of the estate's settings and the root of every scope's standard. */
export const STANDARD = 'standard';

const day = (d: Date | null): string | undefined => (d ? dayOf(d) : undefined);

/** How a line reached the scope: its own, down the tree, or by a facet. */
export function pathText(l: StandardLine): string {
  if (!l.path.length) return 'own';
  const chain = l.path.map(scopeName).join(' < ');
  return l.facet !== undefined ? `by facet ${l.facet} from ${chain}` : `from ${chain}`;
}

export function lineText(l: StandardLine): string {
  const x = l.position;
  const extra = [
    x.reach.below ? '' : 'this scope only',
    x.reach.facets.length ? `facets ${x.reach.facets.join(', ')}` : '',
    x.reach.paths.length ? `paths ${x.reach.paths.join(', ')}` : '',
    x.enforced_by.length ? `enforced by ${x.enforced_by.join(', ')}` : '',
    x.checked_by.length ? `checked by ${x.checked_by.join(', ')}` : '',
  ].filter(Boolean);
  return `- ${x.binding} (${x.binds.join(', ')}${x.locked ? ', locked' : ''}): ${x.line} ${l.ref}, ${pathText(l)}${extra.length ? `; ${extra.join('; ')}` : ''}`;
}

export function packText(p: PackPin): string {
  const params = Object.entries(p.parameters);
  return `- ${p.pack} ${p.version} ${p.hash} ${p.origin}, ${p.on ? 'on' : 'off'}, from ${scopeName(p.from)}${params.length ? `; parameters ${params.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}` : ''}`;
}

export function changeText(c: Change): string {
  switch (c.what) {
    case 'line':
      return `- ${c.change} ${c.ref}: ${c.line}`;
    case 'pack':
      return `- ${c.change} pack ${c.pack} ${c.version}`;
    case 'page':
      return `- ${c.change} page ${c.page}`;
  }
}

/** The version a reader holds: the edition's number and the start of its hash. */
export const editionVersion = (e: Pick<Edition, 'version' | 'hash'> | undefined): string => (e ? `${e.version}:${e.hash.slice(7, 19)}` : 'none');

export interface ScopeHead {
  readonly name: string;
  readonly title: string;
  readonly kind: string;
  readonly steward?: string;
}

export function standardText(head: ScopeHead, e: Edition | undefined): string {
  if (!e) return `---\n${stringify({ standard: head.name, name: head.title, kind: head.kind, ...(head.steward ? { steward: head.steward } : {}), edition: 'none' }, { lineWidth: 0 })}---\n\nNo line reaches ${head.name} yet. A line is the position of an accepted record (guide#standards).\n`;
  const b = e.body;
  const header = {
    standard: head.name,
    name: e.manifest.name,
    kind: e.manifest.kind,
    ...(e.manifest.steward ? { steward: e.manifest.steward } : {}),
    edition: e.version,
    hash: e.hash,
    ...(e.publishedAt ? { published: day(e.publishedAt) } : {}),
    ...(e.state !== 'published' ? { state: e.state } : {}),
    builds_on: e.manifest.builds_on.map((x) => `${x.scope}@${x.version}`),
    lines: b.lines.length,
    packs: b.packs.length,
    exceptions: b.exceptions.length,
    pages: b.pages.length,
  };
  const out = [`---\n${stringify(header, { lineWidth: 0 })}---`];
  const areas = [...new Set(b.lines.map((l) => l.area))];
  for (const area of areas) out.push('', `## ${area}`, '', ...b.lines.filter((l) => l.area === area).map(lineText));
  if (!areas.length) out.push('', 'No line reaches this scope.');
  if (b.packs.length) out.push('', '## Packs', '', ...b.packs.map(packText));
  if (b.pages.length) out.push('', '## Procedures', '', ...b.pages.map((p) => `- ${p.page} (${p.title}): ${p.cites.join(', ')}`));
  if (e.changes.length) out.push('', `## Changes from edition ${e.version - 1}`, '', ...e.changes.map(changeText));
  if (e.problems.length) out.push('', '## Refused by the machine gate', '', ...e.problems.map((x) => `- ${x}`));
  return `${out.join('\n')}\n`;
}

/** `payments`, `payments@3`, or `estate`: the scope, and the edition when one is named. */
export function parseStandardName(text: string): { name: string; version?: number } {
  const m = /^(.+)@(\d+)$/.exec(text);
  return m ? { name: m[1]!, version: Number(m[2]) } : { name: text };
}

/** A scope's head as the tree has it now; the whole estate is always there. */
export async function scopeHead(ctx: AppContext, p: Principal, name: string): Promise<ScopeHead | undefined> {
  if (name === ESTATE) return { name, title: 'The whole estate', kind: ESTATE };
  const s = (await listScopes(ctx.db, p.orgId, (await scopeSetting(ctx.db, p.orgId)).source)).find((x) => x.id === name);
  return s ? { name, title: s.name, kind: s.kind, ...(s.steward ? { steward: s.steward } : {}) } : undefined;
}

/** The text and version of one scope's standard, the newest edition or the one named. */
export async function standardThing(ctx: AppContext, p: Principal, address: string): Promise<{ address: string; version: string; text: string }> {
  const { name, version } = parseStandardName(address);
  const e = await editionOf(ctx.db, p.orgId, scopeKey(name), version);
  const head = (await scopeHead(ctx, p, name)) ?? (e ? { name, title: e.manifest.name, kind: e.manifest.kind } : undefined);
  if (!head) throw new HttpError(404, `no scope ${name}; vantage_outline scopes lists them, and standard/estate is the whole estate`);
  if (version !== undefined && !e) throw new HttpError(404, `${name} has no edition ${version}; vantage_outline ${STANDARD}/${name} lists its editions`);
  return { address: `${STANDARD}/${version !== undefined ? address : name}`, version: editionVersion(e), text: standardText(head, e) };
}

export function settingsText(s: StandardSetting): string {
  return stringify(s, { lineWidth: 0 });
}

export async function settingsThing(ctx: AppContext, p: Principal): Promise<{ address: string; version: string; text: string }> {
  const text = settingsText(await standardSetting(ctx.db, p.orgId));
  return { address: STANDARD, version: (await sha256(text)).slice(0, 16), text };
}

export function parseSettingsText(text: string): StandardSetting {
  let raw: unknown;
  try {
    raw = parse(text) ?? {};
  } catch (err) {
    throw badRequest(`the standard's settings are not YAML: ${(err as Error).message}`);
  }
  const r = StandardSettingSchema.safeParse(raw);
  if (!r.success) throw badRequest(`the standard's settings do not read: ${r.error.issues.map((i) => `${i.path.join('.') || 'text'}: ${i.message}`).join('; ')}`);
  return r.data;
}
