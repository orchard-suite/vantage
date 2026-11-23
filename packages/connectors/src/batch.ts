/**
 * The push shape: what every connector produces and what the push endpoint
 * accepts. One batch is one observation of one source at one moment.
 */
import { z } from 'zod';
import { OPEN_ITEM_KINDS, ITEM_SEVERITIES, REPOSITORY } from '@vantage/model';

/** Any JSON value. Facts arrive nested from sources; a mapping flattens them for display. */
export type FactValue = string | number | boolean | null | FactValue[] | { [key: string]: FactValue };

export const FactValueSchema: z.ZodType<FactValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(FactValueSchema), z.record(z.string(), FactValueSchema)]),
);

export const RELATION_KINDS = ['sync', 'async', 'data', 'deploy', 'auth', 'observe', 'manage'] as const;

/** Something open against an entity right now: an issue, a firing alert, a pull request, an incident. */
export const OpenItemSchema = z
  .object({
    id: z.string().min(1).describe('Stable within the source, for example the issue key or the alert fingerprint'),
    kind: z.enum(OPEN_ITEM_KINDS),
    title: z.string().min(1),
    url: z.string().optional().describe('Where the source shows the item'),
    severity: z.enum(ITEM_SEVERITIES).optional().describe('critical, high, medium, low, or info; the badge takes the worst'),
    status: z.string().optional().describe("The source's own word for where it stands"),
    updated: z.string().datetime({ offset: true }).optional().describe('When the source last changed it'),
  })
  .strict();

/**
 * Where an item that is not reported on its entity points: an observed key
 * (`slug:id`, of any connector in the workspace), or every observed entity
 * whose fact carries a value (a repository, a service name).
 */
export const ItemTargetSchema = z.union([
  z.object({ key: z.string().min(1).describe('An observed entity key, slug:id') }).strict(),
  z.object({ fact: z.string().min(1).describe('A fact name on observed entities'), value: z.string().min(1).describe('The value that fact must carry') }).strict(),
]);

export const BatchItemSchema = OpenItemSchema.extend({ target: ItemTargetSchema }).strict();

/** How a person reads one fact: the source's own title for it and its value as the source formats it. */
export const DisplayFactSchema = z
  .object({
    fact: z.string().min(1).describe('The fact this shows, a key of facts'),
    label: z.string().min(1).describe('What the fact is called, such as "Cost last month"'),
    value: z.string().describe('Its value as a person reads it, such as "$1,152"'),
  })
  .strict();

export const BatchEntitySchema = z
  .object({
    id: z.string().min(1).describe('Stable within the source'),
    type: z.string().min(1).describe('Profile type, or a source type the mapping resolves'),
    name: z.string().min(1),
    parent: z.string().min(1).optional().describe('Id of the containing entity in the same source'),
    facts: z.record(z.string(), FactValueSchema).optional(),
    url: z.string().optional().describe('Where the source shows this entity'),
    tags: z.array(z.string()).optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    items: z.array(OpenItemSchema).optional().describe('What is open against this entity now; an entity sent without it has nothing open'),
    display: z.array(DisplayFactSchema).optional().describe('The facts a box shows, in order, each with its label and value as text; without it a box shows every fact by its key. Facts stay the raw values that filters and colors read'),
  })
  .strict();

export const BatchRelationSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
    kind: z.enum(RELATION_KINDS).optional(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional().describe('What a reader sees on click: the evidence behind the arrow'),
  })
  .strict();

/** The most characters of one file's change a batch carries; the rest is cut with a marker. */
export const PATCH_MAX = 4_000;

/** What one commit changed: the files, each with the start of its diff. */
export const CommitSchema = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{7,64}$/),
    at: z.string().datetime({ offset: true }).optional().describe('When it landed on the branch'),
    title: z.string().max(500).optional().describe('The first line of its message'),
    files: z.array(z.object({ path: z.string().min(1), patch: z.string().max(PATCH_MAX + 100).optional() }).strict()).max(300),
  })
  .strict();

