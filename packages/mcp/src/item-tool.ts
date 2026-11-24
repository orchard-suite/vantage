/**
 * The one tool an agent acts on tracked items with (VAN-5001):
 * move, hold, release, place, note, attach, and link, many in one call. Reading an
 * item, listing a kind, and changing an item's title, labels, or body are
 * the five verbs. Each action commits alone and answers one line. The door
 * makes the key that keeps a resent action from landing twice; a model
 * never writes one.
 */
import { z } from 'zod';

const link = z.object({
  rel: z.enum(['came-from', 'part-of', 'waits-on', 'toward', 'box', 'view', 'decision', 'proof', 'adds', 'changes', 'retires']),
  target: z.string().describe('An item (VAN-3), workspace/document#box-or-view, or a record (SHOP-2001). proof: an item, or a box a connector should see. toward: a milestone'),
});

const action = {
  item: z.string().describe('The item: its key (VAN-12), or its kind and your own key (VAN:forms/1842)'),
  move: z.string().optional().describe('The state to move to. A refusal names the moves open to you'),
  note: z.string().optional().describe('A note; with move, the note the move carries'),
  revision: z.string().optional().describe('With move: the content revision the move is about'),
  hold: z.string().optional().describe('me, or a person by email'),
  release: z.string().optional().describe('me, or a person by email'),
  link: link.optional(),
  unlink: link.optional(),
  place: z
    .union([z.enum(['first', 'last']), z.object({ before: z.string() }).strict(), z.object({ after: z.string() }).strict()])
    .optional()
    .describe('Put the item in order among its kind in its horizon: first, last, or beside another item there'),
  claim: z.union([z.boolean(), z.number().int().min(1).max(240)]).optional().describe('Take the item for a while (true: 20 minutes, or a number of minutes); any call you make on it renews the claim'),
  renew: z.boolean().optional().describe('Keep your claim; the laptop does this for you while you work'),
  finish: z
    .object({
      move: z.string().optional().describe('The state to move to as the run ends'),
      summary: z.string().describe('What the run did'),
      proof: z.array(z.string()).optional().describe('Where the work can be checked: commits, releases, links, items'),
      handoff: z.string().optional().describe('What the next run must know'),
      seconds: z.number().optional(),
      cost: z.object({ amount: z.number(), currency: z.string(), tokens: z.number().optional() }).optional().describe('What the run cost, as its runtime reported it'),
    })
    .optional()
    .describe('End the run in one action: its record, its move, and letting the item go'),
  ask: z.string().optional().describe('A question for a person; the item waits for the answer'),
  key: z.string().max(200).optional().describe('Set by the door; leave it out'),
};

export const ITEM = {
  name: 'vantage_item',
  description:
    'Act on tracked items: claim one, move it, ask a person a question on it, finish a run on it, hold or release it, place it in order, note, attach, or link, several actions in one call, each landing alone with one line. Read an item with vantage_read VAN-12 (its moves open to you are in its card); change its title, labels, or body with vantage_patch.',
  shape: {
    actions: z
      .array(z.object({ ...action, attach: z.object({ name: z.string(), data: z.string().describe('The file in base64'), contentType: z.string().optional() }).optional() }).strict())
      .min(1)
      .max(20),
  },
  /** On a laptop a file is given by its path, and the bridge sends its bytes. */
  laptopShape: {
    actions: z
      .array(z.object({ ...action, attach: z.object({ file: z.string().describe('Absolute path of the file on this machine'), contentType: z.string().optional() }).optional() }).strict())
      .min(1)
      .max(20),
  },
};

export const ROADMAP_IMPORT = {
  name: 'vantage_roadmap_import',
  description:
    'Bring a roadmap kept in Markdown into a kind: a table with an outcome column (and horizon, owner, status), or bullets under Now, Next, and Later headings. Each row becomes an item; a row marked done comes in reported done. On a machine with a disk give file, the path; the text never passes through you. Running it again makes nothing twice. dryRun: true says what it would make.',
  shape: { kind: z.string().describe('The kind\'s prefix'), text: z.string().max(500_000).describe('The Markdown'), dryRun: z.boolean().optional() },
  laptopShape: { kind: z.string().describe('The kind\'s prefix'), file: z.string().describe('Absolute path of the Markdown file'), dryRun: z.boolean().optional() },
};

export const QUEUE = {
  name: 'vantage_queue',
  description: 'What you may pick up: items not done, not waiting for a person, and not claimed by another run, oldest first, each with what to read first (addresses and sizes) and the last handoff note. Then claim one with vantage_item.',
  shape: { kinds: z.array(z.string()).optional().describe('Kind prefixes to look in; every kind you may work when left out'), limit: z.number().int().min(1).max(20).optional() },
};
