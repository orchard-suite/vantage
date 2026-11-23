/**
 * Reads an Orrery hub over its machine surface: every blueprint, every
 * entity page by page, each with its outgoing relations. An arrow is drawn
 * only between entities the connector read, and each of those carries its
 * own outgoing relations, so incoming references would add nothing. The
 * blueprint becomes the type unless the config maps it; a named relation,
 * or the first of a list that has a target, becomes containment, and stays
 * a relation too, so a diagram can nest by another one. An edge blueprint
 * becomes arrows instead of boxes (`edges.ts`). Each box shows its fields
 * by the hub's titles and formats (`display.ts`), under a subtitle field
 * the config names or else the key. The config may keep only some fields
 * as facts per blueprint, and then only those are asked for. Each answer is
 * kept with the tag the hub named, and asked again with it: an answer
 * nothing moved is reused. A filter in the hub's own language, for every
 * blueprint or per blueprint, is sent with each page, so a workspace about
 * one program reads that program alone. Firing alerts the hub matched to an
 * entity arrive as that entity's open items. A box links to its entity's
 * page on the address the hub names for people (`/v1/whoami`), not on the
 * machine address the connector reads.
 */
import { z } from 'zod';
import type { ItemSeverity } from '@vantage/model';
import type { Batch, BatchEntity, BatchRelation, FactValue, OpenItem } from '../../batch.ts';
import { FactValueSchema } from '../../batch.ts';
import { fetchJson, fetchJsonTagged, HttpError, type Connector, type ConnectorContext } from '../../connector.ts';
import { displayOf, valueText, type OrreryBlueprintDef, type OrreryFieldDef } from './display.ts';
import { foldEdges, OrreryEdgeSchema, type OrreryEdge } from './edges.ts';
import { orreryEntityId, visibleRefs, type OrreryEntity, type OrreryRef } from './entity.ts';

export { orreryEntityId } from './entity.ts';

/** A filter in the hub's own language (field, relation, and and/or/not leaves); the hub checks it, so it is passed through as written. */
const OrreryFilter = z.record(z.string(), z.unknown());

export const OrreryConfigSchema = z
  .object({
    url: z.string().url().describe('Hub base URL'),
    token: z.string().min(1).describe('Secret reference for the machine bearer token'),
    blueprints: z.array(z.string()).optional().describe('Blueprints to read; default every blueprint the token sees'),
    types: z.record(z.string(), z.string()).default({}).describe('Blueprint id to entity type; default the blueprint id'),
    parentRelation: z
      .union([z.string(), z.record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))])
      .optional()
      .describe('Relation name that is containment, for every blueprint or per blueprint; per blueprint, a list is tried in order and the first relation with a target wins'),
    pageSize: z.number().int().min(1).max(2000).default(200),
    relationKinds: z.record(z.string(), z.enum(['sync', 'async', 'data', 'deploy', 'auth', 'observe', 'manage'])).default({}).describe('Relation name to arrow kind'),
    facts: z.record(z.string(), z.array(z.string())).default({}).describe('Blueprint id to the fields kept as facts, in order, and the only fields asked of the hub; a blueprint not listed keeps, and asks for, every field'),
    filter: OrreryFilter.optional().describe('Orrery filter every blueprint is read with, such as {"relation":"program","target":"program:42"}; the hub reads what it matches and nothing else'),
    filters: z.record(z.string(), OrreryFilter).default({}).describe('Blueprint id to the Orrery filter it is read with, instead of filter'),
    alerts: z.boolean().default(true).describe('Read firing alerts (/v1/alerts) and report each as an open item on the entity it is attached to'),
    subtitle: z.record(z.string(), z.string()).default({}).describe('Blueprint id to the field shown under the name, such as app_name or host; a blueprint not listed shows its key'),
    edges: z
      .record(z.string(), OrreryEdgeSchema)
      .default({})
      .describe('Blueprint id to how its records become arrows instead of boxes, such as { sw_connection: { from: [app], to: [to_database], label: kind } }; its facts are the fields the arrow description lists'),
  })
  .strict();

export type OrreryConfig = z.output<typeof OrreryConfigSchema>;

interface EntitiesResponse {
  entities: OrreryEntity[];
  total: number;
  limit: number;
  offset: number;
}

interface OrreryAlert {
  fingerprint: string;
  status: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  entity: Pick<OrreryRef, 'blueprint' | 'key'> | null;
  updatedAt: string;
}

interface AlertsResponse {
  alerts: OrreryAlert[];
}

interface WhoAmIResponse {
  web?: string;
}

interface BlueprintsResponse {
  blueprints: { id: string; title: string }[];
}

