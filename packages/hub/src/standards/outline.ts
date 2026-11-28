/** What `vantage_outline standard` and `vantage_outline standard/<scope>` answer: names, counts, and where each edition stands, never the lines. */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { HttpError } from '../http.ts';
import { listScopes } from '../scopes/repo.ts';
import { scopeSetting } from '../scopes/setting.ts';
import { ESTATE, scopeKey, scopeName, type Edition } from './model.ts';
import { editionOf, editionsOf, latestEditions } from './repo.ts';
import { standardSetting } from './setting.ts';
import { editionVersion, scopeHead, settingsThing, STANDARD } from './text.ts';

const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : 'not yet');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function nextLine(name: string, e: Edition | undefined): string | undefined {
  if (!e) return undefined;
  if (e.state === 'pending') return `edition ${e.version} waits for the steward: vantage_read ${STANDARD}/${name}@${e.version}, then vantage_tool vantage_standard_publish`;
  return `edition ${e.version} refused by the machine gate: ${e.problems[0] ?? 'no reason kept'}${e.problems.length > 1 ? ` (and ${e.problems.length - 1} more)` : ''}`;
}

export async function standardsOutline(ctx: AppContext, p: Principal): Promise<string[]> {
  const s = await standardSetting(ctx.db, p.orgId);
  const settings = await settingsThing(ctx, p);
  const tree = await listScopes(ctx.db, p.orgId, (await scopeSetting(ctx.db, p.orgId)).source);
  const { published, next } = await latestEditions(ctx.db, p.orgId);
  const lines = [
    `${STANDARD}: the estate's settings  version ${settings.version}  ${settings.text.length.toLocaleString('en-US')} chars`,
    `  bindings ${s.bindings.join(', ')}; binds ${s.binds.join(', ')}; steward gate ${s.steward_gate ? 'on' : 'off'}; ${plural(s.withhold.length, 'withheld word')}`,
    '',
    "each scope's standard (vantage_read standard/<scope>):",
  ];
  const depth = new Map<string, number>();
  for (const x of [{ id: '', name: 'The whole estate', parent: undefined as string | undefined }, ...tree]) {
    const d = x.id === '' ? 0 : (depth.get(x.parent ?? '') ?? 0) + 1;
    depth.set(x.id, d);
    const name = scopeName(x.id);
    const e = published.get(x.id);
    const own = s.packs[name]?.length ?? 0;
    const now = e ? `edition ${e.version}, ${plural(e.body.lines.length, 'line')}, ${plural(e.body.packs.length, 'pack')}, published ${day(e.publishedAt)}` : 'no edition yet';
    const waits = nextLine(name, next.get(x.id));
    lines.push(`${'  '.repeat(d + 1)}${name}  ${x.name}  ${now}${own ? `; adopts ${plural(own, 'pack')}` : ''}${waits ? `; ${waits}` : ''}`);
  }
  lines.push(`parts: ${STANDARD}#bindings, #binds, #steward_gate, #withhold, #packs.<scope>; a scope's packs are its steward's`);
  return lines;
}

export async function standardOutline(ctx: AppContext, p: Principal, name: string): Promise<string[]> {
  const key = scopeKey(name);
  const head = await scopeHead(ctx, p, name);
  const e = await editionOf(ctx.db, p.orgId, key);
  if (!head && !e) throw new HttpError(404, `no scope ${name}; vantage_outline scopes lists them, and ${STANDARD}/${ESTATE} is the whole estate`);
  const title = head?.title ?? e!.manifest.name;
  const out = [`${STANDARD}/${name}: ${title}${head?.steward ? `, steward ${head.steward}` : ''}  version ${editionVersion(e)}`];
  if (e) {
    const areas = new Map<string, number>();
    for (const l of e.body.lines) areas.set(l.area, (areas.get(l.area) ?? 0) + 1);
    out.push(`  edition ${e.version} ${e.hash}, published ${day(e.publishedAt)}${e.manifest.builds_on.length ? `, built on ${e.manifest.builds_on.map((x) => `${x.scope}@${x.version}`).join(', ')}` : ''}`);
    out.push(`  areas: ${[...areas].map(([a, n]) => `${a} (${n})`).join(', ') || 'none'}; ${plural(e.body.packs.length, 'pack')}; ${plural(e.body.exceptions.length, 'exception')}; ${plural(e.body.pages.length, 'procedure page')}`);
  } else out.push('  no edition yet: no line reaches it');
  const all = await editionsOf(ctx.db, p.orgId, key);
  const waiting = all.find((x) => x.state !== 'published');
  if (waiting) out.push(`  ${waiting.state === 'pending' ? `edition ${waiting.version} waits for the steward: vantage_read ${STANDARD}/${name}@${waiting.version}, then vantage_tool vantage_standard_publish` : `edition ${waiting.version} refused by the machine gate: ${waiting.problems.join('; ')}`}`);
  const history = all.filter((x) => x.state === 'published');
  if (history.length) out.push('editions:', ...history.map((x) => `  ${STANDARD}/${name}@${x.version}  ${day(x.published_at)}  ${plural(x.lines, 'line')}, ${plural(x.changes, 'change')}${x.published_by ? `  by ${x.published_by}` : ''}`));
  out.push(`parts: ${STANDARD}/${name}#<area>, #packs, #procedures, #changes-from-edition-<n>`);
  return out;
}
