/**
 * The agent cost benchmark: fixed tasks run against the hub and against a
 * disk, counted in characters and calls. A task's budget is its disk cost:
 * what an agent pays to do the same thing to a local file with its own
 * search, read, and edit. The task list is data; a new kind of content
 * adds its tasks here in the commit that adds it.
 *
 * The disk is modelled the way an agent's file tools work: a search sends
 * a pattern and a path and answers path:line:text; a read sends a path
 * and a range and answers the lines numbered; an edit sends a path, the
 * old text, and the new text.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUDGET, headings } from '../../../packages/mcp/src/index.ts';
import { testApp, type TestApp } from '../../../packages/hub/src/testing.ts';
import { agent, laptop, type Agent, type Laptop } from '../../../packages/hub/src/mcp/testing.ts';

export interface Cost {
  readonly in: number;
  readonly out: number;
  readonly calls: number;
}

const total = (c: Cost): number => c.in + c.out;
const size = (v: unknown): number => JSON.stringify(v).length;

/** Where the same content would sit on a disk. */
const DISK = '/work/project/docs';

export const disk = {
  search(path: string, pattern: string, text: string): Cost {
    const hits = text.split('\n').flatMap((l, i) => (l.toLowerCase().includes(pattern.toLowerCase()) ? [`${path}:${i + 1}:${l}`] : []));
    return { in: size({ pattern, path }), out: hits.join('\n').length, calls: 1 };
  },
  read(path: string, text: string, from: number, to: number): Cost {
    const lines = text.split('\n').slice(from - 1, to).map((l, i) => `${from + i}\t${l}`);
    return { in: size({ file_path: path, offset: from, limit: to - from + 1 }), out: lines.join('\n').length, calls: 1 };
  },
  edit(path: string, old: string, next: string): Cost {
    return { in: size({ file_path: path, old_string: old, new_string: next }), out: `The file ${path} has been updated.`.length, calls: 1 };
  },
};

const sum = (...cs: Cost[]): Cost => ({ in: cs.reduce((s, c) => s + c.in, 0), out: cs.reduce((s, c) => s + c.out, 0), calls: cs.reduce((s, c) => s + c.calls, 0) });

export interface Fixture {
  readonly t: TestApp;
  readonly hub: Agent;
  readonly hubHeaders: Record<string, string>;
  readonly laptop: Laptop;
  readonly ws: string;
  readonly yaml: string;
  readonly page: string;
  readonly record: string;
  readonly item: string;
  readonly dir: string;
}

const EXAMPLE = join(import.meta.dir, '..', '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');

/** A page the size of a real specification: about 25,000 characters in 60 sections. */
function bigPage(): string {
  const out = ['# Storefront runbook', ''];
  for (let i = 1; i <= 60; i++) out.push(`## Step ${i}: check lane ${i}`, '', `Lane ${i} carries orders from the storefront to the warehouse. `.repeat(5).trim(), '', `- Owner: team ${i % 7}`, `- Window: ${i % 24}:00 to ${(i + 2) % 24}:00`, `- Rollback for lane ${i}: switch the route back and tell the channel.`, '');
  return out.join('\n');
}

const RECORD = `---
title: Orders go through one API
status: accepted
category: 2
decided: 2026-11-01
deciders: [The maintainers]
---

## Context

${'Two apps wrote to the orders store, and their rules drifted apart. '.repeat(12).trim()}

## Decision

Only the Shop API writes orders. Every other system reads a copy.

${'A system that needs a new field asks the API for it. '.repeat(10).trim()}

## Consequences

${'There is one writer, and one more hop for every other system. '.repeat(8).trim()}
`;

const KIND = `title: Shop work
kind:
  prefix: SW
  name: Shop work
  base: work-item
views: []
`;

const ROADMAP = `title: Shop roadmap
kind: { prefix: SHIP, name: Shop roadmap, base: roadmap-item }
views: []
`;

/** The same roadmap as a Markdown table on a disk: what an agent edits there to move one item. */
const ROADMAP_TABLE = ['| Outcome | Horizon | Owner |', '|---|---|---|', ...Array.from({ length: 20 }, (_, i) => `| Outcome ${i + 1}: the shop answers lane ${i + 1} from the cache | ${i < 5 ? 'now' : i < 12 ? 'next' : 'later'} | team ${i % 4} |`)].join('\n');

/** An item the size of a real piece of work: a title, a few labels, and a body of a dozen short sections. */
function itemBody(): string {
  const out = ['---', 'title: Cache the price list', '---', ''];
  for (let i = 1; i <= 12; i++) out.push(`## Part ${i}`, '', `Part ${i} of the work keeps the price list warm for lane ${i}. `.repeat(3).trim(), '');
  out.push('## Done when', '', 'The price list answers from the cache in under 50 ms.');
  return out.join('\n');
}

