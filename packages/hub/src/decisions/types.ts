/**
 * A decision record and its registry, as every surface sees them (API,
 * MCP, pages). The input schemas are the one definition of what a writer
 * may send; the stored rows are repo.ts's business.
 */
import { z } from 'zod';
import { isRegistryPrefix } from '@vantage/model';

export const STATUSES = ['proposed', 'accepted', 'deprecated', 'superseded'] as const;
export type DecisionStatus = (typeof STATUSES)[number];
export const StatusSchema = z.enum(STATUSES);

export const STATUS_LABEL: Record<DecisionStatus, string> = { proposed: 'Proposed', accepted: 'Accepted', deprecated: 'Deprecated', superseded: 'Superseded' };

export const CategorySchema = z.object({ digit: z.number().int().min(0).max(9), name: z.string().trim().min(1).max(60) }).strict();
export type Category = z.infer<typeof CategorySchema>;

export const CategoriesSchema = z
  .array(CategorySchema)
  .min(1)
  .max(10)
  .refine((cs) => new Set(cs.map((c) => c.digit)).size === cs.length, 'each digit names one category');

/** The scheme a registry gets when its maker names none. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { digit: 0, name: 'Governance' },
  { digit: 1, name: 'Infrastructure' },
  { digit: 2, name: 'Security' },
  { digit: 3, name: 'Data' },
  { digit: 4, name: 'Compute' },
  { digit: 5, name: 'Development' },
  { digit: 6, name: 'Operations' },
];

export const PrefixSchema = z
  .string()
  .trim()
  .refine(isRegistryPrefix, 'a prefix is 2 to 12 upper-case letters and digits, starting with a letter, and is not ADR');

export const RegistryInputSchema = z
  .object({
    prefix: PrefixSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    categories: CategoriesSchema.optional(),
  })
  .strict();
export type RegistryInput = z.infer<typeof RegistryInputSchema>;

export const RegistryPatchSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).optional(), categories: CategoriesSchema.optional() })
  .strict();
export type RegistryPatch = z.infer<typeof RegistryPatchSchema>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const Markdown = z.string().max(100_000);

export const AlternativeSchema = z
  .object({ option: z.string().trim().min(1).max(300).describe('The option, in a few words'), rejected: Markdown.describe('Why it was not chosen, as Markdown') })
  .strict();
export type Alternative = z.infer<typeof AlternativeSchema>;

/** The longest a position's line may be: the rule people follow, in one sentence. */
export const LINE_MAX = 200;

const Word = z.string().trim().min(1).max(40);

/** The longest a facet may be, on a scope and in a line's reach: room for a role prefix and a 40 character key, as a catalog names its teams. */
export const FACET_MAX = 100;
const Facet = z.string().trim().min(1).max(FACET_MAX);
const Ref = z.string().trim().min(1).max(300);

/** Where a line reaches: its own scope, the scopes below unless `below` is false, every scope that carries one of its facets, and, inside a repository, the paths it names. */
export const ReachSchema = z
  .object({
    below: z.boolean().default(true).describe('Whether the scopes below its own are bound too'),
    facets: z.array(Facet).max(20).default([]).describe('Scopes elsewhere in the tree that carry one of these facets are bound too'),
    paths: z.array(Ref).max(50).default([]).describe('Inside a repository, the paths the line binds; none is the whole repository'),
  })
  .strict();

/**
 * The line a record sets for its scope's standard (VAN-3018). The binding
 * word and who it binds come from the estate's lists, checked when the
 * record is written and again by the machine gate.
 */
export const PositionSchema = z
  .object({
    line: z.string().trim().min(1).max(LINE_MAX).describe('The rule people follow, at most 200 characters'),
    binding: Word.describe("The binding word from the estate's list: must, should, or may by default"),
    binds: z.array(Word).min(1).max(10).describe("Who it binds, from the estate's list: people, agents, systems by default"),
    locked: z.boolean().default(false).describe('Locked against departures: no exception, or only from the scope the estate names'),
    reach: ReachSchema.default({ below: true, facets: [], paths: [] }),
    enforced_by: z.array(Ref).max(20).default([]).describe('The mechanisms that enforce it, as things in the catalog'),
    checked_by: z.array(Ref).max(20).default([]).describe("The judge's rules that check it, as pack.rule"),
  })
  .strict();
export type Position = z.output<typeof PositionSchema>;
export type PositionInput = z.input<typeof PositionSchema>;

/** How a record stands against a line it inherits (VAN-3019): it builds to it, refines it with a stricter line, or departs from it. */
export const STANCES = ['builds', 'refines', 'departs'] as const;
export type Stance = (typeof STANCES)[number];

/** One entry of a record's map of inherited lines, as a writer sends it. */
export const InheritSchema = z
  .object({
    line: Ref.describe('The record that sets the inherited line: PAY-3001'),
    stance: z.enum(STANCES).describe('builds, refines (a stricter line of its own), or departs (needs an exception)'),
    edition: z
      .string()
      .trim()
      .regex(/^[^@\s]+@\d+$/, 'an edition is <scope>@<n>, as standard/<scope> names it')
      .describe("The edition of the record's own scope it read: payments@4"),
  })
  .strict();
