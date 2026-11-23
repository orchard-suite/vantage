/**
 * The local tools an agent uses to write, check, and look at diagrams.
 * Registered on any McpServer: the stdio server for a laptop, and the hub,
 * where `files: false` removes every path argument so the server's own
 * disk is never reachable.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { formatDiagnostic } from '@vantage/model';
import { formatReport, importFile, searchIcons, type TitleBlock, type Validation } from '@vantage/server';
import { DOCUMENT_ADDRESS, OUTLINE, READ } from './verbs.ts';
import { guideOutline, guidePart, schemaOutline, schemaPart } from './guide-text.ts';
import { inlineEngine, type LocalEngine } from './engine.ts';
import { drawnContent, type DocumentArgs, type Drawn, type DrawOutcome, type ViewArgs } from './draw.ts';

export interface LocalToolOptions {
  /** Allow `file` and `out` arguments that touch the local filesystem. */
  readonly files: boolean;
  /** Where rendering, exploring, validating, and exporting run; defaults to this process. */
  readonly engine?: LocalEngine;
  /** Draws and checks a document the hub holds, named by its address, so no tool is sent text the hub already has. */
  readonly saved?: SavedDocuments;
}

type ToolAnswer = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } })[]; isError?: boolean };

/** A saved document drawn, or the hub's refusal as it answered it. */
export type SavedDrawing = { readonly drawn: Drawn } | { readonly refused: ToolAnswer };

/** How the tools that draw and check reach a saved document: the hub draws its own copy, with its imports, pictures, and workspace icons. */
export interface SavedDocuments {
  /** Its YAML, for a tool that only lays it out. */
  text(address: string): Promise<string>;
  validate(address: string): Promise<ToolAnswer>;
  drawView(address: string, args: ViewArgs): Promise<SavedDrawing>;
  drawDocument(address: string, args: DocumentArgs): Promise<SavedDrawing>;
}

const TOPIC = 'For anything else at an address, sign in to a hub: vantage login <hub url>.';

/** The guide and the schema by part, for a laptop with no hub: the two addresses that need none. */
export function registerGuideDoor(server: McpServer): void {
  const answer = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError } : {}) });
  const part = (address: string): string | undefined => {
    const [head, name] = address.split('#');
    if (head !== 'guide' && head !== 'schema') return undefined;
    if (!name) return head === 'guide' ? guideOutline() : schemaOutline();
    return (head === 'guide' ? guidePart(name) : schemaPart(name)) ?? `${head} has no part ${name}; vantage_outline ${head} lists them`;
  };
  server.registerTool(OUTLINE.name, { description: OUTLINE.description, inputSchema: OUTLINE.shape }, async ({ address }) => {
    if (address === 'guide') return answer(guideOutline());
    if (address === 'schema') return answer(schemaOutline());
    return answer(`This machine is not signed in to a hub, so the addresses here are guide and schema. ${TOPIC}`, address !== undefined);
  });
  server.registerTool(READ.name, { description: READ.description, inputSchema: READ.shape }, async ({ addresses }) => {
    const parts = addresses.map((a) => `=== ${a} ===\n${part(a) ?? `not reachable without a hub. ${TOPIC}`}`);
    return answer(parts.join('\n\n'));
  });
}

export function validationSummary(v: Validation): string {
  const lines = v.diagnostics.map(formatDiagnostic);
  for (const view of v.views) {
    lines.push(`${view.id}${view.hidden ? ' (part)' : ''}: score ${view.metrics.score}, ${view.width}x${view.height}, crossings ${view.metrics.crossings}, through boxes ${view.metrics.edgeBoxCrossings}, label overlaps ${view.metrics.labelOverlaps}`);
    for (const n of view.metrics.notes) lines.push(`  - ${n}`);
  }
  lines.push(v.ok ? `ok: ${v.nodes} nodes, ${v.relations} relations, ${v.views.length} views` : 'errors found; fix them before rendering');
  return lines.join('\n');
}

export const themeSchema = z.enum(['light', 'dark', 'print', 'colorblind']);

export const titleBlockSchema = z
  .object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    author: z.string().optional(),
    updated: z.string().optional(),
    version: z.string().optional(),
    link: z.string().optional(),
    published: z.string().optional().describe('Date for the "published" stamp'),
  })
  .describe('Header band above the picture');

type BlockInput = z.infer<typeof titleBlockSchema>;

