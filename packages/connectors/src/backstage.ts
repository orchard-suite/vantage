/**
 * Backstage catalog documents (`apiVersion: backstage.io/v1alpha1`) arrive
 * at the same push endpoint as a batch and are converted here. `kind` and
 * `spec.type` become the source type, the entity reference becomes the id,
 * annotations and the well-known spec fields become facts, and `relations`
 * plus the spec's `dependsOn`, `providesApis`, `consumesApis`, `partOf`,
 * `owner`, and `system` become relations.
 */
import { z } from 'zod';
import type { Batch, BatchEntity, BatchRelation, FactValue } from './batch.ts';
import { FactValueSchema } from './batch.ts';

export const BACKSTAGE_KINDS = ['Component', 'API', 'Resource', 'System', 'Domain', 'Group', 'User'] as const;
export type BackstageKind = (typeof BACKSTAGE_KINDS)[number];

const refList = z.array(z.string()).optional();

export const BackstageEntitySchema = z
  .object({
    apiVersion: z.literal('backstage.io/v1alpha1'),
    kind: z.enum(BACKSTAGE_KINDS),
    metadata: z
      .object({
        name: z.string().min(1),
        namespace: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        annotations: z.record(z.string(), z.string()).optional(),
        labels: z.record(z.string(), z.string()).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.object({ url: z.string(), title: z.string().optional() }).loose()).optional(),
      })
      .loose(),
    spec: z
      .object({
        type: z.string().optional(),
        lifecycle: z.string().optional(),
        owner: z.string().optional(),
        system: z.string().optional(),
        domain: z.string().optional(),
        subcomponentOf: z.string().optional(),
        dependsOn: refList,
        providesApis: refList,
        consumesApis: refList,
        partOf: refList,
        definition: z.unknown().optional(),
      })
      .loose()
      .optional(),
    relations: z.array(z.object({ type: z.string(), targetRef: z.string() }).loose()).optional(),
  })
  .loose();

export type BackstageEntity = z.output<typeof BackstageEntitySchema>;

export const BackstageDocumentSchema = z.union([BackstageEntitySchema, z.array(BackstageEntitySchema)]);