export type InheritInput = z.infer<typeof InheritSchema>;

/** An inherited line as a record keeps it: the line's record by id, so a move keeps it. */
export interface Inherit {
  readonly line: string;
  readonly stance: Stance;
  readonly scope: string;
  readonly version: number;
}

/** A box or a view a record governs: `document` is `workspace/document`, or a document slug in the registry's own workspace. */
export const GovernsSchema = z
  .object({
    document: z.string().trim().min(1).max(200),
    box: z.string().trim().min(1).max(200).optional(),
    view: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((g) => (g.box === undefined) !== (g.view === undefined), 'name a box or a view, one per link');
export type GovernsInput = z.infer<typeof GovernsSchema>;

const fields = {
  title: z.string().trim().min(1).max(200),
  decidedOn: Day.optional(),
  deciders: z.array(z.string().trim().min(1).max(120)).max(30),
  context: Markdown,
  decision: Markdown,
  consequences: Markdown,
  alternatives: z.array(AlternativeSchema).max(30),
  related: z.array(z.string().trim().min(1)).max(50),
  position: PositionSchema.nullable(),
  governs: z.array(GovernsSchema).max(200),
  amends: z.array(z.string().trim().min(1)).max(50),
  inherits: z.array(InheritSchema).max(100),
};

export const DecisionCreateSchema = z
  .object({
    ...fields,
    category: z.number().int().min(0).max(9),
    status: z.enum(['proposed', 'accepted']).default('accepted'),
    deciders: fields.deciders.min(1, 'name the people who decided'),
    decidedOn: Day,
    /** Last updated; today in the estate's time zone (TIME_ZONE) when absent. */
    updatedOn: Day.optional(),
    alternatives: fields.alternatives.default([]),
    related: fields.related.default([]),
    position: fields.position.optional(),
    governs: fields.governs.default([]),
    amends: fields.amends.default([]),
    inherits: fields.inherits.default([]),
  })
  .strict();
export type DecisionCreate = z.input<typeof DecisionCreateSchema>;

export const DecisionPatchSchema = z
  .object({
    title: fields.title.optional(),
    /** superseded only with supersededBy, or on a record already marked so. */
    status: z.enum(['proposed', 'accepted', 'deprecated', 'superseded']).optional(),
    decidedOn: Day.optional(),
    deciders: fields.deciders.min(1).optional(),
    context: Markdown.optional(),
    decision: Markdown.optional(),
    consequences: Markdown.optional(),
    alternatives: fields.alternatives.optional(),
    related: fields.related.optional(),
    position: fields.position.optional(),
    governs: fields.governs.optional(),
    amends: fields.amends.optional(),
    inherits: fields.inherits.optional(),
    /** The record in the same registry that replaced this one, for a record superseded with none named. */
    supersededBy: z.string().trim().min(1).max(40).optional(),
    /** The record this one replaced, when that record is superseded with no successor named. */
    supersedes: z.string().trim().min(1).max(40).optional(),
    updatedOn: Day.optional(),
    /** A fix to dates or wording: Last updated stays as it was. */
    minor: z.boolean().optional(),
    message: z.string().max(500).optional(),
  })
  .strict();
export type DecisionPatch = z.input<typeof DecisionPatchSchema>;

export interface Registry {
  readonly id: string;
  readonly prefix: string;
  readonly name: string;
  readonly description: string;
  readonly categories: readonly Category[];
  readonly workspace: string;
  readonly workspaceId: string;
  readonly createdAt: string;
}

export interface Governs {
  readonly workspace: string;
  readonly document: string;
  readonly documentName: string;
  readonly box?: string;
  readonly view?: string;
}

/** A record linked from another: its citation and enough to show it. */
export interface DecisionStub {
  readonly id: string;
  readonly ref: string;
  readonly title: string;
  readonly status: DecisionStatus;
}

export interface Decision {
  readonly id: string;
  /** SHOP-2001 */
  readonly ref: string;
  /** adr:<ULID> */
  readonly machineRef: string;
  /** Citations the record held before it moved, oldest first; each still resolves to it. */
  readonly aliases: readonly string[];
  readonly registry: string;
  readonly workspace: string;
  readonly number: number;
  readonly category: number;
  readonly categoryName: string;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly decidedOn: string | null;
  readonly updatedOn: string;
  readonly deciders: readonly string[];
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly alternatives: readonly Alternative[];
  readonly related: readonly DecisionStub[];
  readonly position: Position | null;
  readonly supersedes: DecisionStub | null;
  readonly supersededBy: DecisionStub | null;
  readonly amends: readonly DecisionStub[];
  /** Its map of inherited lines (VAN-3019). */
  readonly inherits: readonly { readonly line: DecisionStub; readonly stance: Stance; readonly edition: string }[];
  /** The other ends of typed relations, kept by the records that name this one. */
  readonly amendedBy: readonly DecisionStub[];
  readonly refinedBy: readonly DecisionStub[];
  readonly departedBy: readonly DecisionStub[];
  readonly governs: readonly Governs[];
}

export interface DecisionRevision {
  readonly id: string;
  readonly message: string;
  readonly author: string | null;
  readonly surface: string;
  readonly createdAt: string;
  readonly snapshot: Record<string, unknown>;
}
