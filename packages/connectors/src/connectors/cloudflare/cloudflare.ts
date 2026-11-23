/**
 * Reads a Cloudflare account over the v4 API with an API token: zones, DNS
 * records, Zero Trust tunnels, and Access applications. A CNAME record that
 * points at `<tunnel id>.cfargotunnel.com` gets an arrow to its tunnel; an
 * Access application gets an arrow to the record whose name it protects.
 */
import { z } from 'zod';
import type { Batch, BatchEntity, BatchRelation, FactValue } from '../../batch.ts';
import { fetchJson, type Connector, type ConnectorContext } from '../../connector.ts';

export const CloudflareConfigSchema = z
  .object({
    token: z.string().min(1).describe('Secret reference for the API token'),
    accountId: z.string().min(1).describe('Account whose tunnels and Access applications are read'),
    accountName: z.string().optional().describe('Display name for the synthesized account entity'),
    zones: z.array(z.string()).optional().describe('Zone names to read; default every zone the token sees'),
    baseUrl: z.string().url().default('https://api.cloudflare.com/client/v4'),
    pageSize: z.number().int().min(1).max(5000).default(100),
  })
  .strict();

export type CloudflareConfig = z.output<typeof CloudflareConfigSchema>;

interface Envelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; per_page: number; total_pages: number; count: number; total_count: number };
}

interface Zone {
  id: string;
  name: string;
  status: string;
  paused?: boolean;
  plan?: { name?: string };
  name_servers?: string[];
}

interface DnsRecord {
  id: string;
  zone_id: string;
  name: string;
  type: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string | null;
}

interface Tunnel {
  id: string;
  name: string;
  status?: string;
  remote_config?: boolean;
  connections?: { colo_name?: string; client_version?: string }[];
}

interface AccessApp {
  id: string;
  name: string;
  domain?: string;
  type?: string;
  session_duration?: string;
  self_hosted_domains?: string[];
}

export function cloudflareIds(accountId: string): { account: string; zone: (id: string) => string; record: (id: string) => string; tunnel: (id: string) => string; app: (id: string) => string } {
  return {
    account: `account:${accountId}`,
    zone: (id) => `zone:${id}`,
    record: (id) => `dns-record:${id}`,
    tunnel: (id) => `tunnel:${id}`,
    app: (id) => `access-app:${id}`,
  };
}

