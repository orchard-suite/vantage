/**
 * The decision record tools that are actions: registries, supersede, move,
 * discard, the next number, and import from Markdown. Reading, listing, writing, and
 * refining a record are the five verbs in text-tools.ts.
 * Each call runs as the bearer's principal through the same service as
 * the API.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { guardFor, text } from './run.ts';
import { listRegistries } from '../decisions/read.ts';
import { createRegistry, peekNextNumber, supersedeDecision, updateRegistry } from '../decisions/write.ts';
import { importDecisions } from '../decisions/import-apply.ts';
import { moveDecision } from '../decisions/move.ts';
import { discardDecision } from '../decisions/discard.ts';
import { discardText, importText, moveText, registryLine } from '../decisions/text.ts';
import { AlignmentSchema, AlternativeSchema, CategoriesSchema, GovernsSchema } from '../decisions/types.ts';


const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD, the local date');
const md = (what: string) => z.string().describe(`${what}, as Markdown. Plain words, short sentences.`);

const body = {
  title: z.string().describe('What was decided, as a short sentence a reader can scan'),
  deciders: z.array(z.string()).describe('The people who made the decision, by name. Ask when you do not know; never guess.'),
  decidedOn: Day.describe('The day the decision was made, YYYY-MM-DD'),
  updatedOn: Day.optional().describe('Last updated, YYYY-MM-DD in local time; today in UTC when absent'),
  context: md('Why a decision was needed: the forces and the facts'),
  decision: md('What was decided and what it means in practice'),
  consequences: md('What follows: the benefits and the costs (### Benefits, ### Costs)'),
  alternatives: z.array(AlternativeSchema).optional().describe('Each option not taken, with why it was rejected'),
  related: z.array(z.string()).optional().describe('Related records: SHOP-2001, adr:<ULID>, or ADR-2001 for one in the same registry'),
  alignment: AlignmentSchema.optional().describe('How the record stands against an outside standard: follows, extends, departs, or new-ground, with the rule id and a short note. Leave out when no standard is in use.'),
  governs: z.array(GovernsSchema).optional().describe('Boxes and views the decision governs: { document: "workspace/document", box: "node-id" } or { document, view: "view-id" }. A box shows the records that govern it.'),
};

const supersedeShape = { ref: z.string().describe('The record being superseded'), category: z.number().int().min(0).max(9).optional(), status: z.enum(['proposed', 'accepted']).optional(), ...body };
type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

export function registerDecisionTools(server: McpServer, ctx: AppContext, p: Principal): void {
  const log = ctx.log.child({ surface: 'mcp', userId: p.userId });
  const url = ctx.config.PUBLIC_URL;
  const guarded = guardFor(log);

  server.registerTool(
    'vantage_registries',
    {
      description:
        'Decision registries: named, numbered sets of decision records, each held by a workspace. list shows the ones you can open; create makes one in a workspace (its prefix, such as SHOP, is how its records are cited, SHOP-2001, and never changes); update renames it or changes its category scheme. A number starts with its category digit.',
      inputSchema: {
        action: z.enum(['list', 'create', 'update']).default('list'),
        workspace: z.string().optional().describe('Workspace slug: filters list; where create puts the registry'),
        prefix: z.string().optional().describe('For create and update: 2 to 12 upper-case letters and digits'),
        name: z.string().optional(),
        description: z.string().optional(),
        categories: CategoriesSchema.optional().describe('For create and update: [{ digit: 0, name: "Governance" }, ...]; create defaults to 0 Governance, 1 Infrastructure, 2 Security, 3 Data, 4 Compute, 5 Development, 6 Operations'),
      },
    },
    guarded<{ action?: 'list' | 'create' | 'update' | undefined; workspace?: string | undefined; prefix?: string | undefined; name?: string | undefined; description?: string | undefined; categories?: { digit: number; name: string }[] | undefined }>('vantage_registries', async (a) => {
      if (a.action === 'create') {
        if (!a.workspace || !a.prefix || !a.name) return text('create needs workspace, prefix, and name', true);
        const r = await createRegistry(ctx, p, a.workspace, { prefix: a.prefix, name: a.name, ...(a.description !== undefined ? { description: a.description } : {}), ...(a.categories ? { categories: a.categories } : {}) });
        return text(`created ${registryLine(r)}`);
      }
      if (a.action === 'update') {
        if (!a.prefix) return text('update needs prefix', true);
        const r = await updateRegistry(ctx, p, a.prefix, { ...(a.name !== undefined ? { name: a.name } : {}), ...(a.description !== undefined ? { description: a.description } : {}), ...(a.categories ? { categories: a.categories } : {}) });
        return text(`updated ${registryLine(r)}`);
      }
      const list = await listRegistries(ctx, p, a.workspace);
      return text(list.map(registryLine).join('\n') || 'no registries you can open');
    }),
  );

  server.registerTool(
    'vantage_decision_next',
    { description: 'The number the next record in a category would take: one past the highest any record there holds or held before it moved. Only a discarded record gives its number back.', inputSchema: { registry: z.string(), category: z.number().int().min(0).max(9) } },
    guarded<{ registry: string; category: number }>('vantage_decision_next', async (a) => {
      const n = await peekNextNumber(ctx, p, a.registry, a.category);
      return text(`${n.ref} (${n.categoryName})`);
    }),
  );

  server.registerTool(
    'vantage_decision_supersede',
    {
      description: 'Reverse a decision: write the new record, which takes the next number (in the old record\'s category unless you name one), and mark the old one Superseded by it. The old record keeps its body. Without governs, the new record governs what the old one did.',
      inputSchema: supersedeShape,
    },
    guarded<Args<typeof supersedeShape>>('vantage_decision_supersede', async ({ ref, ...rest }) => {
      const r = await supersedeDecision(ctx, p, ref, rest);
      return text(`created ${r.new.ref} (${r.new.machineRef}); ${r.old.ref} is now Superseded by it\n${url}/w/${r.new.workspace}/decisions/${r.new.ref}`);
    }),
  );

  server.registerTool(
    'vantage_decision_move',
    {
      description:
        'Renumber a decision record, move it to another category (it takes the next number there), or move it to another registry. It keeps its id; the old citation stays an alias that still resolves, and no other record ever takes that number. Every document and record that cites it is rewritten to the new citation, as a new version or revision by you; one you cannot write keeps resolving and is reported. Run with dryRun: true first and read what it would rewrite and what it cannot.',
      inputSchema: {
        ref: z.string().describe('The record to move: SHOP-2001 or adr:<ULID>'),
        registry: z.string().optional().describe('The registry prefix to move it to; its own when absent'),
        number: z.number().int().min(1).max(9999).optional().describe('The exact new number; it must be free'),
        category: z.number().int().min(0).max(9).optional().describe('The new category; the record takes the next number there'),
        dryRun: z.boolean().optional().describe('Report what would change and write nothing'),
        message: z.string().optional().describe('Why it moved, for the history'),
      },
    },
    guarded<{ ref: string; registry?: string | undefined; number?: number | undefined; category?: number | undefined; dryRun?: boolean | undefined; message?: string | undefined }>('vantage_decision_move', async ({ ref, ...rest }) => {
      const r = await moveDecision(ctx, p, ref, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      return text(moveText(r, url));
    }),
  );

  server.registerTool(
    'vantage_decision_discard',
    {
      description:
        'Take back a record you wrote by mistake: it is removed and its number is free for the next record in its category. Only while nothing points to it: no document or other record cites it, no record names it in related or a supersede link, no item links it, no old citation of it resolves, and every revision of it is yours. What it governs goes with it. Otherwise it is refused with the list of what points to it; retire it instead (deprecate or supersede). Run with dryRun: true first. The audit log keeps its whole text.',
      inputSchema: {
        ref: z.string().describe('The record to discard: SHOP-2001 or adr:<ULID>'),
        dryRun: z.boolean().optional().describe('Answer what points to it and write nothing'),
        message: z.string().optional().describe('Why it is discarded, for the audit log'),
      },
    },
    guarded<{ ref: string; dryRun?: boolean | undefined; message?: string | undefined }>('vantage_decision_discard', async ({ ref, ...rest }) => {
      const r = await discardDecision(ctx, p, ref, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      return text(discardText(r), r.dryRun && (r.pointers.length > 0 || r.hidden > 0));
    }),
  );

  server.registerTool(
    'vantage_decision_import',
    {
      description:
        'Bring Markdown decision records from a repository into a registry. Send each file\'s path and text. Every record keeps its number, dates, status, decision makers, and supersede links. The answer lists each file with its new citation and link, so links in the repository can be repointed, and everything that could not be mapped. dryRun: true reports and writes nothing. Running it again skips records already there.',
      inputSchema: {
        registry: z.string(),
        files: z.array(z.object({ path: z.string(), text: z.string() })).min(1).max(500),
        dryRun: z.boolean().optional(),
      },
    },
    guarded<{ registry: string; files: { path: string; text: string }[]; dryRun?: boolean | undefined }>('vantage_decision_import', async (a) => {
      const r = await importDecisions(ctx, p, a.registry, a.files, { dryRun: a.dryRun ?? false });
      return text(importText(r, url));
    }),
  );
}
