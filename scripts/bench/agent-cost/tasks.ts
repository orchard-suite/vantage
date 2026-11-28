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

/** One file on the disk, by its path under the docs folder. */
export interface DiskFile {
  readonly path: string;
  readonly text: string;
}

export const disk = {
  search(path: string, pattern: string, text: string): Cost {
    const hits = text.split('\n').flatMap((l, i) => (l.toLowerCase().includes(pattern.toLowerCase()) ? [`${path}:${i + 1}:${l}`] : []));
    return { in: size({ pattern, path }), out: hits.join('\n').length, calls: 1 };
  },
  /** A search through every file under a folder, the way an agent asks a plain question of a repository's docs. */
  grep(dir: string, files: readonly DiskFile[], pattern: string): Cost {
    const hits = files.flatMap((f) => f.text.split('\n').flatMap((l, i) => (l.toLowerCase().includes(pattern.toLowerCase()) ? [`${dir}/${f.path}:${i + 1}:${l}`] : [])));
    return { in: size({ pattern, path: dir }), out: hits.join('\n').length, calls: 1 };
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
  /** The whole estate's built standard, as the same file would sit on a disk. */
  readonly standard: string;
  /** The version of it the agent read. */
  readonly standardVersion: string;
  /** One scope's text, as the same file would sit on a disk. */
  readonly scope: string;
  /** A team workspace's records and documents, as the same files would sit on a disk, for the tasks that search across the hub. */
  readonly shared: readonly DiskFile[];
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

/** A team's records, one of which answers a plain question asked across the hub. */
const SHARED_RECORDS = [
  ['Apps sign in through one identity provider', 'Every app signs in through the one identity provider, with a short lived token.', 'Each app kept its own accounts, and turning a person off meant a ticket per app.'],
  ['Orders go through one API', 'Only the Shop API writes orders.', 'Two apps wrote to the orders store, and their rules drifted apart.'],
  ['Prices come from one list', 'The price list is the one source of prices; every app reads it from the cache.', 'Apps kept copies of prices, and a sale showed two prices.'],
  ['Every service logs to one place', 'Every service sends its logs to the shared log store.', 'Apps kept logs on their own hosts, and an outage was read host by host.'],
].map(([title, decision, context]) => `---\ntitle: ${title}\nstatus: accepted\ncategory: 2\ndecided: 2026-11-01\ndeciders: [The maintainers]\n---\n\n## Context\n\n${context}\n\n## Decision\n\n${decision}\n\n## Consequences\n\nOne place to change it, and one more thing every app depends on.\n`);

/** The standard a repository is held to: a document whose docs contract names it. */
const STANDARD = `title: Shop service standard
docs:
  kind: standard
  repository: github.com/acme/shop
  audience: engineers who change the shop
  rules:
    - Every runbook step names the box it acts on.
nodes:
  - name: Shop API
    type: api
views: []
`;

/** Rules the platform sets for the whole estate, each a record with a position, in three areas. */
const RULES = Array.from({ length: 12 }, (_, i) => {
  const category = [2, 5, 6][i % 3]!;
  return `---\ntitle: Rule ${i + 1} holds for every service\nstatus: accepted\ncategory: ${category}\ndecided: 2026-11-01\ndeciders: [The maintainers]\nposition:\n  line: Every service keeps rule ${i + 1} for lane ${i + 1}, checked at each release.\n  binding: ${i % 2 ? 'should' : 'must'}\n  binds: [systems, agents]\n---\n\n## Context\n\nLane ${i + 1} drifted.\n\n## Decision\n\nRule ${i + 1} holds.\n\n## Consequences\n\nOne rule to keep.\n`;
});

/** A small tree kept in the hub, whose team leaves its mission to the organization above it. */
const SCOPES = `source: hub
profile: [description, mission, north_star]
scopes:
  - id: acme
    name: Acme
    kind: organization
    profile:
      mission: Every order arrives whole and on time, whatever the lane it travels.
      north_star: Orders that need no second touch.
  - id: shop
    name: Shop
    kind: team
    parent: acme
    profile:
      description: The shop takes orders from the storefront and hands them to the warehouse lanes.
workspaces: {}
`;

/** A person's scratch notes, full of the question's words: a search across the hub never answers from them. */
const SCRATCH = `title: Scratch\nnodes:\n${Array.from({ length: 20 }, (_, i) => `  - name: Idea ${i}\n    type: service\n    description: maybe apps sign in some other way, idea ${i}`).join('\n')}\nviews: []\n`;

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
  await hub.call('vantage_tool', { tool: 'vantage_workspaces', arguments: { action: 'create', name: 'Platform' } });
  await hub.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: 'platform', prefix: 'PLAT', name: 'Platform decisions' } });
  for (const text of SHARED_RECORDS) await hub.call('vantage_write', { writes: [{ address: 'PLAT', text }] });
  await hub.call('vantage_write', { writes: [{ address: 'platform/shop-standard', text: STANDARD }, { address: '~/scratch', text: SCRATCH }] });
  await hub.call('vantage_write', { writes: [{ address: 'scopes', text: SCOPES }] });
  const scope = /^=== scopes\/shop[^\n]*\n([\s\S]*)$/.exec(await hub.call('vantage_read', { addresses: ['scopes/shop'] }))![1]!;
  await hub.call('vantage_tool', { tool: 'vantage_registries', arguments: { action: 'create', workspace: 'platform', prefix: 'RULE', name: 'Platform rules' } });
  for (const text of RULES) await hub.call('vantage_write', { writes: [{ address: 'RULE', text }] });
  const built = /^=== standard\/estate  version (\S+)[^\n]*\n([\s\S]*)$/.exec(await hub.call('vantage_read', { addresses: ['standard/estate'] }))!;
  const shared: DiskFile[] = [{ path: 'shop-standard.vantage.yaml', text: STANDARD }];
  for (let i = 1; i <= SHARED_RECORDS.length; i++) {
    const ref = `PLAT-${2000 + i}`;
    shared.push({ path: `decisions/${ref}.md`, text: new RegExp(`=== ${ref}[^\\n]*\\n([\\s\\S]*)$`).exec(await hub.call('vantage_read', { addresses: [ref] }))![1]! });
  }
  return { t, hub, hubHeaders: me.headers, laptop: lap, ws, yaml, page, record, item, standard: built[2]!, standardVersion: built[1]!, scope, shared, dir: mkdtempSync(join(tmpdir(), 'vantage-cost-')) };
}

