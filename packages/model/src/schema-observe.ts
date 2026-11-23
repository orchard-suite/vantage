/**
 * The `observe` block: a node whose inside is drawn from a source's observed
 * entities instead of written by hand. The hub fills it on every render, so
 * the picture follows the source. It names roles over the source's own types,
 * never a vendor's, so any catalog can be drawn.
 */
import { z } from 'zod';

const ObserveViewSchema = z
  .object({
    title: z.string().min(1).optional().describe('Title of the generated placement view; default "<node name>: placement"'),
  })
  .strict();

export const ObserveFailureSchema = z
  .object({
    domains: z.array(z.string()).min(1).describe('Observed types that can fail as a whole, such as a hypervisor or a server; each drawn one gets a view of what its loss takes down'),
    quorum: z
      .object({
        type: z.string().describe('Observed type of the members that vote'),
        fact: z.string().describe('Fact that marks a member'),
        contains: z.string().describe('Value the fact holds, or contains when it is a list'),
        name: z.string().optional().describe('What the group is called in the narrative; default "quorum"'),
      })
      .strict()
      .optional()
      .describe('A voting group that needs a majority, such as etcd'),
    copies: z
      .object({
        type: z.string().describe('Observed type of the thing kept in copies, such as a volume'),
        relation: z.string().describe('Its relation label naming what holds each copy'),
      })
      .strict()
      .optional()
      .describe('Data kept as copies on several holders; the narrative names what loses every copy or is left with one'),
  })
  .strict();

export const ObserveBoundarySchema = z
  .object({
    policy: z.string().describe('Observed type of a policy, such as a network policy'),
    relation: z.string().describe('Its relation label naming what it applies to'),
    fact: z.string().describe('Its fact listing the directions it governs, such as Ingress and Egress'),
    guard: z.string().describe('The direction a member needs a policy for; a member without one is red, its container amber or red'),
    title: z.string().min(1).optional().describe('Title of the generated boundaries view; default "<node name>: boundaries"'),
  })
  .strict();

export const ObserveRelationSchema = z.union([
  z.string().describe('Observed relation drawn as arrows, by its label or a tag it carries'),
  z
    .object({
      label: z.string().describe('Observed relation drawn as arrows, by its label or a tag it carries'),
      color: z.string().optional().describe('Arrow color: a palette family (slate blue violet emerald amber red teal pink) or hex'),
      only: z.boolean().optional().describe('Draw only the boxes these arrows touch, and what holds them'),
    })
    .strict(),
]);

export const ObserveSchema = z
  .object({
    source: z.string().min(1).describe('Slug of the source whose observed entities fill this node'),
    types: z.array(z.string()).min(1).describe('Observed types drawn, outermost first; each entity sits inside its nearest drawn ancestor'),
    where: z
      .record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
      .optional()
      .describe('Facts an entity must carry to be drawn, such as { resourceGroup: [rg-a, rg-b] }: every key must match one of its values, case-insensitive. What holds a matched box is drawn too'),
    nest: z
      .record(z.string(), z.string())
      .optional()
      .describe('Observed type to the relation that holds it, by label or tag, such as { app: service }: a box of that type sits inside the target of the relation instead of its observed parent, so one source draws a logical tree or one by environment as well as its physical one. A box with no such relation stands at the top'),
    prune: z.array(z.string()).optional().describe('Types drawn only when something sits inside them'),
    names: z.record(z.string(), z.string()).optional().describe('Observed type to the singular word its counts use, for example hv_vm: VM'),
    health: z.string().optional().describe('Fact whose value red or amber colors the box'),
    closed: z.array(z.string()).optional().describe('Types whose boxes start closed in the generated views and open on click; default the type just outside the innermost one'),
    relations: z.array(ObserveRelationSchema).optional().describe('Observed relations drawn as arrows between generated boxes: a label, or { label, color, only }'),
    group: z.string().optional().describe('Picker group of every view this block adds; failure views go under "<group> / Failure domains"'),
    view: ObserveViewSchema.optional().describe('Add a placement view of this node'),
    failure: ObserveFailureSchema.optional().describe('Add one view per failure domain: what its loss takes down'),
    boundary: ObserveBoundarySchema.optional().describe('Color the innermost boxes by the policies that apply to them and add a boundaries view that lists the gaps'),
  })
  .strict();

export type Observe = z.output<typeof ObserveSchema>;
