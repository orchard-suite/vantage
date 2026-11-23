/**
 * What crosses the hub's edge, as the admin console lists it: connectors that
 * bring data into a workspace and publications that send its pictures out.
 * Each row says where it is set up, what it reads or where it writes, how its
 * last run went, and whether it may run, with approve and stop beside it.
 */
import type { Config } from '../config.ts';
import type { Approval, PublicationRow } from '../publishing/repo.ts';
import type { SourceRow } from '../sources/repo.ts';
import { escapeHtml } from './html.ts';
import { familyFor, initials } from './frame.ts';
import { plural, when } from './library.ts';
import { act } from './admin-kit.ts';

export interface AdminConnector {
  readonly row: SourceRow;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly createdByName: string | null;
  readonly blocked: string | undefined;
  /** Its workspace is disabled: nothing in it runs, so there is nothing to approve. */
  readonly workspaceOff: boolean;
}

export interface AdminPublication {
  readonly row: PublicationRow;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly documentName: string;
  readonly createdByName: string | null;
  readonly blocked: string | undefined;
  readonly workspaceOff: boolean;
}

export type FlowPolicy = Pick<Config, 'PUBLICATION_APPROVAL' | 'CONNECTOR_APPROVAL'>;

const STATE: Record<Approval, [string, string]> = {
  pending: ['Waits for you', 'warn'],
  approved: ['Approved', 'ok'],
  stopped: ['Stopped', 'bad'],
};

function triggerText(t: PublicationRow['trigger']): string {
  if (t.kind === 'on-save') return 'on every new version';
  if (t.kind === 'schedule') return `on a schedule, ${t.cron}`;
  return 'when an author asks';
}

/** A setting's value as text: lists joined, objects as JSON. Settings name secrets and never hold them. */
function value(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ');
  return JSON.stringify(v);
}