function entityUrl(base: string, e: Pick<OrreryEntity, 'blueprint' | 'key'>): string {
  return `${base.replace(/\/$/, '')}/entities/${encodeURIComponent(e.blueprint)}/${e.key.split('/').map(encodeURIComponent).join('/')}`;
}

/** The address people open the hub's pages on; a hub one release back names none, and its machine address stands in. */
async function webBase(ctx: ConnectorContext<OrreryConfig>, base: string, headers: Record<string, string>): Promise<string> {
  try {
    const web = (await fetchJson<WhoAmIResponse>(ctx, `${base}/v1/whoami`, { headers })).web;
    if (web) return web.replace(/\/$/, '');
    ctx.log.warn('orrery hub names no web address', { base });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    ctx.log.warn('orrery whoami unavailable', { status: err.status });
  }
  return base;
}

/** The containment relations of a blueprint, in the order they are tried. */
function parentRelationsFor(config: OrreryConfig, blueprint: string): string[] {
  if (config.parentRelation === undefined) return [];
  const r = typeof config.parentRelation === 'string' ? config.parentRelation : config.parentRelation[blueprint];
  return r === undefined ? [] : Array.isArray(r) ? r : [r];
}

/** The fields a page asks the hub for: the kept facts, and what the subtitle and an edge read; undefined asks for every field. */
function askedFields(config: OrreryConfig, blueprint: string): string[] | undefined {
  const facts = config.facts[blueprint];
  if (facts === undefined) return undefined;
  const edge: OrreryEdge | undefined = config.edges[blueprint];
  const extra = [config.subtitle[blueprint], edge?.label, edge?.health, edge?.unresolved].filter((f): f is string => f !== undefined);
  return [...new Set([...facts, ...extra])];
}

/** A blueprint's field definitions, for titles and formats; a hub that does not describe it leaves every field by its name. */
async function fieldDefs(ctx: ConnectorContext<OrreryConfig>, base: string, headers: Record<string, string>, blueprint: string): Promise<Record<string, OrreryFieldDef>> {
  try {
    const def = (await fetchJsonTagged<OrreryBlueprintDef>(ctx, `${base}/v1/blueprints/${encodeURIComponent(blueprint)}`, { headers })).body;
    return def.fields ?? {};
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      ctx.log.warn('orrery blueprint undescribed', { blueprint, status: 404 });
      return {};
    }
    throw err;
  }
}

function factsOf(fields: Record<string, unknown>, keep: readonly string[] | undefined): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  const entries = keep === undefined ? Object.entries(fields) : keep.map((k) => [k, fields[k]] as const);
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue;
    const parsed = FactValueSchema.safeParse(v);
    if (parsed.success) out[k] = parsed.data;
  }
  return out;
}

/** The severity of an alert from the label Prometheus rules use, read the way the Orrery hub reads it. */
export function alertSeverity(label: string | undefined): ItemSeverity {
  const s = (label ?? '').toLowerCase();
  if (/^(critical|page|p1|sev0|sev1)$/.test(s)) return 'critical';
  if (/^(high|error|p2|sev2)$/.test(s)) return 'high';
  if (/^(warning|warn|medium|p3|sev3)$/.test(s)) return 'medium';
  if (/^(info|none|informational)$/.test(s)) return 'info';
  return 'low';
}

function alertItem(web: string, a: OrreryAlert & { entity: NonNullable<OrreryAlert['entity']> }): OpenItem {
  const title = a.annotations['summary'] ?? a.labels['alertname'] ?? a.fingerprint;
  return {
    id: a.fingerprint,
    kind: 'alert',
    title,
    url: a.annotations['runbook_url'] ?? entityUrl(web, a.entity),
    severity: alertSeverity(a.labels['severity']),
    status: a.status,
    updated: new Date(a.updatedAt).toISOString(),
  };
}

/** Firing alerts by the entity id they are attached to; an older hub without the endpoint has none. */
async function alertsByEntity(ctx: ConnectorContext<OrreryConfig>, base: string, web: string, headers: Record<string, string>): Promise<Map<string, OpenItem[]>> {
  const out = new Map<string, OpenItem[]>();
  let res: AlertsResponse;
  try {
    res = (await fetchJsonTagged<AlertsResponse>(ctx, `${base}/v1/alerts`, { headers })).body;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      ctx.log.warn('orrery alerts unavailable', { status: 404 });
      return out;
    }
    throw err;
  }
  let attached = 0;
  for (const a of res.alerts) {
    if (!a.entity || a.status === 'resolved') continue;
    const id = orreryEntityId(a.entity);
    out.set(id, [...(out.get(id) ?? []), alertItem(web, { ...a, entity: a.entity })]);
    attached++;
  }
  ctx.log.info('orrery alerts read', { alerts: res.alerts.length, attached, entities: out.size });
  return out;
}

