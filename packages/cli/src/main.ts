#!/usr/bin/env bun
/** The vantage command: render, import, lint, serve, schema, icons, mcp, login, logout, init, connector run, connector pool. */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { formatDiagnostic } from '@vantage/model';
import { createApp, documentTitleBlock, explore, exportDocument, fileProducer, formatReport, importableFiles, importFile, load, render, schema, searchIcons, validate, type DocumentFormat, type Format, type Orientation, type PageSize, type Theme, type TitleBlock } from '@vantage/server';
import { loginToHub, removeHubLink, startMcp, writeHubLink } from '@vantage/mcp';
import { defaultTargets, runPublication, PublicationSchema } from '@vantage/publish';
import { consoleLogger, defaultRegistry, runConnectorOnce, runPool } from '@vantage/connectors';
import { STARTER } from './starter.ts';
import { observedTransform } from './observed.ts';

interface Args {
  readonly cmd: string;
  readonly positional: string[];
  readonly flags: Record<string, string | boolean>;
}

function parse(argv: string[]): Args {
  const [cmd = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k!] = v;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) flags[k!] = rest[++i]!;
      else flags[k!] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}

const HELP = `vantage <command> [options]

  render <file>   Render views. --view <id> --format svg|png|html|json|pdf|drawio|vsdx --out <dir> --theme light|dark|print|colorblind --scale 2
                  --title-block adds a header from the document; --title-block "title=..;subtitle=..;author=..;updated=..;version=..;link=..;published=.." sets it
                  --transparent (svg, png) leaves the canvas unpainted; --embed-fonts (svg) inlines Inter
                  --page A4|Letter|A3|fit --orientation auto|portrait|landscape (pdf)
                  --observed a.json,b.json lays batches (the push shape) over bound nodes as the hub does; --fresh-days 7 dims older open items
  import <path>   Read a draw.io (.drawio, .xml) or Visio (.vsdx; Lucidchart exports it) drawing with pins, or an Ilograph, Mermaid (.mmd), PlantUML (.puml), or Markdown file with mermaid or plantuml blocks, or a folder of them, into <name>.vantage.yaml beside a copy of the original. --out <dir> --page <n>
  lint <file>     Validate and report layout quality per view. --json
  explore <file>  Lay a relation view out several ways; writes a contact sheet PNG. --view <id> --limit 4 --out <dir>
  publish <file>  Render and push to a target. --target fs|azure-blob|git|webhook|sharepoint|confluence|teams --formats html,png --config '{...json}' --to <dir> (fs) --views a,b --version <v> --live <url>
  serve <file>    Live viewer with reload. --port 4747
  schema          Print the JSON schema of the document format
  icons <query>   Search icon ids. --pack azure
  mcp             Start the MCP server on stdio; once logged in it serves the hub's tools too
  login <url>     Sign this machine in to a hub (the device code flow) so mcp reaches it
  logout          Forget the hub; mcp serves the local tools only
  init <file>     Write a starter document
  connector run <id>  Run one workspace connector outside the hub and push what it finds. It signs in as its own OAuth client:
                  --hub <url> --token-url <issuer token endpoint> --client-id <id> --scope <hub app id URI>/.default
                  and one of --assertion-file <path> (a workload identity token) or the VANTAGE_CLIENT_SECRET variable.
                  Each flag falls back to VANTAGE_HUB, VANTAGE_TOKEN_URL, AZURE_CLIENT_ID, VANTAGE_SCOPE, AZURE_FEDERATED_TOKEN_FILE.
  connector pool  Run the hub's shared connector pool: lease the runs the hub schedules and run each as its connector's own app.
                  The same flags, with --client-id the pool's own app (the hub's pool role) and --assertion-file the workload
                  identity token every connector app trusts. --concurrency 2 runs at once; --timeout 600 seconds per run.
                  Stops on SIGTERM: takes no new run, lets the running ones finish for --grace 30 seconds, hands back the rest.
`;