/** A repository's recent history on one branch, oldest first, for the hub to read which docs a change may have made stale. */
export const ChangesSchema = z
  .object({
    repository: z.string().regex(REPOSITORY, 'host/owner/name').describe('The repository as host/owner/name, as a document names it in docs.repository'),
    branch: z.string().min(1),
    head: z.string().regex(/^[0-9a-f]{7,64}$/),
    commits: z.array(CommitSchema).max(1000).describe('Oldest first; the head is last'),
  })
  .strict();

export const BatchSchema = z
  .object({
    source: z.string().min(1).describe('Source id, unique per org'),
    observed: z.string().datetime({ offset: true }).describe('When the source was read'),
    partial: z.boolean().optional().describe('True when this batch is one slice of a run; entities absent from it are not missing'),
    entities: z.array(BatchEntitySchema),
    relations: z.array(BatchRelationSchema).default([]),
    items: z.array(BatchItemSchema).optional().describe('Open items that point at entities by key or by fact, for sources that track work rather than things'),
    changes: z.array(ChangesSchema).optional().describe('Recent history of repositories, for sources that read code; the hub keeps the latest per repository'),
  })
  .strict();

export type BatchEntity = z.output<typeof BatchEntitySchema>;
export type BatchRelation = z.output<typeof BatchRelationSchema>;
export type OpenItem = z.output<typeof OpenItemSchema>;
export type DisplayFact = z.output<typeof DisplayFactSchema>;
export type ItemTarget = z.output<typeof ItemTargetSchema>;
export type BatchItem = z.output<typeof BatchItemSchema>;
export type Batch = z.output<typeof BatchSchema>;
export type Changes = z.output<typeof ChangesSchema>;
export type BatchInput = z.input<typeof BatchSchema>;
export type RelationKind = (typeof RELATION_KINDS)[number];

export function batchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(BatchSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

/** The key an observed model files an entity under. */
export function entityKey(source: string, id: string): string {
  return `${source}:${id}`;
}

/** The key an observed model files a relation under; label and kind make two arrows between the same pair distinct. */
export function relationKey(source: string, r: Pick<BatchRelation, 'from' | 'to' | 'label' | 'kind'>): string {
  return `${source}:${r.from}>${r.to}#${r.label ?? ''}#${r.kind ?? ''}`;
}

/** The text of a target, the part of an item's key that tells two pointers of one item apart. */
export function targetText(t: ItemTarget): string {
  return 'key' in t ? t.key : `${t.fact}=${t.value}`;
}

/** The key an observed model files a batch-level item under. */
export function batchItemKey(source: string, item: Pick<BatchItem, 'id' | 'target'>): string {
  return `${source}:${item.id}@${targetText(item.target)}`;
}

/**
 * Folds the slices of one run into one full batch. The result is full
 * (not partial) only when every slice came from the same source; a later
 * slice's entity replaces an earlier one with the same id.
 */
export function mergeBatches(batches: readonly Batch[], observed: string): Batch {
  const first = batches[0];
  if (!first) throw new Error('mergeBatches needs at least one batch');
  const entities = new Map<string, BatchEntity>();
  const relations = new Map<string, BatchRelation>();
  const items = new Map<string, BatchItem>();
  const changes = new Map<string, Changes>();
  for (const b of batches) {
    for (const c of b.changes ?? []) changes.set(c.repository, c);
    if (b.source !== first.source) throw new Error(`mergeBatches: sources differ (${first.source}, ${b.source})`);
    for (const e of b.entities) entities.set(e.id, e);
    for (const r of b.relations) relations.set(relationKey(b.source, r), r);
    for (const i of b.items ?? []) items.set(batchItemKey(b.source, i), i);
  }
  return { source: first.source, observed, entities: [...entities.values()], relations: [...relations.values()], ...(items.size ? { items: [...items.values()] } : {}), ...(changes.size ? { changes: [...changes.values()] } : {}) };
}
