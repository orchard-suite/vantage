/**
 * A mapping turns a source's types and fields into a profile's types and
 * display facts. Mappings are data, per org, versioned in the hub; this
 * module only applies them.
 */
import { z } from 'zod';
import { PROFILES } from '@vantage/model';
import type { Batch, BatchEntity, FactValue } from './batch.ts';
import type { Logger } from './connector.ts';
import { getPath, render, renderStrict, stringify } from './template.ts';

export const MappingSchema = z
  .object({
    source: z.string().min(1).describe('The source this mapping applies to'),
    profile: z.string().min(1).describe('Profile whose types the mapped batch uses, for example azure or k8s; its matches fill types the table leaves out'),
    types: z.record(z.string(), z.string()).default({}).describe('Source type to profile type'),
    facts: z.record(z.string(), z.string()).optional().describe('Dotted path into the source facts to the display label; when present only mapped facts stay'),
    parent: z.record(z.string(), z.string()).optional().describe('Named parent templates over the entity and its facts, tried in order for entities without a parent'),
    name: z.string().optional().describe('Name template over the entity and its facts'),
    drop: z.array(z.string()).default([]).describe('Source types or entity ids left out, with their relations'),
  })
  .strict();

export type Mapping = z.output<typeof MappingSchema>;
export type MappingInput = z.input<typeof MappingSchema>;

export function mappingJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(MappingSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

export interface MappedBatch {
  readonly batch: Batch;
  /** Unknown types, unresolved templates, and a source mismatch; the hub shows these beside the mapping. */
  readonly warnings: readonly string[];
}

/** What templates see: the entity's facts at the root, with the entity's own fields on top. */
function templateContext(e: BatchEntity, source: string): Record<string, unknown> {
  return { ...(e.facts ?? {}), id: e.id, type: e.type, name: e.name, source, ...(e.parent !== undefined ? { parent: e.parent } : {}), ...(e.subtitle !== undefined ? { subtitle: e.subtitle } : {}), ...(e.url !== undefined ? { url: e.url } : {}), facts: e.facts ?? {} };
}

function mapFacts(facts: Record<string, FactValue> | undefined, map: Record<string, string> | undefined): Record<string, FactValue> | undefined {
  if (!map) return facts;
  const out: Record<string, FactValue> = {};
  for (const [path, label] of Object.entries(map)) {
    const v = getPath(facts, path);
    if (v === undefined || v === null || v === '') continue;
    out[label] = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : stringify(v);
  }
  return out;
}

export function applyMapping(batch: Batch, mapping: Mapping, log?: Logger): MappedBatch {
  const warnings: string[] = [];
  const unknownTypes = new Map<string, number>();
  if (mapping.source !== batch.source) warnings.push(`mapping is for source ${mapping.source} but the batch is from ${batch.source}`);
  const drop = new Set(mapping.drop);
  const dropped = new Set<string>();
  const entities: BatchEntity[] = [];
  for (const e of batch.entities) {
    if (drop.has(e.type) || drop.has(e.id)) {
      dropped.add(e.id);
      continue;
    }
    const type = mapping.types[e.type] ?? PROFILES.get(mapping.profile)?.matches.get(e.type.toLowerCase())?.name;
    if (type === undefined) unknownTypes.set(e.type, (unknownTypes.get(e.type) ?? 0) + 1);
    const ctx = templateContext(e, batch.source);
    let parent = e.parent;
    if (parent === undefined && mapping.parent) {
      for (const [label, template] of Object.entries(mapping.parent)) {
        const rendered = renderStrict(template, ctx);
        if (rendered !== undefined) {
          parent = rendered;
          break;
        }
        log?.debug('mapping parent template unresolved', { entity: e.id, parent: label });
      }
    }
    let name = e.name;
    if (mapping.name) {
      const r = render(mapping.name, ctx);
      if (r.missing.length) warnings.push(`name template missing ${r.missing.join(', ')} on ${e.id}`);
      if (r.text.trim()) name = r.text.trim();
    }
    const facts = mapFacts(e.facts, mapping.facts);
    entities.push({
      ...e,
      type: type ?? e.type,
      name,
      ...(parent !== undefined ? { parent } : {}),
      ...(facts !== undefined ? { facts } : {}),
    });
  }
  for (const [type, n] of unknownTypes) warnings.push(`unknown type ${type} on ${n} entities; passed through`);
  const relations = batch.relations.filter((r) => !dropped.has(r.from) && !dropped.has(r.to));
  for (const w of warnings) log?.warn('mapping warning', { source: batch.source, profile: mapping.profile, warning: w });
  log?.info('mapping applied', { source: batch.source, profile: mapping.profile, entities: entities.length, dropped: dropped.size, relations: relations.length, warnings: warnings.length });
  return { batch: { ...batch, entities, relations }, warnings };
}
