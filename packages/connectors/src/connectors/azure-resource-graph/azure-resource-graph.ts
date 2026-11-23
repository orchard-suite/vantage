/**
 * Queries Azure Resource Graph with KQL over a set of subscriptions. Every
 * resource becomes an entity under a synthesized resource group under a
 * synthesized subscription, and well-known properties (serverFarmId,
 * subnet ids, private endpoints, NICs, disks) become arrows.
 */
import { z } from 'zod';
import type { Batch, BatchEntity, BatchRelation, FactValue } from '../../batch.ts';
import { FactValueSchema } from '../../batch.ts';
import { fetchJson, type Connector, type ConnectorContext } from '../../connector.ts';
import { getPath } from '../../template.ts';

export const DEFAULT_ARG_QUERY = 'Resources | project id, name, type, location, resourceGroup, subscriptionId, kind, sku, tags, properties | order by id asc';

export const AzureResourceGraphConfigSchema = z
  .object({
    subscriptions: z.array(z.string().min(1)).min(1).describe('Subscription ids in scope'),
    query: z.string().min(1).default(DEFAULT_ARG_QUERY).describe('KQL; must project id, name, type, location, resourceGroup, subscriptionId'),
    pageSize: z.number().int().min(1).max(1000).default(500),
    endpoint: z.string().url().default('https://management.azure.com'),
    apiVersion: z.string().default('2021-03-01'),
    subscriptionNames: z.record(z.string(), z.string()).default({}).describe('Subscription id to display name'),
  })
  .strict();

export type AzureResourceGraphConfig = z.output<typeof AzureResourceGraphConfigSchema>;

export interface AzureTokenSource {
  /** A bearer token for the ARM scope. */
  getToken(signal: AbortSignal): Promise<string>;
}

/** DefaultAzureCredential, for a run with no app identity (a developer's machine): workload identity, managed identity, environment, or az login, in that order. */
export const defaultAzureTokenSource: AzureTokenSource = {
  getToken: async (signal) => {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const token = await new DefaultAzureCredential().getToken('https://management.azure.com/.default', { abortSignal: signal });
    return token.token;
  },
};

interface ArgRow {
  id: string;
  name: string;
  type: string;
  location?: string;
  resourceGroup?: string;
  subscriptionId: string;
  kind?: string;
  sku?: unknown;
  tags?: unknown;
  properties?: unknown;
}

interface ArgResponse {
  totalRecords: number;
  count: number;
  data: ArgRow[];
  $skipToken?: string;
  resultTruncated?: string;
}

export function subscriptionId(sub: string): string {
  return `azure:subscription:${sub.toLowerCase()}`;
}

export function resourceGroupId(sub: string, rg: string): string {
  return `azure:resourcegroup:${sub.toLowerCase()}/${rg.toLowerCase()}`;
}

/** Paths into `properties` that hold the id of another resource, with the arrow they mean. */
const REFERENCES: readonly { path: string; label: string; kind: BatchRelation['kind']; many?: boolean }[] = [
  { path: 'serverFarmId', label: 'hosted on', kind: 'deploy' },
  { path: 'subnet.id', label: 'in subnet', kind: 'deploy' },
  { path: 'ipConfigurations[*].properties.subnet.id', label: 'in subnet', kind: 'deploy', many: true },
  { path: 'virtualNetworkSubnetId', label: 'in subnet', kind: 'deploy' },
  { path: 'networkProfile.networkInterfaces[*].id', label: 'uses', kind: 'sync', many: true },
  { path: 'storageProfile.osDisk.managedDisk.id', label: 'boots from', kind: 'data' },
  { path: 'storageProfile.dataDisks[*].managedDisk.id', label: 'stores on', kind: 'data', many: true },
  { path: 'privateEndpointConnections[*].properties.privateEndpoint.id', label: 'reached by', kind: 'sync', many: true },
  { path: 'privateLinkServiceConnections[*].properties.privateLinkServiceId', label: 'connects to', kind: 'sync', many: true },
  { path: 'manualPrivateLinkServiceConnections[*].properties.privateLinkServiceId', label: 'connects to', kind: 'sync', many: true },
  { path: 'networkSecurityGroup.id', label: 'guarded by', kind: 'auth' },
  { path: 'publicIPAddress.id', label: 'exposed on', kind: 'sync' },
  { path: 'ipConfigurations[*].properties.publicIPAddress.id', label: 'exposed on', kind: 'sync', many: true },
  { path: 'keyVaultReferenceIdentity', label: 'reads', kind: 'auth' },
  { path: 'virtualNetwork.id', label: 'in network', kind: 'deploy' },
];