export function backstageJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(BackstageDocumentSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

/** Relation types the converter understands, with the label a reader sees. The spec's lists map onto the same labels. */
const RELATION_LABELS: Record<string, string> = {
  dependsOn: 'depends on',
  providesApi: 'provides',
  consumesApi: 'consumes',
  partOf: 'part of',
  ownedBy: 'owned by',
  hasPart: 'has part',
  ownerOf: 'owns',
  dependencyOf: 'dependency of',
  apiProvidedBy: 'provided by',
  apiConsumedBy: 'consumed by',
  childOf: 'child of',
  parentOf: 'parent of',
  memberOf: 'member of',
  hasMember: 'has member',
};

/** Inverse relation types; a document that lists both directions yields one arrow. */
const INVERSE: Record<string, string> = {
  hasPart: 'partOf',
  ownerOf: 'ownedBy',
  dependencyOf: 'dependsOn',
  apiProvidedBy: 'providesApi',
  apiConsumedBy: 'consumesApi',
  parentOf: 'childOf',
  hasMember: 'memberOf',
};

/** Default kind the reference implies when it carries no kind, as Backstage resolves it. */
const DEFAULT_REF_KIND: Record<string, string> = {
  dependsOn: 'component',
  providesApis: 'api',
  consumesApis: 'api',
  partOf: 'system',
  owner: 'group',
  system: 'system',
  domain: 'domain',
  subcomponentOf: 'component',
};

/** `kind:namespace/name` in lowercase, filling the defaults Backstage fills. */
export function normalizeRef(ref: string, defaultKind: string, defaultNamespace = 'default'): string {
  const m = /^(?:([a-z0-9-]+):)?(?:([a-z0-9-]+)\/)?([^:/]+)$/i.exec(ref.trim());
  if (!m) return ref.toLowerCase();
  const kind = (m[1] ?? defaultKind).toLowerCase();
  const ns = (m[2] ?? defaultNamespace).toLowerCase();
  return `${kind}:${ns}/${(m[3] ?? '').toLowerCase()}`;
}

export function entityRef(e: BackstageEntity): string {
  return normalizeRef(`${e.kind}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`, e.kind);
}

function factsOf(e: BackstageEntity): Record<string, FactValue> {
  const facts: Record<string, FactValue> = {};
  for (const [k, v] of Object.entries(e.metadata.annotations ?? {})) facts[k] = v;
  for (const [k, v] of Object.entries(e.metadata.labels ?? {})) facts[`label.${k}`] = v;
  const spec = e.spec ?? {};
  if (spec.type !== undefined) facts.type = spec.type;
  if (spec.lifecycle !== undefined) facts.lifecycle = spec.lifecycle;
  if (spec.owner !== undefined) facts.owner = spec.owner;
  if (spec.system !== undefined) facts.system = spec.system;
  if (spec.domain !== undefined) facts.domain = spec.domain;
  for (const [k, v] of Object.entries(spec)) {
    if (k in facts || k in DEFAULT_REF_KIND || ['dependsOn', 'providesApis', 'consumesApis', 'partOf', 'definition'].includes(k)) continue;
    const parsed = FactValueSchema.safeParse(v);
    if (parsed.success && parsed.data !== null) facts[k] = parsed.data;
  }
  return facts;
}

function relationsOf(e: BackstageEntity, from: string, ns: string): BatchRelation[] {
  const out = new Map<string, BatchRelation>();
  const add = (type: string, to: string, flip = false): void => {
    const inverse = INVERSE[type];
    const t = inverse ?? type;
    const label = RELATION_LABELS[t] ?? t;
    const rel: BatchRelation = inverse || flip ? { from: to, to: from, label, tags: [t] } : { from, to, label, tags: [t] };
    out.set(`${rel.from}>${rel.to}#${label}`, rel);
  };
  const spec = e.spec ?? {};
  for (const r of spec.dependsOn ?? []) add('dependsOn', normalizeRef(r, 'component', ns));
  for (const r of spec.providesApis ?? []) add('providesApi', normalizeRef(r, 'api', ns));
  for (const r of spec.consumesApis ?? []) add('consumesApi', normalizeRef(r, 'api', ns));
  for (const r of spec.partOf ?? []) add('partOf', normalizeRef(r, 'system', ns));
  if (spec.owner) add('ownedBy', normalizeRef(spec.owner, 'group', ns));
  if (spec.system && e.kind !== 'System') add('partOf', normalizeRef(spec.system, 'system', ns));
  if (spec.domain && e.kind === 'System') add('partOf', normalizeRef(spec.domain, 'domain', ns));
  if (spec.subcomponentOf) add('partOf', normalizeRef(spec.subcomponentOf, 'component', ns));
  for (const r of e.relations ?? []) add(r.type, normalizeRef(r.targetRef, 'component', ns));
  return [...out.values()];
}

/** The containing entity: a component's system, a system's domain, a subcomponent's parent, a user's group. */
function parentOf(e: BackstageEntity, ns: string): string | undefined {
  const spec = e.spec ?? {};
  if (spec.subcomponentOf) return normalizeRef(spec.subcomponentOf, 'component', ns);
  if (e.kind !== 'System' && e.kind !== 'Domain' && spec.system) return normalizeRef(spec.system, 'system', ns);
  if (e.kind === 'System' && spec.domain) return normalizeRef(spec.domain, 'domain', ns);
  return undefined;
}

export function convertBackstageEntity(e: BackstageEntity): { entity: BatchEntity; relations: BatchRelation[] } {
  const ns = e.metadata.namespace ?? 'default';
  const id = entityRef(e);
  const type = e.spec?.type ? `${e.kind.toLowerCase()}:${e.spec.type.toLowerCase()}` : e.kind.toLowerCase();
  const parent = parentOf(e, ns);
  const link = e.metadata.links?.[0]?.url;
  const entity: BatchEntity = {
    id,
    type,
    name: e.metadata.title ?? e.metadata.name,
    facts: factsOf(e),
    tags: [...(e.metadata.tags ?? [])],
    ...(parent !== undefined ? { parent } : {}),
    ...(e.metadata.title !== undefined && e.metadata.title !== e.metadata.name ? { subtitle: e.metadata.name } : {}),
    ...(e.metadata.description !== undefined ? { description: e.metadata.description } : {}),
    ...(link !== undefined ? { url: link } : {}),
  };
  return { entity, relations: relationsOf(e, id, ns) };
}

export interface BackstageConversion {
  readonly batch: Batch;
  readonly warnings: readonly string[];
}

export function convertBackstage(input: unknown, source: string, observed: string): BackstageConversion {
  const docs = BackstageDocumentSchema.parse(input);
  const list = Array.isArray(docs) ? docs : [docs];
  const entities: BatchEntity[] = [];
  const relations: BatchRelation[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const doc of list) {
    const { entity, relations: rels } = convertBackstageEntity(doc);
    if (seen.has(entity.id)) {
      warnings.push(`duplicate entity ${entity.id}; the later document wins`);
      const at = entities.findIndex((x) => x.id === entity.id);
      entities.splice(at, 1);
    }
    seen.add(entity.id);
    entities.push(entity);
    relations.push(...rels);
  }
  const keys = new Set<string>();
  const unique = relations.filter((r) => {
    const k = `${r.from}>${r.to}#${r.label ?? ''}`;
    if (keys.has(k)) return false;
    keys.add(k);
    return true;
  });
  return { batch: { source, observed, entities, relations: unique }, warnings };
}