export interface Task {
  readonly name: string;
  readonly kind: 'box' | 'view' | 'page' | 'record' | 'item' | 'roadmap' | 'search' | 'standard' | 'scope';
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
    name: 'answer a plain question across the hub',
    kind: 'search',
    run: async (f) => {
      await f.hub.call('vantage_find', { query: 'how do apps sign in' });
      return f.hub.call('vantage_read', { addresses: ['PLAT-2001#decision'] });
    },
    disk: (f) => {
      const file = f.shared.find((x) => x.path === 'decisions/PLAT-2001.md')!;
      const r = section(file.text, 'decision');
      return sum(disk.grep(DISK, f.shared, 'sign in'), disk.read(`${DISK}/${file.path}`, file.text, r.from, r.to));
    },
  },
  {
    name: 'find the standard that binds a repository',
    kind: 'search',
    run: (f) => f.hub.call('vantage_find', { query: 'repository: github.com/acme/shop' }),
    disk: (f) => disk.grep(DISK, f.shared, 'repository: github.com/acme/shop'),
  },
  {
    name: 'read the rules of one area of a standard',
    kind: 'standard',
    run: (f) => f.hub.call('vantage_read', { addresses: ['standard/estate#security'] }),
    disk: (f) => {
      const r = section(f.standard, 'security');
      return sum(disk.search(`${DISK}/standards/estate.md`, '## Security', f.standard), disk.read(`${DISK}/standards/estate.md`, f.standard, r.from, r.to));
    },
  },
  {
    name: 'read the whole standard that binds the work',
    kind: 'standard',
    run: (f) => f.hub.call('vantage_read', { addresses: ['standard/estate'] }),
    disk: (f) => disk.read(`${DISK}/standards/estate.md`, f.standard, 1, f.standard.split('\n').length),
  },
  {
    name: 'check the standard held is current before a write',
    kind: 'standard',
    run: (f) => f.hub.call('vantage_read', { addresses: ['standard/estate'], held: { 'standard/estate': f.standardVersion } }),
    disk: (f) => disk.read(`${DISK}/standards/estate.md`, f.standard, 1, 7),
  },
  {
    name: "read a scope's profile, inherited fields and all",
    kind: 'scope',
    run: (f) => f.hub.call('vantage_read', { addresses: ['scopes/shop'] }),
    disk: (f) => disk.read(`${DISK}/scopes/shop.md`, f.scope, 1, f.scope.split('\n').length),
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
