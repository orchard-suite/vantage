/**
 * Adding and changing a workspace's connectors, the one way the API and the
 * MCP tools both do it: the kind and its settings are checked, an interval
 * only for a kind the pool runs and no shorter than the hub allows, a
 * workspace holds at most CONNECTOR_MAX_PER_WORKSPACE connectors, the slug
 * never changes, and a change of kind, client, or settings takes back an
 * admin's approval. Every write is audited.
 */
import { z } from 'zod';
import { slug as slugOf } from '@vantage/model';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import type { Surface } from '../audit.ts';
import { audit } from '../audit.ts';
import { randomId } from '../crypto.ts';
import { badRequest, conflict } from '../http.ts';
import { Name, Slug, who } from '../api/common.ts';
import { connectorChanged, connectorIn, sourceById, workspaceConnectors, type SourceRow } from './repo.ts';
import { poolRefusal } from './runs.ts';

/** A connector kind with no settings of its own: whatever the client pushes is the batch. */
export const PUSH_CONNECTOR = 'push';

/** An OAuth client id: an Entra application (client) id, or any issuer's client_id. */
const ClientId = z.string().trim().min(1).max(200);

export const ConnectorInput = z
  .object({
    name: Name,
    slug: Slug.optional(),
    connector: z.string().min(1).max(50),
    config: z.record(z.string(), z.unknown()).default({}),
    clientId: ClientId,
    every: z.number().int().min(1).max(1440).nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .strict();

export type ConnectorInput = z.output<typeof ConnectorInput>;

function validate(ctx: AppContext, input: ConnectorInput): void {
  if (input.every !== null) {
    const refused = poolRefusal(input.connector, ctx.connectors);
    if (refused) throw badRequest(`this connector cannot run on an interval: ${refused}`);
    if (input.every < ctx.config.CONNECTOR_MIN_EVERY_MINUTES) throw badRequest(`a connector runs at most every ${ctx.config.CONNECTOR_MIN_EVERY_MINUTES} minutes on this hub`);
  }
  if (input.connector === PUSH_CONNECTOR) {
    if (Object.keys(input.config).length) throw badRequest('a push connector takes no settings');
    return;
  }
  const connector = ctx.connectors.get(input.connector);
  if (!connector) throw badRequest(`unknown connector ${input.connector}`, { known: [PUSH_CONNECTOR, ...ctx.connectors.list().map((c) => c.id)] });
  const parsed = connector.configSchema.safeParse(input.config);
  if (!parsed.success) throw badRequest('invalid connector config', { issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) });
}

export async function createConnector(ctx: AppContext, p: Principal, surface: Surface, workspaceId: string, input: ConnectorInput): Promise<SourceRow> {
  validate(ctx, input);
  const slug = input.slug ?? slugOf(input.name);
  if (await connectorIn(ctx.db, workspaceId, slug)) throw badRequest(`connector slug ${slug} is taken in this workspace`);
  const held = (await workspaceConnectors(ctx.db, workspaceId)).length;
  if (held >= ctx.config.CONNECTOR_MAX_PER_WORKSPACE) {
    ctx.log.warn('connector.cap', { workspaceId, held, cap: ctx.config.CONNECTOR_MAX_PER_WORKSPACE });
    throw conflict(`this workspace holds ${held} connectors, the most this hub allows; remove one, or widen one's filter, before adding another`);
  }
  const id = randomId();
  await ctx.db.query('insert into sources (id, org_id, workspace_id, name, slug, connector, config, client_id, every_minutes, enabled, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [id, p.orgId, workspaceId, input.name, slug, input.connector, JSON.stringify(input.config), input.clientId, input.every, input.enabled, p.userId]);
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'connector.create', surface, target: `connector:${id}`, details: { workspaceId, slug, connector: input.connector, clientId: input.clientId, every: input.every } });
  ctx.log.info('connector.created', { connectorId: id, workspaceId, slug, connector: input.connector, clientId: input.clientId, every: input.every });
  return (await sourceById(ctx.db, id))!;
}

export async function updateConnector(ctx: AppContext, p: Principal, surface: Surface, s: SourceRow, input: ConnectorInput): Promise<SourceRow> {
  validate(ctx, input);
  if (input.slug && input.slug !== s.slug) throw badRequest('the slug cannot change; observed keys and document binds carry it');
  const changed = connectorChanged(s, { connector: input.connector, client_id: input.clientId, config: input.config });
  const approval = changed && s.approval === 'approved' ? 'pending' : s.approval;
  await ctx.db.query('update sources set name = $2, connector = $3, config = $4, client_id = $5, every_minutes = $6, enabled = $7, approval = $8, updated_at = now() where id = $1', [s.id, input.name, input.connector, JSON.stringify(input.config), input.clientId, input.every, input.enabled, approval]);
  await audit(ctx.db, ctx.log, { orgId: p.orgId, who: who(p), what: 'connector.update', surface, target: `connector:${s.id}`, details: { connector: input.connector, clientId: input.clientId, every: input.every, enabled: input.enabled, approvalTakenBack: approval !== s.approval } });
  if (approval !== s.approval) ctx.log.info('connector.approval.reset', { connectorId: s.id, reason: 'kind, client, or settings changed' });
  return (await sourceById(ctx.db, s.id))!;
}

/** A connector as an input, so a change can name only what it changes. */
export function inputOf(s: SourceRow): ConnectorInput {
  return { name: s.name, slug: s.slug, connector: s.connector, config: s.config, clientId: s.client_id, every: s.every_minutes, enabled: s.enabled };
}
