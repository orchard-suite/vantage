/**
 * Open items: what is open against a real thing right now (an issue, a
 * firing alert, a pull request, an incident). A connector reports them;
 * the hub overlay copies the ones that point at a bound node onto it.
 * Authors never write them.
 */
import { z } from 'zod';

import { OPEN_ITEM_KINDS, ITEM_SEVERITIES } from './open-items.ts';

export * from './open-items.ts';

/** One open item on a node, as the overlay leaves it. */
export const NodeOpenItemSchema = z
  .object({
    kind: z.enum(OPEN_ITEM_KINDS),
    title: z.string(),
    url: z.string().optional().describe('Where the source shows the item'),
    severity: z.enum(ITEM_SEVERITIES).optional(),
    status: z.string().optional().describe('The source\'s own word for where it stands, for example In Progress or draft'),
    updated: z.string().optional().describe('ISO time the source last changed it'),
    source: z.string().describe('Connector source id that reported it'),
    observed: z.string().describe('ISO time the source last reported it'),
    stale: z.boolean().optional().describe('True when the last report is older than the freshness threshold'),
  })
  .strict();

export type NodeOpenItem = z.output<typeof NodeOpenItemSchema>;
