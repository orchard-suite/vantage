/**
 * An existing roadmap comes in by path (VAN-3009): a Markdown
 * table, or bullets under Now, Next, and Later headings, become items of a
 * kind. A status column is never typed in: a row it says is done comes in
 * reported done, with a note saying so. Each row's key is made from the
 * kind and its title, so a second import of the same file changes nothing.
 */
import { createHash } from 'node:crypto';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { HttpError } from '../http.ts';
import { kindByPrefix } from './kinds.ts';
import { move, put } from './write.ts';

export interface Row {
  readonly title: string;
  readonly horizon?: string | undefined;
  readonly done: boolean;
  /** Every other column, kept in the body as `Column: value`. */
  readonly rest: readonly string[];
}

const HORIZONS: Record<string, string> = { now: 'now', current: 'now', 'this quarter': 'now', next: 'next', soon: 'next', later: 'later', future: 'later', someday: 'later' };
const horizonOf = (v: string): string | undefined => HORIZONS[v.trim().toLowerCase()];
const DONE = /^(done|shipped|complete[d]?|released|✅)$/i;

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** The rows a Markdown roadmap holds: its first table, or else its bullets under horizon headings. */
export function parseRoadmap(text: string): Row[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l, i) => /^\s*\|/.test(l) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? ''));
  if (start >= 0) {
    const head = cells(lines[start]!).map((h) => h.toLowerCase());
    const col = (...names: string[]): number => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const title = Math.max(0, col('outcome', 'title', 'item', 'name', 'what'));
    const horizon = col('horizon', 'when');
    const status = col('status', 'state');
    const out: Row[] = [];
    for (const line of lines.slice(start + 2)) {
      if (!/^\s*\|/.test(line)) break;
      const c = cells(line);
      if (!c[title]) continue;
      out.push({ title: c[title]!, horizon: horizon >= 0 ? horizonOf(c[horizon] ?? '') : undefined, done: status >= 0 && DONE.test(c[status] ?? ''), rest: head.flatMap((h, i) => (i === title || i === horizon || i === status || !c[i] ? [] : [`${cells(lines[start]!)[i]}: ${c[i]}`])) });
    }
    return out;
  }
  const out: Row[] = [];
  let horizon: string | undefined;
  for (const line of lines) {
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) {
      horizon = horizonOf(h[1]!);
      continue;
    }
    const b = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.+)$/.exec(line);
    if (b) out.push({ title: b[2]!.trim(), horizon, done: (b[1] ?? '').toLowerCase() === 'x', rest: [] });
  }
  return out;
}

const keyFor = (prefix: string, title: string, step: string): string => `import:${prefix}:${createHash('sha256').update(title).digest('hex').slice(0, 24)}:${step}`;

/** Makes an item of the kind for each row, or with dryRun says what it would make. One line per row. */
export async function importRoadmap(ctx: AppContext, p: Principal, prefix: string, text: string, dryRun: boolean): Promise<string[]> {
  const kind = await kindByPrefix(ctx.db, p.orgId, prefix);
  if (!kind) throw new HttpError(404, `no kind ${prefix}`);
  const rows = parseRoadmap(text);
  if (!rows.length) throw new HttpError(400, 'no roadmap found: give a Markdown table with an outcome column, or bullets under Now, Next, and Later headings');
  const horizon = kind.definition.labels.find((l) => l.name === 'horizon' && l.type === 'choice');
  const reported = kind.definition.states.find((s) => s.id === 'reported');
  const out: string[] = [];
  for (const r of rows) {
    const title = r.title.slice(0, 200);
    if (dryRun) {
      out.push(`would make ${kind.prefix} item: ${title}${r.horizon ? ` (${r.horizon})` : ''}${r.done ? ', reported done' : ''}`);
      continue;
    }
    const labels = horizon && r.horizon && horizon.choices?.includes(r.horizon) ? { horizon: r.horizon } : {};
    const body = r.rest.length ? r.rest.join('\n\n') : undefined;
    const made = await put(ctx, p, { kind: kind.prefix, title, labels, ...(body !== undefined && !kind.definition.owner ? { body } : {}) }, keyFor(kind.prefix, title, 'put'));
    let line = made.line;
    if (r.done && reported) {
      const moved = await move(ctx, p, made.key, { to: reported.id, note: 'imported as done from a roadmap file; no machine has read proof of it' }, keyFor(kind.prefix, title, 'done')).catch((err: unknown) => ({ line: `kept as it was: ${(err as Error).message}` }));
      line += `; ${moved.line}`;
    }
    out.push(line);
  }
  return out;
}