export async function fixture(): Promise<Fixture> {
  const t = await testApp();
  const me = await t.bearer('agent');
  const hub = await agent(t, me.headers);
  const lap = await laptop(t, { url: 'http://hub.test', token: me.token });
  const base = readFileSync(EXAMPLE, 'utf8');
  const yaml = `${base.trimEnd()}\n  - id: runbook\n    kind: doc\n    title: Runbook\n    file: pages/runbook.md\n`;
  const page = bigPage();
  const saved = await hub.call('vantage_write', { writes: [{ address: '~/harbor', text: yaml }, { address: '~/harbor/pages/runbook.md', text: page }] });
  const ws = /saved (\S+)\/harbor version/.exec(saved)![1]!;
  await hub.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: ws, prefix: 'SHOP', name: 'Shop decisions' } });
  await hub.call('vantage_write', { writes: [{ address: 'SHOP', text: RECORD }] });
  const record = /=== SHOP-2001[^\n]*\n([\s\S]*)$/.exec(await hub.call('vantage_read', { addresses: ['SHOP-2001'] }))![1]!;
  await hub.call('vantage_write', { writes: [{ address: '~/shop-work', text: KIND }] });
  await hub.call('vantage_write', { writes: [{ address: 'SW', text: itemBody() }] });
  const item = /=== SW-1[^\n]*\n([\s\S]*)$/.exec(await hub.call('vantage_read', { addresses: ['SW-1'] }))![1]!;
  await hub.call('vantage_write', { writes: [{ address: '~/shop-roadmap', text: ROADMAP }] });
  for (let i = 1; i <= 20; i++) await hub.call('vantage_write', { writes: [{ address: 'SHIP', text: `---\ntitle: "Outcome ${i}: the shop answers lane ${i} from the cache"\nlabels:\n  horizon: ${i <= 5 ? 'now' : i <= 12 ? 'next' : 'later'}\n---\n\nLane ${i} answers from the cache in under 50 ms.` }] });
  return { t, hub, hubHeaders: me.headers, laptop: lap, ws, yaml, page, record, item, dir: mkdtempSync(join(tmpdir(), 'vantage-cost-')) };
}

export interface Task {
  readonly name: string;
  readonly kind: 'box' | 'view' | 'page' | 'record' | 'item' | 'roadmap';
  /** Does the task through the hub's door. */
  run(f: Fixture): Promise<unknown>;
  /** What the same task costs on a disk. */
  disk(f: Fixture): Cost;
}

const section = (text: string, slug: string): { from: number; to: number } => {
  const h = headings(text).find((x) => x.slug === slug)!;
  return { from: h.from, to: h.to };
};

/** The lines of one view of the YAML, found the way an agent would on a disk: by its id. */
function viewLines(yaml: string, id: string): { from: number; to: number } {
  const lines = yaml.split('\n');
  const from = lines.findIndex((l) => l.trim() === `- id: ${id}`) + 1;
  let to = from;
  while (to < lines.length && !/^  - /.test(lines[to]!) && !/^\S/.test(lines[to]!)) to += 1;
  return { from, to };
}

