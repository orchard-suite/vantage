import { describe, expect, test } from 'bun:test';
import { mergeBatches } from '../../batch.ts';
import type { FetchLike } from '../../connector.ts';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { AzureResourceGraphConfigSchema, createAzureResourceGraphConnector, DEFAULT_ARG_QUERY, referencesOf, resourceGroupId, subscriptionId } from './azure-resource-graph.ts';

const dir = `${import.meta.dir}/fixtures`;
const SUB = '11111111-2222-4333-8444-555555555555';
const prefix = `/subscriptions/${SUB}`;

function arg() {
  const f = fixtureFetch(dir, []);
  const paged = fixtureFetch(dir, [{ match: 'Microsoft.ResourceGraph', file: 'page-1.json' }]);
  const second = fixtureFetch(dir, [{ match: 'Microsoft.ResourceGraph', file: 'page-2.json' }]);
  const fetch: FetchLike = async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    f.calls.push({ url: String(input), method: init?.method ?? 'GET', headers: {}, body, init });
    return body.includes('skip-page-2') ? second.fetch(input, init) : paged.fetch(input, init);
  };
  return { fetch, calls: f.calls };
}

const tokens = { getToken: async () => 'arm-token' };
const config = AzureResourceGraphConfigSchema.parse({ subscriptions: [SUB], pageSize: 4, subscriptionNames: { [SUB]: 'Shop Prod' } });

describe('azure resource graph connector', () => {
  test('posts the KQL per page with the bearer token and follows the skip token', async () => {
    const a = arg();
    const ctx = testContext(config, a.fetch);
    const batches = await drain(createAzureResourceGraphConnector(tokens).discover(ctx));
    expect(a.calls).toHaveLength(2);
    expect(a.calls[0]?.url).toBe('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01');
    const first = JSON.parse(a.calls[0]?.body ?? '{}') as { subscriptions: string[]; query: string; options: Record<string, unknown> };
    expect(first.subscriptions).toEqual([SUB]);
    expect(first.query).toBe(DEFAULT_ARG_QUERY);
    expect(first.options).toEqual({ $top: 4, resultFormat: 'objectArray' });
    const second = JSON.parse(a.calls[1]?.body ?? '{}') as { options: Record<string, unknown> };
    expect(second.options.$skipToken).toBe('skip-page-2');
    expect((a.calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer arm-token');
    expect(batches).toHaveLength(3);
    expect(ctx.log.records.filter((r) => r.message === 'azure resource graph page')).toHaveLength(2);
  });

  test('synthesizes subscription and resource group parents and maps resource facts', async () => {
    const ctx = testContext(config, arg().fetch);
    const all = mergeBatches(await drain(createAzureResourceGraphConnector(tokens).discover(ctx)), '2026-10-28T10:00:00Z');
    const byId = new Map(all.entities.map((e) => [e.id, e]));
    expect(byId.get(subscriptionId(SUB))).toMatchObject({ type: 'microsoft.resources/subscriptions', name: 'Shop Prod' });
    expect(byId.get(resourceGroupId(SUB, 'rg-web'))).toMatchObject({ type: 'microsoft.resources/subscriptions/resourcegroups', name: 'rg-web', parent: subscriptionId(SUB) });
    const app = byId.get(`${prefix}/resourcegroups/rg-web/providers/microsoft.web/sites/app-shop`);
    expect(app).toMatchObject({ type: 'microsoft.web/sites', name: 'app-shop', parent: resourceGroupId(SUB, 'rg-web'), subtitle: 'eastus2', tags: ['microsoft.web'] });
    expect(app?.facts).toMatchObject({ location: 'eastus2', resourceGroup: 'rg-web', kind: 'app,linux', tags: { env: 'prod', owner: 'platform' }, state: 'Running', defaultHostName: 'app-shop.azurewebsites.test' });
    expect(app?.facts?.sku).toBeUndefined();
    expect(byId.get(`${prefix}/resourcegroups/rg-web/providers/microsoft.web/serverfarms/plan-web`)?.facts?.sku).toEqual({ name: 'P1v3', tier: 'PremiumV3' });
    expect(app?.url).toBe(`https://portal.azure.com/#@/resource${prefix}/resourceGroups/rg-web/providers/Microsoft.Web/sites/app-shop`);
    expect(all.entities.filter((e) => e.type === 'microsoft.resources/subscriptions/resourcegroups')).toHaveLength(3);
  });

  test('derives relations from well-known properties and synthesizes subnets under their vnet', async () => {
    const ctx = testContext(config, arg().fetch);
    const all = mergeBatches(await drain(createAzureResourceGraphConnector(tokens).discover(ctx)), '2026-10-28T10:00:00Z');
    const rel = (label: string) => all.relations.filter((r) => r.label === label).map((r) => `${r.from.slice(prefix.length)}>${r.to.slice(prefix.length)}`);
    expect(rel('hosted on')).toEqual(['/resourcegroups/rg-web/providers/microsoft.web/sites/app-shop>/resourcegroups/rg-web/providers/microsoft.web/serverfarms/plan-web']);
    expect(rel('in subnet')).toEqual([
      '/resourcegroups/rg-web/providers/microsoft.web/sites/app-shop>/resourcegroups/rg-net/providers/microsoft.network/virtualnetworks/vnet-hub/subnets/snet-apps',
      '/resourcegroups/rg-data/providers/microsoft.network/privateendpoints/pe-sql>/resourcegroups/rg-net/providers/microsoft.network/virtualnetworks/vnet-hub/subnets/snet-data',
    ]);
    expect(rel('connects to')).toEqual(['/resourcegroups/rg-data/providers/microsoft.network/privateendpoints/pe-sql>/resourcegroups/rg-data/providers/microsoft.sql/servers/sql-shop']);
    expect(rel('reached by')).toEqual(['/resourcegroups/rg-data/providers/microsoft.sql/servers/sql-shop>/resourcegroups/rg-data/providers/microsoft.network/privateendpoints/pe-sql']);
    const subnet = all.entities.find((e) => e.id.endsWith('/subnets/snet-apps'));
    expect(subnet).toMatchObject({ type: 'microsoft.network/virtualnetworks/subnets', name: 'snet-apps', parent: `${prefix}/resourcegroups/rg-net/providers/microsoft.network/virtualnetworks/vnet-hub` });
    expect(all.entities.filter((e) => e.type === 'microsoft.network/virtualnetworks/subnets')).toHaveLength(2);
  });

  test('referencesOf reads single and starred paths and skips self references', () => {
    const rels = referencesOf({
      id: '/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/vm',
      name: 'vm',
      type: 'microsoft.compute/virtualmachines',
      subscriptionId: 's',
      properties: {
        networkProfile: { networkInterfaces: [{ id: '/subscriptions/s/resourceGroups/g/providers/Microsoft.Network/networkInterfaces/nic1' }, { id: '/subscriptions/s/resourceGroups/g/providers/Microsoft.Network/networkInterfaces/nic2' }] },
        storageProfile: { osDisk: { managedDisk: { id: '/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/disks/os' } }, dataDisks: [] },
        serverFarmId: '/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/vm',
      },
    });
    expect(rels.map((r) => `${r.label}:${r.to.split('/').pop()}`)).toEqual(['uses:nic1', 'uses:nic2', 'boots from:os']);
  });
});
