/**
 * The live-layer tools: a workspace's connectors, their runs, and running one now, connector kinds, drift as text
 * plus a picture, publications and publishing. Each call runs as the
 * bearer's principal with the same checks as the API.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { requireWorkspace } from '../authz.ts';
import { documentBySlug, headVersion } from '../documents/repo.ts';
import { guardFor } from './run.ts';
import { connectorBlocked, connectorIn, listRuns, workspaceConnectors } from '../sources/repo.ts';
import { blockedReason, listPublicationRuns, listPublications, publicationById } from '../publishing/repo.ts';
import { enqueue } from '../worker/jobs.ts';
import { audit } from '../audit.ts';
import { driftReport } from '../worker/artifacts.ts';
import { renderDriftView } from '../api/drift.ts';
import { ConnectorInput, createConnector, inputOf, PUSH_CONNECTOR, updateConnector } from '../sources/save.ts';
import { nextRunAt, queueConnectorRun, runRefusal } from '../sources/runs.ts';
import { clockOf } from '../day.ts';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type ToolResult = { content: Content[]; isError?: boolean };

/** How a connector runs, as a tool answer says it. */
function runsText(s: { id: string; every_minutes: number | null }): string {
  const next = nextRunAt(s, new Date());
  return next ? `runs=pool every=${s.every_minutes}m next=${clockOf(next)}` : 'runs=own-runner';
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

export function registerLiveTools(server: McpServer, ctx: AppContext, p: Principal): void {
  const log = ctx.log.child({ surface: 'mcp', userId: p.userId });
  const who = p.token ? `${p.userId} via token ${p.token.id}` : p.userId;
  const guarded = guardFor(log);
  const ref = { workspace: z.string().describe('Workspace slug'), document: z.string().describe('Document slug') };

  server.registerTool(
    'vantage_connectors',
    { description: 'Connector kinds a workspace connector may name, with their settings schema, how a connector signs in, and publish targets a publication may use.', inputSchema: {} },
    guarded('vantage_connectors', async () => {
      const connectors = ctx.connectors.list().map((c) => `${c.id}\n  config: ${JSON.stringify(z.toJSONSchema(c.configSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }))}`);
      const targets = ctx.targets.list().map((t) => `${t.id}: ${t.description}`);
      const signIn = ctx.connectorTokens ? `a connector signs in with its own OAuth client: an app-only token for audience ${ctx.connectorTokens.audience} carrying the app role ${ctx.connectorTokens.role}` : 'connector sign-in is off on this hub (no issuer)';
      return text(`${signIn}\n\nconnectors:\n${PUSH_CONNECTOR}\n  takes no settings; whatever its client pushes to POST /api/v1/connector/:id/batches is the batch\n${connectors.join('\n')}\n\ntargets:\n${targets.join('\n')}`);
    }),
  );

  server.registerTool(
    'vantage_sources',
    { description: "A workspace's connectors with kind, OAuth client, interval, approval, and last run; with a connector slug, its settings and recent runs. Readers of the workspace only.", inputSchema: { workspace: z.string().describe('Workspace slug'), connector: z.string().optional().describe('Connector slug or id for run history') } },
    guarded<{ workspace: string; connector?: string | undefined }>('vantage_sources', async ({ workspace, connector }) => {
      const ws = await requireWorkspace(ctx.db, p, workspace, 'viewer');
      const required = ctx.config.CONNECTOR_APPROVAL;
      if (connector) {
        const s = await connectorIn(ctx.db, ws.id, connector);
        if (!s) return text(`connector ${connector} not found in ${workspace}`, true);
        const runs = await listRuns(ctx.db, s.id, 20);
        return text(`${s.slug} (${s.connector}) client=${s.client_id} ${runsText(s)} approval=${s.approval}${connectorBlocked(s, required) ? ` blocked: ${connectorBlocked(s, required)}` : ''}\nconfig: ${JSON.stringify(s.config)}\n${runs.map((r) => `${clockOf(r.started_at)}  ${r.status}  entities=${r.counts.entities ?? 0} appeared=${r.counts.appeared ?? 0} vanished=${r.counts.vanished ?? 0} overlaid=${r.counts.documentsOverlaid ?? 0}${r.error ? `  error: ${r.error}` : ''}${r.warnings.length ? `  warnings: ${r.warnings.length}` : ''}`).join('\n') || 'no runs yet'}`);
      }
      const rows = await workspaceConnectors(ctx.db, ws.id);
      return text(rows.map((s) => `${s.slug}: ${s.name} (${s.connector}) client=${s.client_id} ${runsText(s)} approval=${s.approval} enabled=${s.enabled} lastRun=${s.last_run ? `${s.last_run.status} at ${s.last_run.at}` : 'never'}`).join('\n') || 'no connectors in this workspace');
    }),
  );

  server.registerTool(
    'vantage_connector_save',
    {
      description: "Add a connector to a workspace, or change one. Name an existing connector (slug or id) to change it: only the fields given change. `every` (minutes) runs it in the hub's shared pool; null leaves it to a runner of its own. A secret in config is a Key Vault secret URL its app may read, never a value. Changing kind, client, or config takes back an admin's approval. Authors of the workspace only.",
      inputSchema: {
        workspace: ref.workspace,
        connector: z.string().optional().describe('Slug or id of the connector to change; omit to add one'),
        name: z.string().optional(),
        slug: z.string().optional().describe('For a new connector; the prefix of every observed key. It never changes'),
        kind: z.string().optional().describe('Connector kind (vantage_connectors lists them), or push'),
        config: z.record(z.string(), z.unknown()).optional(),
        clientId: z.string().optional().describe("The OAuth client id of the connector's own app"),
        every: z.number().int().nullable().optional().describe('Minutes between runs in the shared pool; null for a runner of its own'),
        enabled: z.boolean().optional(),
      },
    },
    guarded<{ workspace: string; connector?: string | undefined; name?: string | undefined; slug?: string | undefined; kind?: string | undefined; config?: Record<string, unknown> | undefined; clientId?: string | undefined; every?: number | null | undefined; enabled?: boolean | undefined }>('vantage_connector_save', async (args) => {
      const ws = await requireWorkspace(ctx.db, p, args.workspace, 'author');
      const given = { name: args.name, slug: args.slug, connector: args.kind, config: args.config, clientId: args.clientId, every: args.every, enabled: args.enabled };
      const set = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
      if (args.connector) {
        const s = await connectorIn(ctx.db, ws.id, args.connector);
        if (!s) return text(`connector ${args.connector} not found in ${args.workspace}`, true);
        const input = ConnectorInput.safeParse({ ...inputOf(s), ...set });
        if (!input.success) return text(`invalid connector: ${input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, true);
        const after = await updateConnector(ctx, p, 'mcp', s, input.data);
        return text(`changed ${after.slug}: ${after.connector} client=${after.client_id} ${runsText(after)} approval=${after.approval} enabled=${after.enabled}`);
      }
      const input = ConnectorInput.safeParse(set);
      if (!input.success) return text(`invalid connector: ${input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, true);
      const made = await createConnector(ctx, p, 'mcp', ws.id, input.data);
      return text(`added ${made.slug} (${made.id}): ${made.connector} client=${made.client_id} ${runsText(made)} approval=${made.approval}`);
    }),
  );

  server.registerTool(
    'vantage_connector_run',
    { description: 'Run a connector now in the hub\'s shared runner pool, instead of waiting for its interval. Authors of the workspace only. A run that already waits stands for this one.', inputSchema: { workspace: ref.workspace, connector: z.string().describe('Connector slug or id') } },
    guarded<{ workspace: string; connector: string }>('vantage_connector_run', async ({ workspace, connector }) => {
      const ws = await requireWorkspace(ctx.db, p, workspace, 'author');
      const s = await connectorIn(ctx.db, ws.id, connector);
      if (!s) return text(`connector ${connector} not found in ${workspace}`, true);
      const refused = runRefusal(s, ctx);
      if (refused) return text(refused, true);
      const queued = await queueConnectorRun(ctx, s, { trigger: 'manual', who });
      if (!queued) return text('the run could not be queued; try again', true);
      await audit(ctx.db, log, { orgId: p.orgId, who, what: 'connector.run.queue', surface: 'mcp', target: `connector:${s.id}`, details: { jobId: queued.jobId, queued: queued.queued } });
      return text(`${queued.queued ? 'queued' : 'a run already waited:'} ${s.slug} as job ${queued.jobId}; check vantage_sources with connector=${s.slug} for the result`);
    }),
  );

  server.registerTool(
    'vantage_drift',
    { description: 'Where a document disagrees with what its sources observe: each disagreement as a sentence, and the drift view of one view as a picture.', inputSchema: { ...ref, view: z.string().optional().describe('View id; default the first view'), picture: z.boolean().optional().describe('Include the PNG; default true') } },
    guarded<{ workspace: string; document: string; view?: string | undefined; picture?: boolean | undefined }>('vantage_drift', async (args) => {
      const ws = await requireWorkspace(ctx.db, p, args.workspace, 'viewer');
      const d = await documentBySlug(ctx.db, ws.id, args.document);
      if (!d) return text(`document ${args.workspace}/${args.document} not found`, true);
      const head = await headVersion(ctx.db, d);
      if (!head) return text('the document has no versions', true);
      const report = await driftReport(ctx, d.id);
      if (!report) return text('no drift report yet; the document renders first');
      const view = await renderDriftView(ctx, d, head, args.view);
      const summary = `${report.counts.declaredNotObserved} declared but not observed, ${report.counts.observedNotDeclared} observed but not declared, ${report.counts.factMismatch} fact mismatches (report from ${clockOf(report.updated_at)}, binds ${d.bind_sources.join(', ') || 'nothing'})`;
      const content: Content[] = [{ type: 'text', text: `${summary}\n${view.sentences.join('\n') || 'The document agrees with everything observed.'}` }];
      if (args.picture !== false) content.push({ type: 'image', data: Buffer.from(await ctx.render.run('png', { svg: view.svg })).toString('base64'), mimeType: 'image/png' });
      return { content };
    }),
  );

  server.registerTool(
    'vantage_publications',
    { description: 'Publications of a workspace with target, trigger, and last run; with a publication id, its recent runs.', inputSchema: { workspace: ref.workspace, publication: z.string().optional().describe('Publication id for run history') } },
    guarded<{ workspace: string; publication?: string | undefined }>('vantage_publications', async ({ workspace, publication }) => {
      const ws = await requireWorkspace(ctx.db, p, workspace, 'viewer');
      if (publication) {
        const pub = await publicationById(ctx.db, publication);
        if (!pub || pub.workspace_id !== ws.id) return text(`publication ${publication} not found`, true);
        const runs = await listPublicationRuns(ctx.db, pub.id, 20);
        return text(`${pub.name} -> ${pub.target} [${pub.formats.join(', ')}] trigger=${pub.trigger.kind}\n${runs.map((r) => `${clockOf(r.started_at)}  ${r.trigger}  ${r.status}  written=${r.written.length} skipped=${r.skipped.length}${r.error ? `  error: ${r.error}` : ''}`).join('\n') || 'no runs yet'}`);
      }
      const rows = await listPublications(ctx.db, ws.id);
      return text(rows.map((r) => `${r.id}  ${r.name} -> ${r.target} [${r.formats.join(', ')}] trigger=${r.trigger.kind} enabled=${r.enabled} approval=${r.approval} lastRun=${r.last_run ? `${r.last_run.status} at ${r.last_run.at}` : 'never'}`).join('\n') || 'no publications');
    }),
  );

  server.registerTool(
    'vantage_publish',
    { description: 'Queue a publication run now. Authors of the workspace only.', inputSchema: { workspace: ref.workspace, publication: z.string().describe('Publication id') } },
    guarded<{ workspace: string; publication: string }>('vantage_publish', async ({ workspace, publication }) => {
      const ws = await requireWorkspace(ctx.db, p, workspace, 'author');
      const pub = await publicationById(ctx.db, publication);
      if (!pub || pub.workspace_id !== ws.id) return text(`publication ${publication} not found`, true);
      const blocked = blockedReason(pub, ctx.config.PUBLICATION_APPROVAL);
      if (blocked) return text(blocked, true);
      const jobId = await enqueue(ctx.db, { orgId: p.orgId, kind: 'publication-run', payload: { publicationId: pub.id, trigger: 'manual', who } });
      await audit(ctx.db, log, { orgId: p.orgId, who, what: 'publication.run.queue', surface: 'mcp', target: `publication:${pub.id}`, details: { jobId } });
      return text(`queued ${pub.name} as job ${jobId}; check vantage_publications with publication=${pub.id} for the result`);
    }),
  );
}