export const TASKS: readonly Task[] = [
  {
    name: 'find one fact in a document',
    kind: 'box',
    run: (f) => f.hub.call('vantage_find', { query: 'grp-harbor-product', in: `${f.ws}/harbor` }),
    disk: (f) => disk.search(`${DISK}/harbor.vantage.yaml`, 'grp-harbor-product', f.yaml),
  },
  {
    name: 'change one line of a box',
    kind: 'box',
    run: (f) => f.hub.call('vantage_patch', { edits: [{ address: `${f.ws}/harbor`, old: 'subtitle: grp-harbor-product', new: 'subtitle: grp-harbor-owners' }] }),
    disk: () => disk.edit(`${DISK}/harbor.vantage.yaml`, 'subtitle: grp-harbor-product', 'subtitle: grp-harbor-owners'),
  },
  {
    name: 'read one view',
    kind: 'view',
    run: (f) => f.hub.call('vantage_read', { addresses: [`${f.ws}/harbor#views.context`] }),
    disk: (f) => {
      const r = viewLines(f.yaml, 'context');
      return sum(disk.search(`${DISK}/harbor.vantage.yaml`, '- id: context', f.yaml), disk.read(`${DISK}/harbor.vantage.yaml`, f.yaml, r.from, r.to));
    },
  },
  {
    name: 'change one sentence on a long page',
    kind: 'page',
    run: (f) => f.hub.call('vantage_patch', { edits: [{ address: `${f.ws}/harbor/pages/runbook.md`, old: 'Rollback for lane 31: switch the route back and tell the channel.', new: 'Rollback for lane 31: switch the route back, then page the owner.' }] }),
    disk: () => disk.edit(`${DISK}/pages/runbook.md`, 'Rollback for lane 31: switch the route back and tell the channel.', 'Rollback for lane 31: switch the route back, then page the owner.'),
  },
  {
    name: 'read one section of a long page',
    kind: 'page',
    run: (f) => f.hub.call('vantage_read', { addresses: [`${f.ws}/harbor/pages/runbook.md#step-12-check-lane-12`] }),
    disk: (f) => {
      const r = section(f.page, 'step-12-check-lane-12');
      return sum(disk.search(`${DISK}/pages/runbook.md`, '## Step 12:', f.page), disk.read(`${DISK}/pages/runbook.md`, f.page, r.from, r.to));
    },
  },
  {
    name: 'change one sentence in a record',
    kind: 'record',
    run: (f) => f.hub.call('vantage_patch', { edits: [{ address: 'SHOP-2001', old: 'Every other system reads a copy.', new: 'Every other system reads a copy, refreshed each minute.' }] }),
    disk: () => disk.edit(`${DISK}/decisions/2001-orders-go-through-one-api.md`, 'Every other system reads a copy.', 'Every other system reads a copy, refreshed each minute.'),
  },
  {
    name: 'read one section of a record',
    kind: 'record',
    run: (f) => f.hub.call('vantage_read', { addresses: ['SHOP-2001#consequences'] }),
    disk: (f) => {
      const r = section(f.record, 'consequences');
      return sum(disk.search(`${DISK}/decisions/2001-orders-go-through-one-api.md`, '## Consequences', f.record), disk.read(`${DISK}/decisions/2001-orders-go-through-one-api.md`, f.record, r.from, r.to));
    },
  },
  {
    name: 'change one sentence in an item',
    kind: 'item',
    run: (f) => f.hub.call('vantage_patch', { edits: [{ address: 'SW-1', old: 'answers from the cache in under 50 ms.', new: 'answers from the cache in under 20 ms.' }] }),
    disk: () => disk.edit(`${DISK}/work/SW-1.md`, 'answers from the cache in under 50 ms.', 'answers from the cache in under 20 ms.'),
  },
  {
    name: 'read one section of an item',
    kind: 'item',
    run: (f) => f.hub.call('vantage_read', { addresses: ['SW-1#done-when'] }),
    disk: (f) => {
      const r = section(f.item, 'done-when');
      return sum(disk.search(`${DISK}/work/SW-1.md`, '## Done when', f.item), disk.read(`${DISK}/work/SW-1.md`, f.item, r.from, r.to));
    },
  },
  {
    name: "move one roadmap item's horizon",
    kind: 'roadmap',
    run: (f) => f.hub.call('vantage_patch', { edits: [{ address: 'SHIP-3', old: 'horizon: now', new: 'horizon: next' }] }),
    disk: () => disk.edit(`${DISK}/roadmap.md`, '| Outcome 3: the shop answers lane 3 from the cache | now |', '| Outcome 3: the shop answers lane 3 from the cache | next |'),
  },
  {
    name: "change one sentence of a roadmap item's outcome",
    kind: 'roadmap',
    run: (f) => f.hub.call('vantage_patch', { edits: [{ address: 'SHIP-3', old: 'in under 50 ms.', new: 'in under 20 ms.' }] }),
    disk: () => disk.edit(`${DISK}/roadmap.md`, 'answers lane 3 from the cache |', 'answers lane 3 from the cache in under 20 ms |'),
  },
  {
    name: 'read a roadmap as rows',
    kind: 'roadmap',
    run: (f) => f.hub.call('vantage_outline', { address: 'SHIP#now' }),
    disk: () => disk.read(`${DISK}/roadmap.md`, ROADMAP_TABLE, 1, 22),
  },
];

export interface Row {
  readonly name: string;
  readonly kind: string;
  readonly hub: Cost;
  readonly disk: Cost;
  /** The most the hub may cost: the disk, plus the fixed allowance for each call. */
  readonly budget: number;
  readonly ok: boolean;
}

export async function measureTasks(f: Fixture): Promise<Row[]> {
  const rows: Row[] = [];
  for (const task of TASKS) {
    f.hub.reset();
    await task.run(f);
    const hub = { ...f.hub.cost };
    const d = task.disk(f);
    const budget = total(d) + BUDGET.addressAllowance * d.calls;
    rows.push({ name: task.name, kind: task.kind, hub, disk: d, budget, ok: total(hub) <= budget && hub.calls <= d.calls });
  }
  return rows;
}