function idsAt(properties: unknown, path: string): string[] {
  const star = path.indexOf('[*]');
  if (star < 0) {
    const v = getPath(properties, path);
    return typeof v === 'string' && v.startsWith('/') ? [v] : [];
  }
  const list = getPath(properties, path.slice(0, star));
  if (!Array.isArray(list)) return [];
  const rest = path.slice(star + 4);
  return list.flatMap((item) => idsAt(item, rest));
}

/** `/subscriptions/x/resourceGroups/y/providers/Microsoft.Network/virtualNetworks/v/subnets/s` names a subnet; its vnet is the part before `/subnets/`. */
function subnetParent(id: string): string | undefined {
  const i = id.indexOf('/subnets/');
  return i > 0 ? id.slice(0, i) : undefined;
}

export function referencesOf(row: ArgRow): BatchRelation[] {
  const out = new Map<string, BatchRelation>();
  for (const ref of REFERENCES) {
    for (const target of idsAt(row.properties, ref.path)) {
      const to = target.toLowerCase();
      if (to === row.id.toLowerCase()) continue;
      const rel: BatchRelation = { from: row.id.toLowerCase(), to, label: ref.label, tags: [ref.path.replace(/\[\*\]/g, '')], ...(ref.kind !== undefined ? { kind: ref.kind } : {}) };
      out.set(`${to}#${ref.label}`, rel);
    }
  }
  return [...out.values()];
}

function factsOf(row: ArgRow): Record<string, FactValue> {
  const facts: Record<string, FactValue> = { type: row.type.toLowerCase(), subscriptionId: row.subscriptionId };
  if (row.location !== undefined) facts.location = row.location;
  if (row.resourceGroup !== undefined) facts.resourceGroup = row.resourceGroup;
  if (row.kind !== undefined && row.kind !== null) facts.kind = row.kind;
  const sku = FactValueSchema.safeParse(row.sku);
  if (sku.success && sku.data !== null) facts.sku = sku.data;
  const tags = FactValueSchema.safeParse(row.tags);
  if (tags.success && tags.data !== null && typeof tags.data === 'object' && Object.keys(tags.data).length) facts.tags = tags.data;
  const props = row.properties;
  for (const key of ['provisioningState', 'state', 'defaultHostName', 'addressSpace.addressPrefixes', 'hardwareProfile.vmSize', 'kubernetesVersion', 'version', 'primaryEndpoints.blob'] as const) {
    const v = FactValueSchema.safeParse(getPath(props, key));
    if (v.success && v.data !== null && v.data !== '') facts[key.split('.').pop() ?? key] = v.data;
  }
  return facts;
}

function portalUrl(endpoint: string, id: string): string {
  const portal = endpoint.includes('usgovcloudapi') ? 'https://portal.azure.us' : 'https://portal.azure.com';
  return `${portal}/#@/resource${id}`;
}

