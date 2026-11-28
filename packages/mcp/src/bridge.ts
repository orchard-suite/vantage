/**
 * The laptop's door. One MCP server that speaks for the disk and for a
 * hub: the tools that draw and check files run here; every tool the hub
 * has is passed to it with this machine's token; and wherever a tool takes
 * content, this door takes a path and sends the bytes itself, so no file
 * passes through the model. When the hub cannot be reached the local
 * tools keep working and a hub call answers with the reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ITEM, ROADMAP_IMPORT } from './item-tool.ts';
import { WORKSPACE_ICONS, iconFormatOf } from './icon-tool.ts';
import { basename, join, resolve } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { HubLink } from './hub.ts';
import { CORE, LAPTOP_CORE } from './catalog.ts';
import { createFront, firstOf, inProcess, type Backend, type CallMeasure } from './front.ts';
import { agentInstructions } from './instructions.ts';
import { registerGuideDoor, registerLocalTools, type SavedDocuments, type SavedDrawing } from './tools.ts';
import { drawnFrom } from './draw.ts';
import { WRITE, WRITE_SHAPE_FILES } from './verbs.ts';
import { checkout, sync, type Listed, type Result, type TextApi } from './workcopy.ts';

export interface BridgeOptions {
  /** Where bridge events go; stdout belongs to the protocol, so the CLI passes stderr. */
  readonly log?: (line: string) => void;
  /** Connects to the hub with the headers every call carries; tests hand in an in-process one. */
  readonly connectHub?: (link: HubLink, headers: Readonly<Record<string, string>>) => Promise<Client>;
  /** Reaches the hub's HTTP API; tests hand in the app's own. */
  readonly fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /** List every tool and leave vantage_tool out. */
  readonly all?: boolean;
  readonly onCall?: (m: CallMeasure) => void;
  /** How often the bridge renews the claims its session holds; tests shorten it. Default every five minutes. */
  readonly renewEveryMs?: number;
}

const BRIDGE_VERSION = '1.0.0';
/** The header that names this session's run on every call (VAN-2009), so a claim belongs to this run alone. */
export const RUN_HEADER = 'x-vantage-run';
const answer = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

type Reply = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };
/** A hub answer as the local tools hand it on: its text and its pictures. */
function reply(r: CallToolResult): Reply {
  const content: Reply['content'] = [];
  for (const c of r.content) {
    if (c.type === 'text') content.push({ type: 'text', text: c.text });
    else if (c.type === 'image') content.push({ type: 'image', data: c.data, mimeType: c.mimeType });
  }
  return { content, ...(r.isError ? { isError: true } : {}) };
}

/** The server for a laptop with no hub: the tools that work on files, and the guide. */
export function createLocalDoor(opts: Pick<BridgeOptions, 'all' | 'onCall'> = {}): Server {
  const tools = new McpServer({ name: 'vantage-local', version: BRIDGE_VERSION });
  registerLocalTools(tools, { files: true });
  registerGuideDoor(tools);
  return createFront(inProcess(tools), { name: 'vantage', version: BRIDGE_VERSION, instructions: agentInstructions({ laptop: false }), core: CORE, all: opts.all, onCall: opts.onCall });
}