function convert(config: OrreryConfig, web: string, e: OrreryEntity, defs: Record<string, OrreryFieldDef>): { entity: BatchEntity; relations: BatchRelation[] } {
  const id = orreryEntityId(e);
  let parentRef: OrreryRef | undefined;
  for (const rel of parentRelationsFor(config, e.blueprint)) {
    parentRef = visibleRefs(e, rel)[0];
    if (parentRef) break;
  }
  // Containment stays a relation too: a diagram may nest by another relation and still want this one.
  const relations: BatchRelation[] = [];
  for (const name of Object.keys(e.relations)) {
    const kind = config.relationKinds[name];
    for (const ref of visibleRefs(e, name)) relations.push({ from: id, to: orreryEntityId(ref), label: name, ...(kind !== undefined ? { kind } : {}), tags: [name] });
  }
  const facts = factsOf(e.fields, config.facts[e.blueprint]);
  const subtitleField = config.subtitle[e.blueprint];
  const named = subtitleField === undefined ? undefined : FactValueSchema.safeParse(e.fields[subtitleField]);
  const subtitle = named?.success ? valueText(named.data, defs[subtitleField!]) : '';
  const entity: BatchEntity = {
    id,
    type: config.types[e.blueprint] ?? e.blueprint,
    name: e.title,
    subtitle: subtitle !== '' ? subtitle : e.key,
    facts,
    display: displayOf(facts, defs),
    url: entityUrl(web, e),
    tags: [e.blueprint],
    ...(parentRef !== undefined ? { parent: orreryEntityId(parentRef) } : {}),
  };
  return { entity, relations };
}

export const orreryConnector: Connector<OrreryConfig> = {
  id: 'orrery',
  configSchema: OrreryConfigSchema,
  async *discover(ctx: ConnectorContext<OrreryConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const base = config.url.replace(/\/$/, '');
    const token = await ctx.secrets(config.token);
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    let blueprints = config.blueprints;
    if (!blueprints) {
      const res = (await fetchJsonTagged<BlueprintsResponse>(ctx, `${base}/v1/blueprints`, { headers })).body;
      blueprints = res.blueprints.map((b) => b.id);
      log.info('orrery blueprints listed', { count: blueprints.length });
    }
    const web = await webBase(ctx, base, headers);
    const alerts = config.alerts ? await alertsByEntity(ctx, base, web, headers) : new Map<string, OpenItem[]>();
    for (const blueprint of blueprints) {
      const entities: BatchEntity[] = [];
      const relations: BatchRelation[] = [];
      let offset = 0;
      let pages = 0;
      let total = 0;
      let kept = 0;
      const asked = askedFields(config, blueprint);
      const filter = config.filters[blueprint] ?? config.filter;
      const defs = await fieldDefs(ctx, base, headers, blueprint);
      const edge = config.edges[blueprint];
      const records: OrreryEntity[] = [];
      for (;;) {
        const q = new URLSearchParams({ blueprint, limit: String(config.pageSize), offset: String(offset) });
        // Only the fields kept as facts; the hub still sends the key, title, state, and relations.
        if (asked !== undefined) q.set('fields', asked.join(','));
        if (filter !== undefined) q.set('filter', JSON.stringify(filter));
        const answer = await fetchJsonTagged<EntitiesResponse>(ctx, `${base}/v1/entities?${q}`, { headers });
        const page = answer.body;
        pages++;
        if (answer.kept) kept++;
        total = page.total;
        for (const e of page.entities) {
          if (edge) {
            records.push(e);
            continue;
          }
          const c = convert(config, web, e, defs);
          const items = alerts.get(c.entity.id);
          entities.push(items ? { ...c.entity, items } : c.entity);
          relations.push(...c.relations);
        }
        log.debug('orrery page', { blueprint, page: pages, offset, got: page.entities.length, total, kept: answer.kept });
        offset += page.entities.length;
        if (page.entities.length === 0 || offset >= total) break;
      }
      if (edge) {
        const folded = foldEdges(blueprint, edge, records, config.facts[blueprint], defs, config.relationKinds[blueprint]);
        entities.push(...folded.entities);
        relations.push(...folded.relations);
        log.info('orrery edges folded', { blueprint, ...folded.counts });
      }
      log.info('orrery blueprint read', { blueprint, pages, kept, entities: entities.length, relations: relations.length });
      yield { source: 'orrery', observed: ctx.now().toISOString(), partial: true, entities, relations };
    }
  },
};