/** Reads as the connector's own app when the runner signed in as it; otherwise as whatever the machine signs in as. */
export function createAzureResourceGraphConnector(fallback: AzureTokenSource = defaultAzureTokenSource): Connector<AzureResourceGraphConfig> {
  return {
    id: 'azure-resource-graph',
    configSchema: AzureResourceGraphConfigSchema,
    async *discover(ctx: ConnectorContext<AzureResourceGraphConfig>): AsyncIterable<Batch> {
      const { config, log } = ctx;
      const token = ctx.identity ? await ctx.identity.token(`${new URL(config.endpoint).origin}/.default`) : await fallback.getToken(ctx.signal);
      log.info('azure token acquired', { subscriptions: config.subscriptions.length, as: ctx.identity ? 'connector app' : 'machine' });
      const url = `${config.endpoint.replace(/\/$/, '')}/providers/Microsoft.ResourceGraph/resources?api-version=${config.apiVersion}`;
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' };

      const subscriptions = new Map<string, BatchEntity>();
      const groups = new Map<string, BatchEntity>();
      const subnets = new Map<string, BatchEntity>();
      for (const sub of config.subscriptions) {
        subscriptions.set(subscriptionId(sub), { id: subscriptionId(sub), type: 'microsoft.resources/subscriptions', name: config.subscriptionNames[sub] ?? sub, subtitle: sub, facts: { subscriptionId: sub }, url: portalUrl(config.endpoint, `/subscriptions/${sub}`), tags: ['subscription'] });
      }

      let skipToken: string | undefined;
      let page = 0;
      let total = 0;
      for (;;) {
        const body = { subscriptions: config.subscriptions, query: config.query, options: { $top: config.pageSize, resultFormat: 'objectArray', ...(skipToken !== undefined ? { $skipToken: skipToken } : {}) } };
        const res = await fetchJson<ArgResponse>(ctx, url, { method: 'POST', headers, body: JSON.stringify(body) });
        page++;
        total += res.data.length;
        log.debug('azure resource graph page', { page, rows: res.data.length, totalRecords: res.totalRecords, more: res.$skipToken !== undefined });
        if (res.resultTruncated === 'true') log.warn('azure resource graph truncated the result', { page });
        const entities: BatchEntity[] = [];
        const relations: BatchRelation[] = [];
        for (const row of res.data) {
          const id = row.id.toLowerCase();
          const rg = row.resourceGroup;
          const parent = rg !== undefined ? resourceGroupId(row.subscriptionId, rg) : subscriptionId(row.subscriptionId);
          if (rg !== undefined && !groups.has(parent)) {
            groups.set(parent, { id: parent, type: 'microsoft.resources/subscriptions/resourcegroups', name: rg, parent: subscriptionId(row.subscriptionId), facts: { subscriptionId: row.subscriptionId, resourceGroup: rg }, url: portalUrl(config.endpoint, `/subscriptions/${row.subscriptionId}/resourceGroups/${rg}`), tags: ['resource-group'] });
          }
          entities.push({ id, type: row.type.toLowerCase(), name: row.name, parent, ...(row.location !== undefined ? { subtitle: row.location } : {}), facts: factsOf(row), url: portalUrl(config.endpoint, row.id), tags: [row.type.toLowerCase().split('/')[0] ?? 'azure'] });
          const refs = referencesOf(row);
          for (const r of refs) {
            const vnet = subnetParent(r.to);
            if (vnet !== undefined && !subnets.has(r.to)) {
              subnets.set(r.to, { id: r.to, type: 'microsoft.network/virtualnetworks/subnets', name: r.to.slice(r.to.lastIndexOf('/') + 1), parent: vnet, facts: {}, url: portalUrl(config.endpoint, r.to), tags: ['subnet'] });
            }
          }
          relations.push(...refs);
        }
        yield { source: 'azure-resource-graph', observed: ctx.now().toISOString(), partial: true, entities, relations };
        if (res.$skipToken === undefined || res.data.length === 0) break;
        skipToken = res.$skipToken;
      }
      log.info('azure resource graph read', { pages: page, resources: total, resourceGroups: groups.size, subscriptions: subscriptions.size, subnets: subnets.size });
      yield { source: 'azure-resource-graph', observed: ctx.now().toISOString(), partial: true, entities: [...subscriptions.values(), ...groups.values(), ...subnets.values()], relations: [] };
    },
  };
}

export const azureResourceGraphConnector: Connector<AzureResourceGraphConfig> = createAzureResourceGraphConnector();