export async function createBridge(link: HubLink, opts: BridgeOptions = {}): Promise<Server> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const connectHub = opts.connectHub ?? connectHttpHub;
  const fetchHub = opts.fetch ?? fetch;
  // One run per session: the claims it takes are its own, and another session for the same person is refused them.
  const run = randomUUID();
  const sent = { [RUN_HEADER]: run };
  let hub: Client | undefined;

  const hubClient = async (): Promise<Client> => {
    if (hub) return hub;
    hub = await connectHub(link, sent);
    log(`vantage: connected to hub ${link.url} as run ${run}`);
    return hub;
  };
  const callHub = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    try {
      return (await (await hubClient()).callTool({ name, arguments: args })) as CallToolResult;
    } catch (err) {
      hub = undefined;
      const message = `the hub at ${link.url} did not answer ${name}: ${(err as Error).message}`;
      log(`vantage: ${message}`);
      return answer(`${message}. If the token was revoked, run: vantage login ${link.url}`, true);
    }
  };
  const hubBackend: Backend = {
    async listTools(): Promise<Tool[]> {
      try {
        return (await (await hubClient()).listTools()).tools;
      } catch (err) {
        hub = undefined;
        log(`vantage: hub ${link.url} unreachable, serving local tools only: ${(err as Error).message}`);
        return [];
      }
    },
    callTool: callHub,
  };

  const rest = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const res = await fetchHub(`${link.url}/api/v1${path}`, { method, headers: { authorization: `Bearer ${link.token}`, ...sent, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(`${res.status}: ${detail.message ?? detail.error ?? `the hub refused ${path}`}`);
    }
    return res;
  };
  const q = (address: string): string => `?address=${encodeURIComponent(address)}`;
  const api: TextApi = {
    list: async (address) => ((await (await rest('GET', `/text/list${q(address)}`)).json()) as { things: Listed[] }).things,
    read: async (address) => (await (await rest('GET', `/text/read${q(address)}`)).json()) as { address: string; version: string; text: string },
    file: async (address) => new Uint8Array(await (await rest('GET', `/text/file${q(address)}`)).arrayBuffer()),
    write: async (body) => ((await (await rest('POST', '/text/write', body)).json()) as { results: Result[] }).results,
  };

  /** The hub draws its own copy and answers the file; the bridge takes the bytes, so a path on this machine can receive them. */
  const drawnBy = async (tool: string, address: string, args: object, extension: string): Promise<SavedDrawing> => {
    const r = await callHub(tool, { address, ...args });
    const drawn = r.isError ? undefined : drawnFrom(r.content, extension);
    return drawn ? { drawn } : { refused: reply(r) };
  };
  const saved: SavedDocuments = {
    validate: async (address) => reply(await callHub('vantage_validate', { address })),
    drawView: (address, args) => drawnBy('vantage_render', address, args, args.format),
    drawDocument: (address, args) => drawnBy('vantage_export', address, args, args.format),
    drawExplore: (address, args) => drawnBy('vantage_explore', address, args, 'png'),
  };

  const laptop = new McpServer({ name: 'vantage-laptop', version: BRIDGE_VERSION });
  registerLocalTools(laptop, { files: true, saved });
  const guarded = async (run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try {
      return await run();
    } catch (err) {
      return answer((err as Error).message, true);
    }
  };

  laptop.registerTool(WRITE.name, { description: `${WRITE.description} Text that is on disk is given as its path.`, inputSchema: WRITE_SHAPE_FILES }, (args) =>
    guarded(async () => {
      const writes = args.writes.map((w) => {
        if (w.file === undefined && w.text === undefined) throw new Error(`${w.address}: give text, or file with the path of the text`);
        return { address: w.address, text: w.file !== undefined ? readFileSync(resolve(w.file), 'utf8') : w.text! };
      });
      const assets = args.assets ? Object.fromEntries(Object.entries(args.assets).map(([name, path]) => [name, readFileSync(resolve(path)).toString('base64')])) : undefined;
      return callHub(WRITE.name, { writes, ...(assets ? { assets } : {}), ...(args.message ? { message: args.message } : {}) });
    }),
  );

  // The claims this session holds: the bridge renews them while it lives, so a claim never costs the model a turn, and lets them run out when it stops.
  const claims = new Set<string>();
  const renewTimer = setInterval(() => {
    if (!claims.size) return;
    void callHub(ITEM.name, { actions: [...claims].map((item) => ({ item, renew: true, key: randomUUID() })) })
      .then((r) => {
        const text = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
        for (const item of [...claims]) if (text.includes(`no claim on ${item}`)) claims.delete(item);
        opts.log?.(`renewed ${claims.size} claim(s)`);
      })
      .catch((err: unknown) => opts.log?.(`renewing claims failed: ${(err as Error).message}`));
  }, opts.renewEveryMs ?? 5 * 60_000);
  renewTimer.unref?.();
  laptop.registerTool(ITEM.name, { description: `${ITEM.description} A file to attach is given by its path.`, inputSchema: ITEM.laptopShape }, (args) =>
    guarded(async () => {
      // The bridge makes each action's key, so a call it sends again lands once.
      const actions = args.actions.map(({ attach, ...a }) => ({
        ...a,
        key: a.key ?? randomUUID(),
        ...(attach ? { attach: { name: basename(attach.file), data: readFileSync(resolve(attach.file)).toString('base64'), ...(attach.contentType ? { contentType: attach.contentType } : {}) } } : {}),
      }));
      const r = await callHub(ITEM.name, { actions });
      const lines = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n').split('\n');
      for (const a of args.actions) {
        const said = lines.find((l) => l.startsWith(`${a.item} `)) ?? '';
        if (a.claim && said.includes('is claimed by you')) claims.add(a.item);
        if ((a.finish || a.release === 'me') && !said.includes(': ')) claims.delete(a.item);
      }
      return r;
    }),
  );

  laptop.registerTool(WORKSPACE_ICONS.name, { description: `${WORKSPACE_ICONS.description} A picture to put is given by its path.`, inputSchema: WORKSPACE_ICONS.laptopShape }, ({ file, format, ...args }) =>
    guarded(async () => {
      if (!file) return callHub(WORKSPACE_ICONS.name, { ...args, ...(format ? { format } : {}) });
      const as = format ?? iconFormatOf(file);
      if (!as) return answer(`${basename(file)} is not a picture an icon can be; give format, or a file ending in .svg, .png, .jpg, .gif, or .webp`, true);
      return callHub(WORKSPACE_ICONS.name, { ...args, format: as, data: readFileSync(resolve(file)).toString('base64') });
    }),
  );

  laptop.registerTool(ROADMAP_IMPORT.name, { description: ROADMAP_IMPORT.description, inputSchema: ROADMAP_IMPORT.laptopShape }, ({ kind, file, dryRun }) =>
    guarded(async () => callHub(ROADMAP_IMPORT.name, { kind, text: readFileSync(resolve(file), 'utf8'), ...(dryRun ? { dryRun } : {}) })),
  );

  laptop.registerTool(
    'vantage_decision_import',
    {
      description: 'Bring Markdown decision records from a folder on this machine into a registry. Every record keeps its number, dates, status, decision makers, and supersede links. The answer lists each file with its new citation, and everything that could not be mapped. dryRun: true reports and writes nothing; running it again skips records already there.',
      inputSchema: {
        registry: z.string(),
        dir: z.string().describe('Absolute path of the folder that holds the .md records'),
        dryRun: z.boolean().optional(),
      },
    },
    ({ registry, dir, dryRun }) =>
      guarded(async () => {
        const root = resolve(dir);
        const files = readdirSync(root)
          .filter((name) => /\.md$/i.test(name) && statSync(join(root, name)).isFile())
          .sort()
          .map((name) => ({ path: basename(name), text: readFileSync(join(root, name), 'utf8') }));
        if (!files.length) return answer(`${root} holds no .md files`, true);
        return callHub('vantage_decision_import', { registry, files, ...(dryRun ? { dryRun } : {}) });
      }),
  );

  laptop.registerTool(
    'vantage_checkout',
    {
      description: 'Write a document, a registry, a record, or a workspace from the hub into a folder as files, to edit with your own read, search, and edit tools. Then vantage_sync the folder. Use it for any change of more than a line or two.',
      inputSchema: { address: z.string().describe('workspace/document, SHOP, SHOP-2001, or a workspace'), dir: z.string().describe('Absolute path of the folder; it is made when missing') },
    },
    ({ address, dir }) => guarded(async () => answer(await checkout(api, link.url, address, dir))),
  );

  laptop.registerTool(
    'vantage_sync',
    {
      description: 'Send what changed in a working copy to the hub and bring back what changed there. One line per thing saved; a conflict is written into the file between markers, to fix and sync again. New pages and pictures in a document folder, and new record files under decisions/<REGISTRY>/, are sent too.',
      inputSchema: { dir: z.string().describe('Absolute path of the folder vantage_checkout wrote'), message: z.string().optional().describe('What changed and why, for the history') },
    },
    ({ dir, message }) =>
      guarded(async () => {
        const r = await sync(api, link.url, dir, message);
        return answer(r.text, r.isError);
      }),
  );

  const guide = new McpServer({ name: 'vantage-guide', version: BRIDGE_VERSION });
  registerGuideDoor(guide);

  // The laptop's own tools answer first, then the hub's; the guide alone stays reachable when the hub is not.
  const backend = firstOf([inProcess(laptop), hubBackend, inProcess(guide)]);
  const front = createFront(backend, { name: 'vantage', version: BRIDGE_VERSION, instructions: agentInstructions({ laptop: true }), core: [...CORE, ...LAPTOP_CORE], all: opts.all, onCall: opts.onCall });
  // When the session ends the bridge stops renewing, and its claims run out on the hub.
  const closed = front.onclose;
  front.onclose = () => {
    clearInterval(renewTimer);
    closed?.();
  };
  return front;
}

async function connectHttpHub(link: HubLink, headers: Readonly<Record<string, string>>): Promise<Client> {
  // Every tool: this door decides what the agent is shown.
  const transport = new StreamableHTTPClientTransport(new URL(`${link.url}/mcp?tools=all`), { requestInit: { headers: { authorization: `Bearer ${link.token}`, ...headers } } });
  const client = new Client({ name: 'vantage-bridge', version: BRIDGE_VERSION });
  await client.connect(transport);
  return client;
}