/** Drops the undefined fields zod leaves behind so the block satisfies exact optional properties. */
export function compactBlock(b: BlockInput | undefined): TitleBlock | undefined {
  if (!b) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) if (v !== undefined) out[k] = v;
  return out as TitleBlock;
}

const fail = (diagnostics: readonly Parameters<typeof formatDiagnostic>[0][]) => ({ content: [{ type: 'text' as const, text: diagnostics.map(formatDiagnostic).join('\n') }], isError: true });

export function registerLocalTools(server: McpServer, opts: LocalToolOptions): void {
  const engine = opts.engine ?? inlineEngine;
  const saved = opts.saved;
  const source: { file?: z.ZodOptional<z.ZodString>; address?: typeof DOCUMENT_ADDRESS; text: z.ZodOptional<z.ZodString> } = {
    ...(opts.files ? { file: z.string().optional().describe('Absolute path of a .vantage.yaml file') } : {}),
    ...(saved ? { address: DOCUMENT_ADDRESS } : {}),
    text: z.string().optional().describe('Document text that is neither saved nor in a file'),
  };
  const out: { out?: z.ZodOptional<z.ZodString> } = opts.files ? { out: z.string().optional().describe('Also write the result to this absolute path') } : {};
  const write = (path: string | undefined, data: string | Uint8Array): void => {
    if (!path || !opts.files) return;
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(resolve(path), data);
  };
  const sourceOf = (args: { file?: string | undefined; text?: string | undefined }): { file?: string; text?: string } => ({ ...(args.file !== undefined ? { file: args.file } : {}), ...(args.text !== undefined ? { text: args.text } : {}) });
  /** A drawn file as the answer: written to `out` with only its notes answered, or sent in the answer. */
  const present = (r: DrawOutcome | SavedDrawing, path: string | undefined): ToolAnswer => {
    if ('refused' in r) return r.refused;
    if (!r.drawn) return fail('diagnostics' in r ? r.diagnostics : []);
    if (path && opts.files) {
      write(path, r.drawn.bytes);
      return { content: [{ type: 'text', text: `${r.drawn.notes}\nwrote ${resolve(path)}` }] };
    }
    return { content: drawnContent(r.drawn) };
  };

  server.registerTool(
    'vantage_validate',
    {
      description: 'Check a document and lay out every view: problems with their lines, and a score with notes per view. It keeps nothing.',
      inputSchema: source,
    },
    async (args) => {
      if (saved && args.address) return saved.validate(args.address);
      const v = await engine.validate(args);
      return { content: [{ type: 'text', text: validationSummary(v) }], isError: !v.ok };
    },
  );

  server.registerTool(
    'vantage_render',
    {
      description: opts.files
        ? 'Draw one view and answer its score and notes. With out, the picture is written to that path and not sent; without it, the PNG comes back to look at. It keeps nothing. svg answers the markup; pdf, drawio, and vsdx a one-page document.'
        : 'Draw one view to a PNG you can look at, with its score and notes. It keeps nothing. svg answers the markup; pdf, drawio, and vsdx a one-page document.',
      inputSchema: {
        ...source,
        view: z.string().optional().describe('View id; defaults to the first view'),
        format: z.enum(['png', 'svg', 'pdf', 'drawio', 'vsdx']).default('png'),
        theme: themeSchema.optional(),
        scale: z.number().min(0.5).max(4).optional().describe('PNG pixel scale; 1 is the layout size, default 1.5'),
        titleBlock: titleBlockSchema.optional(),
        transparent: z.boolean().optional().describe('Leave the canvas unpainted (png, svg)'),
        ...out,
      },
    },
    async (args) => {
      const req: ViewArgs = { view: args.view, format: args.format, theme: args.theme, scale: args.scale, titleBlock: compactBlock(args.titleBlock), transparent: args.transparent };
      if (saved && args.address) return present(await saved.drawView(args.address, req), args.out);
      return present(await engine.drawView({ ...sourceOf(args), ...req }), args.out);
    },
  );

  server.registerTool(
    'vantage_explore',
    {
      description: 'Lay one relation view out several ways (direction, gesture of the biggest container, a collapse) and see them side by side with scores. Pick by eye, then paste the hints of the one you like into the view. Use it when a view looks mechanical or scores low.',
      inputSchema: {
        ...source,
        view: z.string().optional().describe('Relation view id; defaults to the first relation view'),
        limit: z.number().int().min(2).max(6).optional().describe('How many candidates to show; default 4'),
        theme: themeSchema.optional(),
        ...out,
      },
    },
    async (args) => {
      const r = await engine.explore(saved && args.address ? { ...args, text: await saved.text(args.address) } : args);
      if (!r.result) return fail(r.diagnostics);
      write(args.out, r.result.png);
      const text = r.result.candidates
        .map((c, i) => `${String.fromCharCode(65 + i)}. ${c.name}: score ${c.score}, ${c.width}x${c.height}${c.notes.length ? `\n   notes: ${c.notes.join('; ')}` : ''}\n   hints:\n${c.yaml.split('\n').map((l) => `     ${l}`).join('\n')}`)
        .join('\n');
      return { content: [{ type: 'image', data: Buffer.from(r.result.png).toString('base64'), mimeType: 'image/png' }, { type: 'text', text }] };
    },
  );

  server.registerTool(
    'vantage_export',
    {
      description: opts.files
        ? 'Write the whole document to one file: html (interactive viewer with every view, the picker, hover, focus, and walkthroughs), pdf (one view per page), drawio, or vsdx.'
        : 'The whole document as one file: html (interactive viewer with every view), pdf (one view per page), drawio, or vsdx.',
      inputSchema: {
        ...source,
        ...(opts.files ? { out: z.string().describe('Absolute path of the file to write') } : {}),
        format: z.enum(['html', 'pdf', 'drawio', 'vsdx']).default('html'),
        views: z.array(z.string()).optional().describe('View ids to include, in order; default every view (pdf, drawio, vsdx)'),
        theme: themeSchema.optional(),
        titleBlock: z.union([z.literal(true), titleBlockSchema]).optional().describe('Title block on every page; true fills it from the document (pdf)'),
        page: z.enum(['A4', 'Letter', 'A3', 'fit']).optional().describe('PDF page size; default A4'),
        orientation: z.enum(['auto', 'portrait', 'landscape']).optional().describe('PDF orientation; default auto'),
      },
    },
    async (args) => {
      const req: DocumentArgs = { format: args.format, views: args.views, theme: args.theme, titleBlock: args.titleBlock === true ? true : compactBlock(args.titleBlock), page: args.page, orientation: args.orientation };
      if (saved && args.address) return present(await saved.drawDocument(args.address, req), args.out);
      return present(await engine.drawDocument({ ...sourceOf(args), ...req }), args.out);
    },
  );

  if (opts.files) {
    server.registerTool(
      'vantage_import',
      {
        description: 'Turn a drawing or diagram source into a Vantage document: draw.io (.drawio, .xml), Visio (.vsdx; Lucidchart exports it), Ilograph, Mermaid (.mmd, .mermaid), PlantUML (.puml, .plantuml, .pu, .iuml), or Markdown with mermaid or plantuml blocks. Drawings keep their layout as pins; text formats are laid out by the engine. The report lists hints, unlabelled relations, and what was dropped. Read the guide section on importing first.',
        inputSchema: {
          file: z.string().describe('Absolute path of the file'),
          page: z.number().int().min(0).optional().describe('Import one page, counting from 0; default every page'),
          out: z.string().optional().describe('Directory to write <name>.vantage.yaml and <name>.original.<ext> into'),
        },
      },
      async ({ file, page, out: dir }) => {
        const r = importFile({ file, out: dir, pageIndex: page });
        const report = formatReport(r.report);
        const written = r.written ? `\nwrote ${[r.written.document, r.written.original, ...r.written.assets].join(', ')}` : '';
        return { content: [{ type: 'text', text: r.yaml }, { type: 'text', text: report + written }], isError: r.report.diagnostics.some((d) => d.severity === 'error') };
      },
    );
  }

  server.registerTool(
    'vantage_icons',
    {
      description: 'Search icon ids. Packs: generic (Lucide), azure, aws, k8s, brand. Use the id as a node icon, for example azure/aks.',
      inputSchema: { query: z.string().describe('Words that should appear in the id'), pack: z.enum(['generic', 'azure', 'aws', 'k8s', 'brand']).optional(), limit: z.number().int().max(200).optional() },
    },
    async ({ query, pack, limit }) => ({ content: [{ type: 'text', text: searchIcons(query, pack, limit ?? 60).join('\n') || 'no matches' }] }),
  );
}