async function main(argv: string[]): Promise<number> {
  const { cmd, positional, flags } = parse(argv);
  const str = (k: string): string | undefined => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  // The observed layer is always applied, as the hub applies it: with no batches, observe blocks still add their views, empty.
  const transform = observedTransform(str('observed')?.split(',') ?? [], Number(str('fresh-days') ?? 7));
  switch (cmd) {
    case 'render': {
      const file = positional[0];
      if (!file) return fail('render needs a file');
      const format = (str('format') ?? 'svg') as Format | DocumentFormat;
      const out = str('out') ?? 'out';
      const theme = str('theme') as Theme | undefined;
      const titleBlock = parseTitleBlock(flags['title-block']);
      const v = validate({ file, transform });
      for (const d of v.diagnostics) console.error(formatDiagnostic(d));
      if (!v.ok) return 1;
      mkdirSync(out, { recursive: true });
      const views = str('view') ? v.views.filter((x) => x.id === str('view')) : v.views.filter((x) => !x.hidden);
      if (format === 'pdf' || format === 'drawio' || format === 'vsdx') {
        const r = await exportDocument({ file, transform, format, views: views.map((x) => x.id), theme, titleBlock, page: str('page') as PageSize | undefined, orientation: str('orientation') as Orientation | undefined });
        if (!r.result) {
          for (const d of r.diagnostics) console.error(formatDiagnostic(d));
          return 1;
        }
        const target = join(out, `${basename(file).replace(/\.(vantage\.)?ya?ml$/, '')}.${r.result.extension}`);
        writeFileSync(target, r.result.bytes);
        console.log(`${target}  ${r.result.viewIds.length} views`);
        return 0;
      }
      if (format === 'html') {
        const r = render({ file, transform, format: 'html', ...(theme ? { theme } : {}) });
        if (!r.result) {
          for (const d of r.diagnostics) console.error(formatDiagnostic(d));
          return 1;
        }
        const target = join(out, `${basename(file).replace(/\.(vantage\.)?ya?ml$/, '')}.html`);
        writeFileSync(target, r.result.html!);
        console.log(target);
        return 0;
      }
      const model = load({ file, transform }).model;
      const block = model ? documentTitleBlock(model, titleBlock) : undefined;
      for (const view of views) {
        const r = render({ file, transform, view: view.id, format, theme, titleBlock: block ? { ...block, subtitle: block.subtitle ?? view.title } : undefined, transparent: flags['transparent'] === true, embedFonts: flags['embed-fonts'] === true, ...(str('scale') ? { scale: Number(str('scale')) } : {}) });
        if (!r.result) return fail(`view ${view.id} failed`);
        const target = join(out, `${view.id}.${format}`);
        if (format === 'png') writeFileSync(target, r.result.png!);
        else if (format === 'json') writeFileSync(target, JSON.stringify(r.result.layout, null, 2));
        else writeFileSync(target, r.result.svg);
        console.log(`${target}  score=${view.metrics.score}${view.metrics.notes.length ? `  ${view.metrics.notes.join('; ')}` : ''}`);
      }
      return 0;
    }
    case 'import': {
      const target = positional[0];
      if (!target) return fail('import needs a file or a folder');
      const page = str('page');
      if (page !== undefined && !/^\d+$/.test(page)) return fail('--page takes a page number, counting from 0');
      // A folder imports every drawing inside it, one document each.
      const files = statSync(target).isDirectory() ? importableFiles(target) : [target];
      if (!files.length) return fail(`nothing to import in ${target}`);
      let failed = 0;
      for (const file of files) {
        const r = importFile({ file, out: str('out') ?? 'out', ...(page !== undefined ? { pageIndex: Number(page) } : {}) });
        if (files.length > 1) console.log(`== ${file}`);
        console.log(formatReport(r.report));
        if (r.written) console.log([r.written.document, r.written.original, ...r.written.assets].join('\n'));
        if (r.report.diagnostics.some((d) => d.severity === 'error')) failed++;
      }
      return failed ? 1 : 0;
    }
    case 'explore': {
      const file = positional[0];
      if (!file) return fail('explore needs a file');
      const out = str('out') ?? 'out';
      const r = explore({ file, ...(str('view') ? { view: str('view') } : {}), ...(str('limit') ? { limit: Number(str('limit')) } : {}), ...(str('theme') ? { theme: str('theme') as Theme } : {}) });
      if (!r.result) {
        for (const d of r.diagnostics) console.error(formatDiagnostic(d));
        return 1;
      }
      mkdirSync(out, { recursive: true });
      const target = join(out, `${r.result.viewId}.explore.png`);
      writeFileSync(target, r.result.png);
      console.log(target);
      r.result.candidates.forEach((c, i) => {
        console.log(`${String.fromCharCode(65 + i)}. ${c.name}  score=${c.score}  ${c.width}x${c.height}`);
        for (const l of c.yaml.split('\n')) console.log(`     ${l}`);
      });
      return 0;
    }
    case 'publish': {
      const file = positional[0];
      if (!file) return fail('publish needs a file');
      const target = str('target') ?? 'fs';
      const config = str('config') ? (JSON.parse(str('config')!) as Record<string, unknown>) : target === 'fs' ? { path: str('to') ?? 'out/publish' } : {};
      const slug = basename(file).replace(/\.(vantage\.)?ya?ml$/, '');
      const parsed = PublicationSchema.safeParse({ id: `cli-${slug}`, document: file, formats: (str('formats') ?? 'html,png').split(','), target, config, ...(str('views') ? { views: str('views')!.split(',') } : {}), trigger: { kind: 'manual' } });
      if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      const stamp = { title: slug, version: str('version') ?? 'local', publishedAt: new Date().toISOString(), ...(str('live') ? { liveUrl: str('live')! } : {}) };
      const log = { debug: () => undefined, info: (m: string, d?: Record<string, unknown>) => console.log(`${m} ${d ? JSON.stringify(d) : ''}`), warn: (m: string, d?: Record<string, unknown>) => console.warn(`${m} ${d ? JSON.stringify(d) : ''}`), error: (m: string, d?: Record<string, unknown>) => console.error(`${m} ${d ? JSON.stringify(d) : ''}`) };
      const secrets = async (ref: string): Promise<string> => {
        const v = process.env[`VANTAGE_SECRET_${ref.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
        if (v === undefined) throw new Error(`secret ${ref} not found; set VANTAGE_SECRET_${ref.toUpperCase()}`);
        return v;
      };
      const r = await runPublication(parsed.data, stamp, fileProducer({ file, slug, ...(str('live') ? { refreshUrl: `${str('live')}/bundle` } : {}) }), defaultTargets(), { secrets, log, now: () => new Date(), fetch });
      for (const w of r.written) console.log(`${w.artifact} -> ${w.location} (${w.bytes} bytes)`);
      for (const s of r.skipped) console.log(`${s.artifact} skipped: ${s.reason}`);
      return r.skipped.length && !r.written.length ? 1 : 0;
    }
    case 'lint': {
      const file = positional[0];
      if (!file) return fail('lint needs a file');
      const v = validate({ file, transform });
      if (flags['json']) {
        console.log(JSON.stringify(v, null, 2));
        return v.ok ? 0 : 1;
      }
      for (const d of v.diagnostics) console.log(formatDiagnostic(d));
      for (const view of v.views) {
        console.log(`${view.id.padEnd(22)} ${String(view.metrics.score).padStart(3)}  ${view.width}x${view.height}  crossings=${view.metrics.crossings} throughBoxes=${view.metrics.edgeBoxCrossings} labelOverlaps=${view.metrics.labelOverlaps}${view.hidden ? '  part' : ''}`);
        for (const n of view.metrics.notes) console.log(`  - ${n}`);
      }
      console.log(v.ok ? `ok: ${v.nodes} nodes, ${v.relations} relations, ${v.views.length} views` : 'errors found');
      return v.ok ? 0 : 1;
    }
    case 'serve': {
      const file = positional[0];
      const port = Number(str('port') ?? 4747);
      const app = createApp(file ? { file } : {});
      const server = Bun.serve({ port, fetch: app.fetch, idleTimeout: 255 });
      console.log(`vantage viewer at http://localhost:${server.port}/${file ? '' : '?file=<path>'}`);
      await new Promise(() => undefined);
      return 0;
    }
    case 'schema':
      console.log(JSON.stringify(schema(), null, 2));
      return 0;
    case 'icons':
      for (const id of searchIcons(positional.join(' '), str('pack'), Number(str('limit') ?? 60))) console.log(id);
      return 0;
    case 'mcp':
      await startMcp();
      return 0;
    case 'login': {
      const url = positional[0];
      if (!url) return fail('login needs the hub url, for example vantage login https://vantage.example.com');
      const link = await loginToHub(url, {
        prompt: (start) => {
          console.log(`Open ${start.verification_uri_complete}\nand approve code ${start.user_code}. Waiting...`);
          if (process.platform === 'darwin') Bun.spawn(['open', start.verification_uri_complete], { stdout: 'ignore', stderr: 'ignore' });
        },
      });
      console.log(`signed in; wrote ${writeHubLink(link)}`);
      return 0;
    }
    case 'logout':
      console.log(removeHubLink() ? 'forgot the hub; mcp serves the local tools only' : 'not signed in to a hub');
      return 0;
    case 'connector': {
      const env = process.env;
      const need = (flag: string, name: string): string => {
        const v = str(flag) ?? env[name];
        if (!v) throw new Error(`--${flag} or ${name} is required`);
        return v;
      };
      if (positional[0] === 'pool') {
        const stop = new AbortController();
        for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => stop.abort());
        await runPool({
          hub: need('hub', 'VANTAGE_HUB'),
          tokenUrl: need('token-url', 'VANTAGE_TOKEN_URL'),
          clientId: need('client-id', 'AZURE_CLIENT_ID'),
          scope: need('scope', 'VANTAGE_SCOPE'),
          assertionFile: need('assertion-file', 'AZURE_FEDERATED_TOKEN_FILE'),
          registry: defaultRegistry(),
          log: consoleLogger({ service: 'vantage-connector-pool' }),
          signal: stop.signal,
          ...(str('concurrency') ? { concurrency: Number(str('concurrency')) } : {}),
          ...(str('timeout') ? { timeoutSeconds: Number(str('timeout')) } : {}),
          ...(str('grace') ? { graceSeconds: Number(str('grace')) } : {}),
        });
        return 0;
      }
      if (positional[0] !== 'run' || !positional[1]) return fail('usage: vantage connector run <connector id> | vantage connector pool');
      const out = await runConnectorOnce({
        hub: need('hub', 'VANTAGE_HUB'),
        connector: positional[1],
        tokenUrl: need('token-url', 'VANTAGE_TOKEN_URL'),
        clientId: need('client-id', 'AZURE_CLIENT_ID'),
        scope: need('scope', 'VANTAGE_SCOPE'),
        assertionFile: str('assertion-file') ?? (env['VANTAGE_CLIENT_SECRET'] ? undefined : env['AZURE_FEDERATED_TOKEN_FILE']),
        clientSecret: env['VANTAGE_CLIENT_SECRET'],
        registry: defaultRegistry(),
        log: consoleLogger({ service: 'vantage-connector', connector: positional[1] }),
        ...(str('timeout') ? { timeoutSeconds: Number(str('timeout')) } : {}),
      });
      console.log(JSON.stringify(out));
      return 0;
    }
    case 'init': {
      const file = positional[0] ?? 'architecture.vantage.yaml';
      writeFileSync(file, STARTER, { flag: 'wx' });
      console.log(file);
      return 0;
    }
    default:
      console.log(HELP);
      return cmd === 'help' ? 0 : 1;
  }
}

/** `--title-block` alone fills the block from the document; a `key=value;key=value` string sets the fields. */
function parseTitleBlock(flag: string | boolean | undefined): TitleBlock | true | undefined {
  if (flag === undefined || flag === false) return undefined;
  if (flag === true) return true;
  const block: Record<string, string> = {};
  for (const pair of flag.split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) block[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  const pick = (k: keyof TitleBlock): Partial<TitleBlock> => (block[k] !== undefined ? { [k]: block[k] } : {});
  return { ...pick('title'), ...pick('subtitle'), ...pick('author'), ...pick('updated'), ...pick('version'), ...pick('link'), ...pick('published') };
}


function fail(msg: string): number {
  console.error(msg);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
