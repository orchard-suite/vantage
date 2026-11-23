/**
 * The admin page's Revisions tab: the organization's tokens month by month
 * against its monthly cap, each person's use in the month picked (split by
 * model and by kind, revisions from comments or diagrams drawn from words,
 * with cached input apart), a CSV of it, the default limits, and any
 * person's own limits or block. Forms and buttons call the admin API the
 * way the rest of the page does.
 */
import type { Config } from '../config.ts';
import type { OrgLimits, PersonLimits } from '../revise/limits.ts';
import { addMonths, parseMonth, type ModelUse, type MonthTotal, type PersonUse } from '../revise/usage.ts';
import { escapeHtml } from './html.ts';
import { avatar } from './frame.ts';
import { plural, when } from './library.ts';
import { adminPage, type AdminFrame } from './admin-kit.ts';

export interface RevisionsModel {
  /** YYYY-MM. */
  readonly month: string;
  readonly people: readonly PersonUse[];
  /** The 12 months up to and including `month`, oldest first. */
  readonly months: readonly MonthTotal[];
  readonly limits: OrgLimits;
  readonly own: readonly PersonLimits[];
  /** Everyone who may be given limits of their own. */
  readonly everyone: readonly { readonly id: string; readonly name: string }[];
}

export function tokens(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(key: string, short = false): string {
  const d = parseMonth(key)!;
  const name = MONTHS[d.getUTCMonth()]!;
  return short ? name.slice(0, 3) : `${name} ${d.getUTCFullYear()}`;
}

/** A number field for a cap: empty is no cap, or the default where `fallback` says what that is. */
function capField(name: string, label: string, value: number | null | undefined, fallback: string): string {
  return `<label class="cap"><span>${label}</span><input class="field" type="number" min="1" step="1" name="${name}" value="${value ?? ''}" placeholder="${escapeHtml(fallback)}"></label>`;
}

/** Bars of the organization's tokens per month, the picked month in the accent, the monthly cap as a dashed line. */
function chart(r: RevisionsModel): string {
  const W = 720;
  const H = 160;
  const top = 14;
  const base = H - 22;
  const cap = r.limits.orgMonthly;
  const max = Math.max(1, cap ?? 0, ...r.months.map((m) => m.tokens));
  const step = W / r.months.length;
  const y = (v: number): number => base - (v / max) * (base - top);
  const bars = r.months.map((m, i) => {
    const x = i * step + step * 0.18;
    const h = base - y(m.tokens);
    const tip = `${monthName(m.month)}: ${tokens(m.tokens)} tokens, ${plural(m.revisions, 'revision')}, ${plural(m.generations, 'diagram')} drawn, ${plural(m.people, 'person', 'people')}`;
    return `<g><title>${escapeHtml(tip)}</title><rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(step * 0.64).toFixed(1)}" height="${Math.max(h, m.tokens ? 1 : 0).toFixed(1)}" rx="3" class="${m.month === r.month ? 'now' : ''}"/><text x="${(i * step + step / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${monthName(m.month, true)}</text></g>`;
  });
  const line = cap === null ? '' : `<line x1="0" x2="${W}" y1="${y(cap).toFixed(1)}" y2="${y(cap).toFixed(1)}" class="cap"/><text x="${W}" y="${(y(cap) - 4).toFixed(1)}" text-anchor="end" class="cap">Monthly limit ${tokens(cap)}</text>`;
  return `<svg class="use-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokens per month for the last 12 months">${bars.join('')}${line}</svg>`;
}

/** One model and kind of a person's use, as the row lists it. */
function useLine(m: ModelUse): string {
  return `${escapeHtml(m.model)} <span class="pill">${m.kind === 'generate' ? 'drawn' : 'revise'}</span> ${tokens(m.total)}`;
}

function personRow(p: PersonUse | undefined, own: PersonLimits | undefined, id: string, name: string, now: number): string {
  const url = `/api/v1/admin/ai-limits/users/${encodeURIComponent(id)}`;
  const what = p
    ? `${plural(p.revisions, 'revision')}, ${p.accepted} accepted, ${plural(p.generations, 'diagram')} drawn, last ${when(p.lastAt, now)}<br>${p.models.map(useLine).join(' · ')}`
    : 'Nothing this month';
  const pills = [p ? `<span class="pill">${tokens(p.total)} tokens</span>` : '', p?.cacheRead || p?.cacheWrite ? `<span class="pill">${tokens(p.cacheRead + p.cacheWrite)} cached</span>` : '', own?.blocked ? '<span class="pill bad">Blocked</span>' : own ? '<span class="pill info">Own limits</span>' : ''].join('');
  const form = `<details class="own"><summary class="btn sm">Limits</summary><form data-act="PUT" data-url="${escapeHtml(url)}">${capField('daily', 'Per day', own?.daily, 'Default')}${capField('monthly', 'Per month', own?.monthly, 'Default')}<label class="cap check"><input type="checkbox" name="blocked"${own?.blocked ? ' checked' : ''}><span>Block</span></label><button class="btn sm primary">Save</button>${own ? `<button class="btn sm ghost" type="button" data-act="DELETE" data-url="${escapeHtml(url)}">Use defaults</button>` : ''}</form></details>`;
  return `<div class="mem-row admin-pub">${avatar(name)}<div class="pub-what"><b>${escapeHtml(name)}</b><span>${what}</span></div>${pills}<div class="admin-acts">${form}</div></div>`;
}

/** The Revisions page at /admin/revisions. */
export function adminRevisionsHtml(f: AdminFrame, policy: Pick<Config, 'AI_BASE_URL'>, r: RevisionsModel | undefined): string {
  return adminPage(f, 'AI spend · Admin', [['AI spend', '']], revisionsBody(policy, r, f.now ?? Date.now()));
}

function revisionsBody(policy: Pick<Config, 'AI_BASE_URL'>, r: RevisionsModel | undefined, now: number): string {
  const intro = `<div class="tab-intro"><h1 id="t-head">AI spend</h1><p>${policy.AI_BASE_URL ? "Authors may ask the organization's model to carry out open comments on a document, or to draw a new diagram from a description. Everyone shares one key, so the hub counts each person's tokens and holds them to the limits below. Months and days are UTC." : 'Revisions from comments and diagrams drawn from words are off on this hub. The deployment turns them on with a model API and a key.'}</p></div>`;
  if (!r) return `<section aria-labelledby="t-head">${intro}</section>`;
  const month = parseMonth(r.month)!;
  const link = (d: Date): string => `/admin/revisions?month=${d.toISOString().slice(0, 7)}`;
  const nextMonth = addMonths(month, 1);
  const nav = `<div class="use-nav"><a class="btn sm ghost" href="${link(addMonths(month, -1))}">Earlier</a><b>${monthName(r.month)}</b>${nextMonth.getTime() <= now ? `<a class="btn sm ghost" href="${link(nextMonth)}">Later</a>` : ''}<a class="btn sm" href="/api/v1/admin/ai-usage.csv?month=${r.month}" download>Download CSV</a></div>`;
  const total = r.months.find((m) => m.month === r.month)?.tokens ?? 0;
  const l = r.limits;
  const limits = `<h3>Limits</h3><p class="f-hint">Empty is no limit. A person's own limits, below, replace the defaults for them.</p><form class="use-limits" data-act="PUT" data-url="/api/v1/admin/ai-limits">${capField('daily', 'Each person per day', l.daily, 'No limit')}${capField('monthly', 'Each person per month', l.monthly, 'No limit')}${capField('orgMonthly', 'Whole organization per month', l.orgMonthly, 'No limit')}<button class="btn sm primary">Save limits</button></form>`;
  const ownBy = new Map(r.own.map((o) => [o.userId, o]));
  const shown = new Set(r.people.map((p) => p.userId));
  const rows = [...r.people.map((p) => personRow(p, ownBy.get(p.userId), p.userId, p.name, now)), ...r.own.filter((o) => !shown.has(o.userId)).map((o) => personRow(undefined, o, o.userId, o.name, now))];
  const others = r.everyone.filter((e) => !shown.has(e.id) && !ownBy.has(e.id));
  const add = others.length ? `<form class="use-add" data-act="PUT" data-url="/api/v1/admin/ai-limits/users/:user"><select class="field" name="user" aria-label="Person">${others.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')}</select>${capField('daily', 'Per day', undefined, 'Default')}${capField('monthly', 'Per month', undefined, 'Default')}<label class="cap check"><input type="checkbox" name="blocked"><span>Block</span></label><button class="btn sm">Set limits for this person</button></form>` : '';
  const people = rows.length ? `<div class="rows">${rows.join('')}</div>` : `<p class="none-here"><b>No model use in ${monthName(r.month)}.</b></p>`;
  return `<section aria-labelledby="t-head">${intro}${nav}<p class="f-hint">${tokens(total)} tokens this month${l.orgMonthly !== null ? ` of the organization's ${tokens(l.orgMonthly)}` : ''}.</p>${chart(r)}${limits}<h3>People</h3>${people}${add}</section>`;
}
