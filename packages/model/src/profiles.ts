/**
 * Profiles: type vocabularies as data. `bpmn` and `uml` add their shapes and
 * roles; `azure`, `aws`, and `k8s` restyle the built-in catalog with vendor
 * icons and add one type per common service. A document lists the profiles
 * it uses; its own `types:` extend any of them. Adding a vocabulary is a
 * YAML file, not code.
 *
 * A profile type may list the source types it `matches` (an Azure resource
 * type, a Kubernetes kind), so observed entities find their icon without a
 * mapping.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { BUILTIN_TYPES, type NodeType } from './types.ts';

const ProfileFileSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    types: z.record(
      z.string(),
      z
        .object({
          extends: z.string().optional(),
          role: z.enum(['actor', 'edge', 'compute', 'data', 'platform', 'external', 'boundary']).optional(),
          shape: z.enum(['box', 'rounded', 'cylinder', 'person', 'cloud', 'hexagon', 'pill', 'document', 'queue', 'ellipse', 'circle', 'diamond', 'parallelogram', 'triangle']).optional(),
          color: z.string().optional(),
          icon: z.string().optional(),
          frame: z.enum(['box', 'dashed', 'none']).optional(),
          description: z.string().optional(),
          matches: z.array(z.string()).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export interface Profile {
  readonly name: string;
  readonly description?: string;
  readonly types: ReadonlyMap<string, NodeType>;
  /** Source type (lowercase) to the profile type that stands for it. */
  readonly matches: ReadonlyMap<string, NodeType>;
}

const DIR = join(import.meta.dir, '..', 'profiles');

function loadProfile(file: string): Profile {
  const parsed = ProfileFileSchema.parse(parse(readFileSync(join(DIR, file), 'utf8')));
  const types = new Map<string, NodeType>();
  const matches = new Map<string, NodeType>();
  for (const [name, def] of Object.entries(parsed.types)) {
    const base = def.extends ? (types.get(def.extends) ?? BUILTIN_TYPES.get(def.extends)) : undefined;
    const t: NodeType = {
      name,
      role: def.role ?? base?.role ?? 'compute',
      shape: def.shape ?? base?.shape ?? 'rounded',
      color: def.color ?? base?.color ?? 'slate',
      ...((def.icon ?? base?.icon) !== undefined ? { icon: (def.icon ?? base?.icon)! } : {}),
      ...((def.frame ?? base?.frame) !== undefined ? { frame: (def.frame ?? base?.frame)! } : {}),
      description: def.description ?? base?.description ?? '',
    };
    types.set(name, t);
    for (const m of def.matches ?? []) matches.set(m.toLowerCase(), t);
  }
  return { name: parsed.name, ...(parsed.description !== undefined ? { description: parsed.description } : {}), types, matches };
}

/** Every profile in `profiles/`, keyed by name. Loaded once. */
export const PROFILES: ReadonlyMap<string, Profile> = new Map(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => loadProfile(f))
    .map((p) => [p.name, p] as const),
);

/** The type table for a document: its profiles in order, later ones winning, over the built-in catalog. */
export function profileTypes(names: readonly string[]): ReadonlyMap<string, NodeType> {
  const out = new Map<string, NodeType>(BUILTIN_TYPES);
  for (const n of names) for (const [k, v] of PROFILES.get(n)?.types ?? []) out.set(k, v);
  return out;
}

/**
 * The profile type a source type stands for: in the named profiles, a type
 * that `matches` it or has its name; else a type in any profile that
 * `matches` it. Names alone are not unique across profiles, matches are.
 */
export function typeForSource(sourceType: string, names: readonly string[] = []): NodeType | undefined {
  const key = sourceType.toLowerCase();
  for (const n of names) {
    const p = PROFILES.get(n);
    const hit = p?.matches.get(key) ?? p?.types.get(key);
    if (hit) return hit;
  }
  for (const p of PROFILES.values()) {
    const hit = p.matches.get(key);
    if (hit) return hit;
  }
  return undefined;
}