async function* pages<T>(ctx: ConnectorContext<CloudflareConfig>, path: string, headers: Record<string, string>, extra: Record<string, string> = {}): AsyncGenerator<T[]> {
  let page = 1;
  for (;;) {
    const q = new URLSearchParams({ page: String(page), per_page: String(ctx.config.pageSize), ...extra });
    const res = await fetchJson<Envelope<T[]>>(ctx, `${ctx.config.baseUrl}${path}?${q}`, { headers });
    if (!res.success) throw new Error(`cloudflare ${path}: ${res.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
    ctx.log.debug('cloudflare page', { path, page, count: res.result.length, totalPages: res.result_info?.total_pages ?? 1 });
    yield res.result;
    if (!res.result_info || page >= res.result_info.total_pages || res.result.length === 0) return;
    page++;
  }
}

async function all<T>(ctx: ConnectorContext<CloudflareConfig>, path: string, headers: Record<string, string>, extra?: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for await (const p of pages<T>(ctx, path, headers, extra)) out.push(...p);
  return out;
}

function facts(entries: Record<string, FactValue | undefined | null>): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  for (const [k, v] of Object.entries(entries)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

export const cloudflareConnector: Connector<CloudflareConfig> = {
  id: 'cloudflare',
  configSchema: CloudflareConfigSchema,
  async *discover(ctx: ConnectorContext<CloudflareConfig>): AsyncIterable<Batch> {
    const { config, log } = ctx;
    const token = await ctx.secrets(config.token);
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const ids = cloudflareIds(config.accountId);
    const dash = 'https://dash.cloudflare.com';
    const observed = (): string => ctx.now().toISOString();

    const account: BatchEntity = { id: ids.account, type: 'cloudflare-account', name: config.accountName ?? config.accountId, facts: { accountId: config.accountId }, url: `${dash}/${config.accountId}`, tags: ['account'] };

    let zones = await all<Zone>(ctx, '/zones', headers, { 'account.id': config.accountId });
    if (config.zones) zones = zones.filter((z) => config.zones?.includes(z.name));
    log.info('cloudflare zones listed', { count: zones.length, filtered: config.zones !== undefined });

    const tunnels = await all<Tunnel>(ctx, `/accounts/${config.accountId}/cfd_tunnel`, headers, { is_deleted: 'false' });
    log.info('cloudflare tunnels listed', { count: tunnels.length });
    const tunnelByHost = new Map(tunnels.map((t) => [`${t.id}.cfargotunnel.com`, t]));
    const tunnelEntities: BatchEntity[] = tunnels.map((t) => ({
      id: ids.tunnel(t.id),
      type: 'tunnel',
      name: t.name,
      parent: ids.account,
      subtitle: `${t.id}.cfargotunnel.com`,
      facts: facts({ status: t.status, remoteConfig: t.remote_config, connections: t.connections?.length ?? 0, colos: [...new Set((t.connections ?? []).map((c) => c.colo_name).filter((c): c is string => c !== undefined))] }),
      url: `https://one.dash.cloudflare.com/${config.accountId}/networks/tunnels`,
      tags: ['tunnel'],
    }));
    yield { source: 'cloudflare', observed: observed(), partial: true, entities: [account, ...tunnelEntities], relations: [] };

    const recordsByName = new Map<string, string>();
    for (const zone of zones) {
      const records = await all<DnsRecord>(ctx, `/zones/${zone.id}/dns_records`, headers);
      const entities: BatchEntity[] = [
        {
          id: ids.zone(zone.id),
          type: 'zone',
          name: zone.name,
          parent: ids.account,
          facts: facts({ status: zone.status, paused: zone.paused, plan: zone.plan?.name, nameServers: zone.name_servers ?? [] }),
          url: `${dash}/${config.accountId}/${zone.name}`,
          tags: ['zone'],
        },
      ];
      const relations: BatchRelation[] = [];
      for (const r of records) {
        entities.push({
          id: ids.record(r.id),
          type: 'dns-record',
          name: r.name,
          parent: ids.zone(zone.id),
          subtitle: `${r.type} ${r.content}`,
          facts: facts({ type: r.type, content: r.content, proxied: r.proxied, ttl: r.ttl, comment: r.comment }),
          url: `${dash}/${config.accountId}/${zone.name}/dns/records`,
          tags: ['dns-record', r.type.toLowerCase()],
        });
        recordsByName.set(r.name.toLowerCase(), ids.record(r.id));
        const tunnel = r.type === 'CNAME' ? tunnelByHost.get(r.content.toLowerCase()) : undefined;
        if (tunnel) relations.push({ from: ids.record(r.id), to: ids.tunnel(tunnel.id), label: 'points to', kind: 'sync', tags: ['tunnel'] });
      }
      log.info('cloudflare zone read', { zone: zone.name, records: records.length, tunnelRelations: relations.length });
      yield { source: 'cloudflare', observed: observed(), partial: true, entities, relations };
    }

    const apps = await all<AccessApp>(ctx, `/accounts/${config.accountId}/access/apps`, headers);
    const appEntities: BatchEntity[] = [];
    const appRelations: BatchRelation[] = [];
    for (const a of apps) {
      appEntities.push({
        id: ids.app(a.id),
        type: 'access-application',
        name: a.name,
        parent: ids.account,
        ...(a.domain !== undefined ? { subtitle: a.domain } : {}),
        facts: facts({ domain: a.domain, type: a.type, sessionDuration: a.session_duration }),
        url: `https://one.dash.cloudflare.com/${config.accountId}/access/apps`,
        tags: ['access-application'],
      });
      const hosts = [a.domain, ...(a.self_hosted_domains ?? [])].filter((h): h is string => h !== undefined).map((h) => h.split('/')[0]?.toLowerCase() ?? '');
      for (const host of new Set(hosts)) {
        const record = recordsByName.get(host);
        if (record) appRelations.push({ from: ids.app(a.id), to: record, label: 'protects', kind: 'auth', tags: ['access'] });
        else log.debug('cloudflare access app host has no record', { app: a.name, host });
      }
    }
    log.info('cloudflare access apps listed', { count: apps.length, relations: appRelations.length });
    yield { source: 'cloudflare', observed: observed(), partial: true, entities: appEntities, relations: appRelations };
  },
};
