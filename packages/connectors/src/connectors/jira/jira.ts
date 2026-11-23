/**
 * Reads open Jira Cloud issues (REST v3, the enhanced JQL search) and
 * reports each as an open item. Every mapping runs one JQL query and says
 * how an issue names the thing it is about (a label with a prefix, or a
 * field) and where that name points (an observed key, or a fact entities
 * carry). The connector reports no entities of its own: its items land on
 * the boxes other connectors observe.
 */
import { z } from 'zod';
import { OPEN_ITEM_KINDS, type ItemSeverity } from '@vantage/model';
import type { Batch, BatchItem, ItemTarget } from '../../batch.ts';
import { fetchJson, type Connector, type ConnectorContext } from '../../connector.ts';
import { getPath } from '../../template.ts';

const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const JiraMappingSchema = z
  .object({
    jql: z.string().min(1).describe('The issues this mapping reads, for example project = OPS AND statusCategory != Done'),
    label: z.string().min(1).optional().describe('Label prefix; an issue labelled prefix + name is about that name, for example svc: in svc:relay'),
    field: z.string().min(1).optional().describe('Dotted path into the issue fields whose value is the name, for example components or customfield_10042; lists give one name per entry'),
    key: z.string().min(1).optional().describe('Observed key template the name points at, for example catalog:k8s-deployment:relay/{value}'),
    fact: z.string().min(1).optional().describe('Fact name; the item lands on every bound entity whose fact carries the name'),
    kind: z.enum(OPEN_ITEM_KINDS).default('issue'),
  })
  .strict()
  .refine((m) => (m.label === undefined) !== (m.field === undefined), { message: 'a mapping names the thing by exactly one of label and field' })
  .refine((m) => (m.key === undefined) !== (m.fact === undefined), { message: 'a mapping points by exactly one of key and fact' });

export const JiraConfigSchema = z
  .object({
    url: z.string().url().describe('Site base URL, for example https://example.atlassian.net'),
    email: z.string().min(1).optional().describe('Account the API token belongs to; with it the token goes as basic auth, without it as a bearer token'),
    token: z.string().min(1).describe('Secret reference for the API token'),
    pageSize: z.number().int().min(1).max(100).default(100),
    severities: z.record(z.string(), SeveritySchema).default({}).describe('Priority name to severity, on top of the usual names (Highest, High, Medium, Low, Lowest)'),
    mappings: z.array(JiraMappingSchema).min(1),
  })
  .strict();

export type JiraConfig = z.output<typeof JiraConfigSchema>;
export type JiraMapping = z.output<typeof JiraMappingSchema>;

interface JiraIssue {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string } | null;
    updated?: string;
    labels?: string[];
  };
}

interface SearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

const PRIORITIES: Readonly<Record<string, ItemSeverity>> = {
  blocker: 'critical',
  highest: 'critical',
  critical: 'critical',
  high: 'high',
  major: 'high',
  medium: 'medium',
  low: 'low',
  minor: 'low',
  lowest: 'info',
  trivial: 'info',
};

function severityOf(config: JiraConfig, priority: string | undefined): ItemSeverity | undefined {
  if (priority === undefined) return undefined;
  const own = Object.entries(config.severities).find(([name]) => name.toLowerCase() === priority.toLowerCase());
  return own?.[1] ?? PRIORITIES[priority.toLowerCase()];
}

/** The names a field value holds: a string or number, or the name, value, or key of an option, or a list of these. */
function namesIn(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(namesIn);
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  if (typeof v === 'number') return [String(v)];
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['name', 'value', 'key']) if (typeof o[k] === 'string') return namesIn(o[k]);
  }
  return [];
}

/** What an issue is about, by the mapping's label prefix or field. */
export function issueNames(m: JiraMapping, issue: JiraIssue): string[] {
  const names = m.label !== undefined
    ? (issue.fields.labels ?? []).filter((l) => l.startsWith(m.label!) && l.length > m.label!.length).map((l) => l.slice(m.label!.length))
    : namesIn(getPath(issue.fields, m.field!));
  return [...new Set(names)];
}

function targetOf(m: JiraMapping, name: string): ItemTarget {
  return m.key !== undefined ? { key: m.key.replaceAll('{value}', name) } : { fact: m.fact!, value: name };
}

function issueItems(config: JiraConfig, m: JiraMapping, issue: JiraIssue): BatchItem[] {
  const f = issue.fields;
  const severity = severityOf(config, f.priority?.name);
  const updated = f.updated !== undefined && !Number.isNaN(Date.parse(f.updated)) ? new Date(f.updated).toISOString() : undefined;
  return issueNames(m, issue).map((name) => ({
    id: issue.key,
    kind: m.kind,
    title: `${issue.key} ${f.summary ?? ''}`.trim(),
    url: `${config.url.replace(/\/$/, '')}/browse/${encodeURIComponent(issue.key)}`,
    ...(severity !== undefined ? { severity } : {}),
    ...(f.status?.name !== undefined ? { status: f.status.name } : {}),
    ...(updated !== undefined ? { updated } : {}),
    target: targetOf(m, name),
  }));
}

export const jiraConnector: Connector<JiraConfig> = {
  id: 'jira',
  configSchema: JiraConfigSchema,
  async *discover(ctx: ConnectorContext<JiraConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const base = config.url.replace(/\/$/, '');
    const token = await ctx.secrets(config.token);
    const authorization = config.email !== undefined ? `Basic ${btoa(`${config.email}:${token}`)}` : `Bearer ${token}`;
    const headers = { authorization, accept: 'application/json', 'content-type': 'application/json' };
    for (const [index, m] of config.mappings.entries()) {
      const fields = ['summary', 'status', 'priority', 'updated', 'labels', ...(m.field !== undefined ? [m.field.split('.')[0]!] : [])];
      const items: BatchItem[] = [];
      let nextPageToken: string | undefined;
      let issues = 0;
      let unnamed = 0;
      let pages = 0;
      do {
        const body = { jql: m.jql, fields: [...new Set(fields)], maxResults: config.pageSize, ...(nextPageToken !== undefined ? { nextPageToken } : {}) };
        const page = await fetchJson<SearchResponse>(ctx, `${base}/rest/api/3/search/jql`, { method: 'POST', headers, body: JSON.stringify(body) });
        pages++;
        for (const issue of page.issues) {
          const found = issueItems(config, m, issue);
          if (!found.length) unnamed++;
          items.push(...found);
        }
        issues += page.issues.length;
        log.debug('jira page', { mapping: index, page: pages, got: page.issues.length });
        nextPageToken = page.isLast === true ? undefined : page.nextPageToken;
      } while (nextPageToken !== undefined);
      if (unnamed) log.warn('jira issues name nothing', { mapping: index, issues: unnamed, by: m.label !== undefined ? `label ${m.label}` : `field ${m.field}` });
      log.info('jira mapping read', { mapping: index, pages, issues, items: items.length });
      yield { source: 'jira', observed: ctx.now().toISOString(), partial: true, entities: [], relations: [], items };
    }
  },
};
