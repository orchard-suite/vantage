/**
 * The generic HTTP connector: one URL, headers whose values may reference
 * secrets, an optional JSON body, a JSONPath or GraphQL query that selects
 * the items, and a template per entity field. For a source nobody wrote a
 * connector for yet.
 */
import { JSONPath } from 'jsonpath-plus';
import { z } from 'zod';
import type { Batch, BatchEntity, BatchRelation, FactValue } from '../../batch.ts';
import { RELATION_KINDS } from '../../batch.ts';
import { fetchJson, type Connector, type ConnectorContext, type FetchInit } from '../../connector.ts';
import { getPath, placeholders, render, renderStrict } from '../../template.ts';

const template = z.string().min(1).describe('A {{path}} template over the item');

export const HttpRelationMappingSchema = z
  .object({
    items: z.string().optional().describe('JSONPath, relative to the item, selecting one sub item per relation; default the item itself'),
    from: template.describe('Template over { item, rel }'),
    to: template.describe('Template over { item, rel }'),
    label: z.string().optional(),
    kind: z.enum(RELATION_KINDS).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export const HttpEntityMappingSchema = z
  .object({
    id: template,
    type: template,
    name: template,
    parent: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
    tags: z.array(z.string()).optional().describe('Templates; an empty rendering is dropped'),
    facts: z.record(z.string(), z.string()).optional().describe('Display label to template or path'),
  })
  .strict();

export const HttpConfigSchema = z
  .object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST']).optional().describe('Default GET, or POST when a body or GraphQL query is given'),
    headers: z.record(z.string(), z.string()).default({}).describe('Values are templates; {{secret:ref}} resolves through the secret store'),
    body: z.unknown().optional().describe('JSON body sent with a POST'),
    jsonPath: z.string().optional().describe('JSONPath selecting the items from the response; default the response itself'),
    graphql: z.object({ query: z.string().min(1), variables: z.record(z.string(), z.unknown()).optional(), path: z.string().default('$.data') }).strict().optional(),
    paging: z.object({ next: z.string().min(1).describe('JSONPath to the next page URL in the response'), maxPages: z.number().int().min(1).default(100) }).strict().optional(),
    entity: HttpEntityMappingSchema,
    relations: z.array(HttpRelationMappingSchema).default([]),
  })
  .strict();

export type HttpConfig = z.output<typeof HttpConfigSchema>;

const SECRET_PREFIX = 'secret:';

/** Replaces `{{secret:ref}}` placeholders in header values with resolved secrets. */
export async function resolveHeaders(headers: Record<string, string>, secrets: (ref: string) => Promise<string>): Promise<Record<string, string>> {
  const refs = new Set<string>();
  for (const v of Object.values(headers)) for (const p of placeholders(v)) if (p.startsWith(SECRET_PREFIX)) refs.add(p.slice(SECRET_PREFIX.length));
  const resolved: Record<string, string> = {};
  for (const ref of refs) resolved[ref] = await secrets(ref);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v.replace(/\{\{\s*secret:([^{}]+?)\s*\}\}/g, (_m, ref: string) => resolved[ref.trim()] ?? '');
  }
  return out;
}

export function select(json: unknown, path: string | undefined): unknown[] {
  if (path === undefined) return Array.isArray(json) ? json : [json];
  const found = JSONPath({ path, json: json as never, wrap: true }) as unknown;
  const list = Array.isArray(found) ? found : [];
  return list.length === 1 && Array.isArray(list[0]) && !path.includes('[*]') && !path.includes('..') ? (list[0] as unknown[]) : list;
}

function factsOf(item: unknown, map: Record<string, string> | undefined): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  for (const [label, t] of Object.entries(map ?? {})) {
    const names = placeholders(t);
    const raw = names.length === 0 ? getPath(item, t) : names.length === 1 && t.trim() === `{{${names[0]}}}` ? getPath(item, names[0] ?? '') : render(t, item).text;
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') out[label] = raw;
    else out[label] = JSON.parse(JSON.stringify(raw)) as FactValue;
  }
  return out;
}

export interface HttpConversion {
  readonly entities: BatchEntity[];
  readonly relations: BatchRelation[];
  readonly skipped: number;
}

export function convertItems(items: readonly unknown[], config: HttpConfig, warn: (message: string, fields: Record<string, unknown>) => void): HttpConversion {
  const entities: BatchEntity[] = [];
  const relations: BatchRelation[] = [];
  let skipped = 0;
  const m = config.entity;
  const optional = (t: string | undefined, item: unknown): string | undefined => {
    if (t === undefined) return undefined;
    const r = render(t, item).text.trim();
    return r === '' ? undefined : r;
  };
  items.forEach((item, index) => {
    const id = renderStrict(m.id, item);
    const type = renderStrict(m.type, item);
    const name = optional(m.name, item);
    if (id === undefined || id === '' || type === undefined || type === '' || name === undefined) {
      skipped++;
      warn('http item skipped', { index, id, type, name });
      return;
    }
    const parent = optional(m.parent, item);
    const subtitle = optional(m.subtitle, item);
    const description = optional(m.description, item);
    const url = optional(m.url, item);
    const tags = (m.tags ?? []).map((t) => render(t, item).text.trim()).filter((t) => t !== '');
    entities.push({
      id,
      type,
      name,
      facts: factsOf(item, m.facts),
      tags,
      ...(parent !== undefined ? { parent } : {}),
      ...(subtitle !== undefined ? { subtitle } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(url !== undefined ? { url } : {}),
    });
    for (const rm of config.relations) {
      const subs = rm.items !== undefined ? select(item, rm.items) : [item];
      for (const rel of subs) {
        const ctx = { item, rel };
        const from = renderStrict(rm.from, ctx);
        const to = renderStrict(rm.to, ctx);
        if (from === undefined || to === undefined || from === '' || to === '') continue;
        relations.push({ from, to, ...(rm.label !== undefined ? { label: rm.label } : {}), ...(rm.kind !== undefined ? { kind: rm.kind } : {}), ...(rm.tags !== undefined ? { tags: rm.tags } : {}) });
      }
    }
  });
  return { entities, relations, skipped };
}

export const httpConnector: Connector<HttpConfig> = {
  id: 'http',
  configSchema: HttpConfigSchema,
  async *discover(ctx: ConnectorContext<HttpConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const headers = await resolveHeaders(config.headers, ctx.secrets);
    const graphql = config.graphql;
    const body = graphql ? { query: graphql.query, ...(graphql.variables !== undefined ? { variables: graphql.variables } : {}) } : config.body;
    const method = config.method ?? (body !== undefined ? 'POST' : 'GET');
    const path = graphql ? graphql.path : config.jsonPath;
    let url: string | undefined = config.url;
    let page = 0;
    const maxPages = config.paging?.maxPages ?? 1;
    log.info('http discover start', { url, method, mode: graphql ? 'graphql' : 'json', path: path ?? '$' });
    while (url !== undefined && page < maxPages) {
      const init: FetchInit = {
        method,
        headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      };
      const json: unknown = await fetchJson(ctx, url, init);
      page++;
      const items = select(json, path);
      const out = convertItems(items, config, (m, f) => log.warn(m, { url, ...f }));
      log.debug('http page', { url, page, items: items.length, entities: out.entities.length, relations: out.relations.length, skipped: out.skipped });
      yield { source: 'http', observed: ctx.now().toISOString(), partial: true, entities: out.entities, relations: out.relations };
      const next = config.paging ? select(json, config.paging.next)[0] : undefined;
      url = typeof next === 'string' && next !== '' ? next : undefined;
    }
    log.info('http discover end', { pages: page });
  },
};
