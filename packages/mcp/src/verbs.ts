/**
 * The five verbs every kind of content is reached through, as an agent
 * sees them: their names, their one or two sentences, and their arguments.
 * The hub answers them; the laptop bridge lists the same tools and adds a
 * path beside each content argument. One definition, so the two doors
 * cannot drift.
 */
import { z } from 'zod';

const ADDRESS = 'workspace/document, workspace/document/pages/x.md, SHOP-2001, SHOP (a registry), a workspace, guide, or schema';

export const OUTLINE = {
  name: 'vantage_outline',
  description:
    'What is at an address, as names and sizes, never the text: a workspace\'s documents, a document\'s views, boxes, and pages, a page\'s headings, a record\'s sections, a registry\'s records, the guide\'s topics. Start here, then vantage_find a line or vantage_read one part (address#part), then vantage_patch.',
  shape: { address: z.string().optional().describe(`${ADDRESS}. Leave it out for your workspaces and registries.`) },
};

export const FIND = {
  name: 'vantage_find',
  description: 'The lines that match, each as address:line: text, ready to read around or to patch. Searches everything you may see, or one address.',
  shape: {
    query: z.string().min(1).describe('Words that must all be on the line, or a pattern with regex: true'),
    in: z.string().optional().describe(`Where to look: ${ADDRESS}`),
    regex: z.boolean().optional(),
    count: z.boolean().optional().describe('Answer how many lines match in each thing, not the lines'),
  },
};

export const READ = {
  name: 'vantage_read',
  description:
    'The text of one or many addresses. Name a part after #: a heading (SHOP-2001#decision), a YAML path (workspace/document#views.context, #nodes.orders-api), or lines (#L120-180). An answer past its size limit stops at a line and names the call that reads on.',
  shape: {
    addresses: z.array(z.string().min(1)).min(1).max(20),
    held: z.record(z.string(), z.string()).optional().describe('Address to the version you already hold; one that has not changed answers a line'),
  },
};

const EDIT = z.object({
  address: z.string().min(1).describe('The thing, or one part of it, to change'),
  old: z.string().optional().describe('Text to replace, exactly as it stands; it must be there once'),
  new: z.string().optional().describe('The text that takes its place; empty removes it'),
  all: z.boolean().optional().describe('Replace every occurrence of old'),
  op: z.enum(['set', 'add', 'remove']).optional().describe('For a document\'s YAML, a change by path in place of old and new'),
  path: z.string().optional().describe('nodes.api.subtitle, views.context.title, relations.0: an item is found by its id, a node also by the slug of its name'),
  value: z.unknown().optional(),
});
export type Edit = z.infer<typeof EDIT>;

export const PATCH = {
  name: 'vantage_patch',
  description:
    'Change saved things by sending only what changes. Each edit swaps one exact string in a document\'s YAML, a page, or a record, with no read first; or sets, adds, or removes by path in YAML. Put every edit in one call: edits to one document and its pages save as one version, and each thing saves whole or not at all.',
  shape: {
    edits: z.array(EDIT).min(1).max(200),
    message: z.string().optional().describe('What changed and why, for the history'),
    minor: z.boolean().optional().describe('A wording fix to a record: its Last updated stays'),
  },
};

const text = z.string().describe('The whole text');

const WRITES = 'workspace/document takes YAML and makes the document when it is new (~ is your own workspace; ~ alone names it after its title). workspace/document/pages/x.md takes a page a doc view names. SHOP takes a new record and gives it its number; SHOP-2001 rewrites one.';
const MESSAGE = z.string().optional().describe('What changed and why, for the history');

/** Write's arguments on the hub: the text itself. */
export const WRITE_SHAPE = {
  writes: z.array(z.object({ address: z.string().min(1), text })).min(1).max(100).describe(WRITES),
  assets: z.record(z.string(), z.string()).optional().describe('Pictures the YAML or a page names: the path as written there, to its bytes in base64'),
  message: MESSAGE,
};

/** Write's arguments on a laptop: a path stands for any content. */
export const WRITE_SHAPE_FILES = {
  writes: z
    .array(z.object({ address: z.string().min(1), text: text.optional(), file: z.string().optional().describe('Absolute path of the file that holds the text; give this, not text, when the text is on disk') }))
    .min(1)
    .max(100)
    .describe(WRITES),
  assets: z.record(z.string(), z.string()).optional().describe('Pictures the YAML or a page names: the path as written there, to the absolute path of the file on disk'),
  message: MESSAGE,
};

export const WRITE = {
  name: 'vantage_write',
  description: 'Write the whole text of new things, or rewrite one. A document and its pages in one call save as one version. For a change to something saved, use vantage_patch.',
};

/** The argument that names a saved document on the tools that draw and check. */
export const DOCUMENT_ADDRESS = z.string().optional().describe('A saved document, workspace/document; the hub reads its own copy');