export interface Fixed {
  readonly name: string;
  readonly chars: number;
  readonly budget: number;
  readonly ok: boolean;
}

/** The tasks whose cost must not grow with what they move: a picture looked at, a file written by its path, a working copy synced. */
export async function measureFixed(f: Fixture): Promise<Fixed[]> {
  const out: Fixed[] = [];
  const fixed = (name: string, chars: number): void => void out.push({ name, chars, budget: BUDGET.addressAllowance * 2, ok: chars <= BUDGET.addressAllowance * 2 });

  f.hub.reset();
  await f.hub.client.callTool({ name: 'vantage_render', arguments: { address: `${f.ws}/harbor`, view: 'context' } });
  fixed('look at one view of a saved document: sent', size({ address: `${f.ws}/harbor`, view: 'context' }));

  const file = join(f.dir, 'copy.vantage.yaml');
  writeFileSync(file, f.yaml.replace('pages/runbook.md', 'pages/runbook.md').replace(/\n  - id: runbook[\s\S]*$/, '\n'));
  await f.laptop.call('vantage_write', { writes: [{ address: `${f.ws}/harbor-copy`, file }] });
  fixed(`write a ${f.yaml.length.toLocaleString('en-US')} character document from its path: sent`, f.laptop.calls.at(-1)!.charsIn);

  const wc = join(f.dir, 'wc');
  await f.laptop.call('vantage_checkout', { address: `${f.ws}/harbor`, dir: wc });
  const pagePath = join(wc, f.ws, 'harbor', 'pages', 'runbook.md');
  writeFileSync(pagePath, readFileSync(pagePath, 'utf8').replace('Lane 7 carries', 'Lane seven carries'));
  await f.laptop.call('vantage_sync', { dir: wc });
  const m = f.laptop.calls.at(-1)!;
  fixed(`sync one edit to a ${f.page.length.toLocaleString('en-US')} character page: sent and answered`, m.charsIn + m.charsOut);

  // Take an item, read what it needs, and finish it: the calls a run makes are fixed, whatever the item holds.
  f.hub.reset();
  await f.hub.call('vantage_tool', { tool: 'vantage_queue', arguments: { kinds: ['SW'], limit: 1 } });
  await f.hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', claim: true }, { item: 'SW-1', move: 'doing' }] } });
  await f.hub.call('vantage_read', { addresses: ['SW-1#done-when'] });
  await f.hub.call('vantage_tool', { tool: 'vantage_item', arguments: { actions: [{ item: 'SW-1', finish: { move: 'done', summary: 'Cached the price list.', proof: ['commit abc1234'] } }] } });
  out.push({ name: 'take an item, read what it needs, and finish it: calls', chars: f.hub.cost.calls, budget: 4, ok: f.hub.cost.calls <= 4 });
  return out;
}

export interface Standing {
  readonly name: string;
  readonly chars: number;
  readonly budget: number;
  readonly ok: boolean;
}

const SKILLS = join(import.meta.dir, '..', '..', '..', 'skills');

export async function measureStanding(f: Fixture, skills: readonly string[]): Promise<Standing[]> {
  const row = (name: string, chars: number, budget: number): Standing => ({ name, chars, budget, ok: chars <= budget });
  const descriptions = skills.map((s) => /^description:\s*(.*)$/m.exec(readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8'))?.[1] ?? '').join('\n');
  // Everything a fresh conversation is sent to change one sentence: the instructions, the tool list, and the one call.
  const fresh = await agent(f.t, f.hubHeaders);
  const tools = size((await fresh.client.listTools()).tools);
  await fresh.call('vantage_patch', { edits: [{ address: 'SHOP-2001', old: 'reads a copy', new: 'reads its own copy' }] });
  const first = tools + (fresh.client.getInstructions() ?? '').length + fresh.cost.in + fresh.cost.out;
  return [
    row('change one sentence in a record, from a fresh connection: everything sent', first, BUDGET.standing.coreTools + BUDGET.standing.instructions + 2 * BUDGET.addressAllowance),
    row('the tool list a hub sends', size((await f.hub.client.listTools()).tools), BUDGET.standing.coreTools),
    row('the tool list on a laptop', size((await f.laptop.client.listTools()).tools), BUDGET.standing.laptopTools),
    row('the connect instructions on a hub', (f.hub.client.getInstructions() ?? '').length, BUDGET.standing.instructions),
    row('the connect instructions on a laptop', (f.laptop.client.getInstructions() ?? '').length, BUDGET.standing.instructions),
    row('the skill descriptions', descriptions.length, BUDGET.standing.skillDescriptions),
  ];
}