function settings(config: Record<string, unknown>): string {
  const lines = Object.entries(config).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd><code>${escapeHtml(value(v))}</code></dd>`);
  return lines.length ? `<details class="flow-set"><summary>Settings</summary><dl>${lines.join('')}</dl></details>` : '';
}

/** Names a person reads before ids: an Azure connector's subscription names, else the settings' first values. */
function reads(s: SourceRow): string {
  const names = s.config['subscriptionNames'];
  if (names && typeof names === 'object') return Object.values(names as Record<string, unknown>).map(String).join(', ');
  for (const key of ['subscriptions', 'url', 'baseUrl', 'endpoint', 'hub', 'cluster', 'path']) if (s.config[key] !== undefined) return value(s.config[key]);
  return '';
}

function pill(approval: Approval, required: boolean, blocked: string | undefined, free: string): string {
  const [state, tone] = approval === 'pending' && !required ? [free, ''] : STATE[approval];
  return `<span class="pill ${tone}"${blocked ? ` title="${escapeHtml(blocked)}"` : ''}>${state}</span>`;
}

function acts(base: string, approval: Approval, again: string, off: boolean): string {
  if (off) return '<span class="pill bad">Workspace disabled</span>';
  return [approval !== 'approved' ? act(approval === 'stopped' ? again : 'Approve', 'POST', `${base}/approve`, undefined, 'primary') : '', approval !== 'stopped' ? act('Stop', 'POST', `${base}/stop`) : ''].join('');
}

/** One connector; `where` names its workspace when the list spans several. */
export function connectorRow(c: AdminConnector, policy: FlowPolicy, now: number, where = true): string {
  const s = c.row;
  const read = reads(s);
  const counts = s.last_run?.counts;
  const last = s.last_run ? `${s.last_run.status === 'failed' ? '<b class="bad-ink">Failed</b>' : 'Sent'} ${when(new Date(s.last_run.at), now).toLowerCase()}${counts ? `: ${plural(counts.entities, 'thing')}, ${plural(counts.relations, 'link')}` : ''}` : 'Never sent';
  const into = where ? ` into <a class="link" href="/admin/w/${encodeURIComponent(c.workspaceSlug)}">${escapeHtml(c.workspaceName)}</a>` : '';
  const who = c.createdByName ? `added by ${escapeHtml(c.createdByName)}` : 'added by someone no longer here';
  return `<li class="flow"><span class="src-badge fam-${familyFor(s.connector)}" aria-hidden="true">${escapeHtml(initials(s.connector).slice(0, 3))}</span><div class="flow-what"><b>${escapeHtml(s.name)}</b><span><code>${escapeHtml(s.connector)}</code>${into}</span>${read ? `<span>Reads ${escapeHtml(read)}</span>` : ''}<span>${last}. Signs in as <code>${escapeHtml(s.client_id)}</code>, ${who}.${s.enabled ? '' : ' Paused by its authors.'}</span>${settings(s.config)}</div><div class="flow-side">${pill(s.approval, policy.CONNECTOR_APPROVAL, c.blocked, 'Sends freely')}<div class="flow-acts">${acts(`/api/v1/admin/connectors/${encodeURIComponent(s.id)}`, s.approval, 'Let it send', c.workspaceOff)}</div></div></li>`;
}

export function publicationRow(p: AdminPublication, policy: FlowPolicy, now: number, where = true): string {
  const r = p.row;
  const last = r.last_run ? `${r.last_run.status === 'ok' ? 'Ran' : '<b class="bad-ink">Failed</b>'} ${when(new Date(r.last_run.at), now).toLowerCase()}, ${plural(r.last_run.written, 'file')} written` : 'Never ran';
  const from = where ? ` from <a class="link" href="/admin/w/${encodeURIComponent(p.workspaceSlug)}">${escapeHtml(p.workspaceName)}</a>` : '';
  const who = p.createdByName ? `set up by ${escapeHtml(p.createdByName)}` : 'set up before the hub kept who';
  return `<li class="flow"><span class="src-badge fam-${familyFor(r.target)}" aria-hidden="true">${escapeHtml(initials(r.target).slice(0, 3))}</span><div class="flow-what"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(p.documentName)}${from} as ${escapeHtml(r.formats.join(', ').toUpperCase())} to <code>${escapeHtml(r.target)}</code>, for ${escapeHtml(r.audience)}</span><span>Runs ${triggerText(r.trigger)}. ${last}, ${who}.${r.enabled ? '' : ' Paused by its authors.'}</span>${settings(r.config)}</div><div class="flow-side">${pill(r.approval, policy.PUBLICATION_APPROVAL, p.blocked, 'Runs freely')}<div class="flow-acts">${acts(`/api/v1/admin/publications/${encodeURIComponent(r.id)}`, r.approval, 'Let it run', p.workspaceOff)}</div></div></li>`;
}

/** Connectors in and publications out, side by side, each with its own empty line. */
export function flows(conns: readonly AdminConnector[], pubs: readonly AdminPublication[], policy: FlowPolicy, now: number, where: boolean, empty: { readonly in: string; readonly out: string }): string {
  const list = (rows: readonly string[], none: string): string => (rows.length ? `<ul class="flows">${rows.join('')}</ul>` : `<p class="none-line">${none}</p>`);
  const waitIn = conns.filter((c) => c.row.approval === 'pending' && !c.workspaceOff).length;
  const waitOut = pubs.filter((p) => p.row.approval === 'pending' && !p.workspaceOff).length;
  const count = (n: number, waiting: number, required: boolean): string => `<span class="tally">${n}</span>${required && waiting ? ` <span class="pill warn">${waiting} waiting</span>` : ''}`;
  return `<div class="flow-cols"><section aria-labelledby="f-in"><h2 class="sec" id="f-in">Coming in ${count(conns.length, waitIn, policy.CONNECTOR_APPROVAL)}</h2><p class="sec-note">Connectors read a system outside the hub and send what they find to one workspace. ${policy.CONNECTOR_APPROVAL ? 'A new or changed one sends only once you approve it.' : 'They send without approval here; you can stop any of them.'}</p>${list(conns.map((c) => connectorRow(c, policy, now, where)), empty.in)}</section><section aria-labelledby="f-out"><h2 class="sec" id="f-out">Going out ${count(pubs.length, waitOut, policy.PUBLICATION_APPROVAL)}</h2><p class="sec-note">Publications send a diagram's pictures to a place outside the hub. ${policy.PUBLICATION_APPROVAL ? 'A new or changed one runs only once you approve it.' : 'They run without approval here; you can stop any of them.'}</p>${list(pubs.map((p) => publicationRow(p, policy, now, where)), empty.out)}</section></div>`;
}
