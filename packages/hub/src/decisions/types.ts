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

/** How a record stands against an outside standard: it follows a rule, extends it, departs from it, or covers what no rule does. */
export const STANCES = ['follows', 'extends', 'departs', 'new-ground'] as const;
export type Stance = (typeof STANCES)[number];

export const STATUS_LABEL: Record<DecisionStatus, string> = { proposed: 'Proposed', accepted: 'Accepted', deprecated: 'Deprecated', superseded: 'Superseded' };
export const STANCE_LABEL: Record<Stance, string> = { follows: 'Follows', extends: 'Extends', departs: 'Departs from', 'new-ground': 'New ground' };

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

export const AlignmentSchema = z
  .object({
    stance: z.enum(STANCES),
    rule: z.string().trim().min(1).max(200).optional().describe('The rule id the stance is about; absent for new ground'),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type Alignment = z.infer<typeof AlignmentSchema>;

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
  alignment: AlignmentSchema.nullable(),
  governs: z.array(GovernsSchema).max(200),
};

export const DecisionCreateSchema = z
  .object({
    ...fields,
    category: z.number().int().min(0).max(9),
    status: z.enum(['proposed', 'accepted']).default('accepted'),
    deciders: fields.deciders.min(1, 'name the people who decided'),
    decidedOn: Day,
    /** Last updated; today (UTC) when absent. Send the local date. */
    updatedOn: Day.optional(),
    alternatives: fields.alternatives.default([]),
    related: fields.related.default([]),
    alignment: fields.alignment.optional(),
    governs: fields.governs.default([]),
  })
  .strict();
export type DecisionCreate = z.input<typeof DecisionCreateSchema>;

export const DecisionPatchSchema = z
  .object({
    title: fields.title.optional(),
    status: z.enum(['proposed', 'accepted', 'deprecated']).optional(),
    decidedOn: Day.optional(),
    deciders: fields.deciders.min(1).optional(),
    context: Markdown.optional(),
    decision: Markdown.optional(),
    consequences: Markdown.optional(),
    alternatives: fields.alternatives.optional(),
    related: fields.related.optional(),
    alignment: fields.alignment.optional(),
    governs: fields.governs.optional(),
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
  readonly alignment: Alignment | null;
  readonly supersedes: DecisionStub | null;
  readonly supersededBy: DecisionStub | null;
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
