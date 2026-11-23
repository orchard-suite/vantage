/**
 * HTTP targets: a plain webhook (one JSON POST with the artifacts inline),
 * SharePoint and OneDrive through Microsoft Graph (PUT file content into a
 * drive path), Confluence attachments, and a Teams incoming webhook card
 * with the live link. All use the injected fetch, so tests run offline.
 */
import { z } from 'zod';
import { timed, type Artifact, type Target } from '../target.ts';

const toBase64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

const WebhookConfig = z.object({ url: z.string().url(), secret: z.string().optional().describe('Secret reference sent as a bearer token') }).strict();

export const webhookTarget: Target<z.output<typeof WebhookConfig>> = {
  id: 'webhook',
  description: 'POST every artifact as JSON to a URL',
  configSchema: WebhookConfig,
  async publish(ctx, artifacts) {
    const token = ctx.config.secret ? await ctx.secrets(ctx.config.secret) : undefined;
    ctx.log.info('publish start', { target: 'webhook', url: ctx.config.url, artifacts: artifacts.length });
    return timed('webhook', async () => {
      const body = JSON.stringify({ artifacts: artifacts.map((a) => ({ kind: a.kind, viewId: a.viewId, filename: a.filename, contentType: a.contentType, stamp: a.stamp, base64: toBase64(a.bytes) })) });
      const res = await ctx.fetch(ctx.config.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });
      if (!res.ok) {
        ctx.log.warn('webhook rejected', { status: res.status });
        return { written: [], skipped: artifacts.map((a) => ({ artifact: a.filename, reason: `${res.status}` })) };
      }
      ctx.log.info('publish end', { target: 'webhook', written: artifacts.length });
      return { written: artifacts.map((a) => ({ artifact: a.filename, location: ctx.config.url, bytes: a.bytes.byteLength })), skipped: [] };
    }, ctx.now);
  },
};

const GraphConfig = z
  .object({
    drive: z.string().min(1).describe('Graph drive id, or `sites/<siteId>/drive` for a SharePoint document library'),
    path: z.string().default('Diagrams').describe('Folder path inside the drive'),
    secret: z.string().default('token').describe('Secret reference holding a Graph bearer token (Files.ReadWrite.All or Sites.ReadWrite.All)'),
    endpoint: z.string().default('https://graph.microsoft.com/v1.0'),
  })
  .strict();

/** Pictures and PDFs land in the library; interactive HTML is uploaded too, though SharePoint serves it as a download. */
export const sharepointTarget: Target<z.output<typeof GraphConfig>> = {
  id: 'sharepoint',
  description: 'A SharePoint document library or OneDrive folder through Microsoft Graph',
  configSchema: GraphConfig,
  async publish(ctx, artifacts) {
    const c = ctx.config;
    const token = await ctx.secrets(c.secret);
    const drive = c.drive.startsWith('sites/') ? `${c.endpoint}/${c.drive}` : `${c.endpoint}/drives/${c.drive}`;
    ctx.log.info('publish start', { target: 'sharepoint', drive: c.drive, path: c.path, artifacts: artifacts.length });
    return timed('sharepoint', async () => {
      const written = [];
      const skipped = [];
      for (const a of artifacts) {
        const item = `${drive}/root:/${encodeURI(`${c.path.replace(/^\/|\/$/g, '')}/${a.filename}`)}:/content`;
        const res = await ctx.fetch(item, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': a.contentType }, body: a.bytes });
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as { webUrl?: string };
          written.push({ artifact: a.filename, location: json.webUrl ?? item, bytes: a.bytes.byteLength });
        } else {
          skipped.push({ artifact: a.filename, reason: `${res.status}` });
          ctx.log.warn('graph put failed', { file: a.filename, status: res.status });
        }
      }
      ctx.log.info('publish end', { target: 'sharepoint', written: written.length, skipped: skipped.length });
      return { written, skipped };
    }, ctx.now);
  },
};

const ConfluenceConfig = z
  .object({
    baseUrl: z.string().url().describe('For example https://example.atlassian.net/wiki'),
    pageId: z.string().min(1),
    secret: z.string().default('token').describe('Secret reference holding `email:apiToken` for basic auth, or a bearer token when `auth: bearer`'),
    auth: z.enum(['basic', 'bearer']).default('basic'),
  })
  .strict();

export const confluenceTarget: Target<z.output<typeof ConfluenceConfig>> = {
  id: 'confluence',
  description: 'Attachments on a Confluence page, replacing by name',
  configSchema: ConfluenceConfig,
  async publish(ctx, artifacts) {
    const c = ctx.config;
    const secret = await ctx.secrets(c.secret);
    const auth = c.auth === 'basic' ? `Basic ${Buffer.from(secret).toString('base64')}` : `Bearer ${secret}`;
    ctx.log.info('publish start', { target: 'confluence', pageId: c.pageId, artifacts: artifacts.length });
    return timed('confluence', async () => {
      const written = [];
      const skipped = [];
      for (const a of artifacts) {
        const form = new FormData();
        form.append('file', new Blob([a.bytes], { type: a.contentType }), a.filename);
        form.append('comment', `Vantage ${a.stamp.version} published ${a.stamp.publishedAt}`);
        form.append('minorEdit', 'true');
        const res = await ctx.fetch(`${c.baseUrl}/rest/api/content/${c.pageId}/child/attachment`, { method: 'PUT', headers: { authorization: auth, 'X-Atlassian-Token': 'nocheck' }, body: form });
        if (res.ok) written.push({ artifact: a.filename, location: `${c.baseUrl}/pages/viewpageattachments.action?pageId=${c.pageId}`, bytes: a.bytes.byteLength });
        else skipped.push({ artifact: a.filename, reason: `${res.status}` });
      }
      ctx.log.info('publish end', { target: 'confluence', written: written.length, skipped: skipped.length });
      return { written, skipped };
    }, ctx.now);
  },
};

const TeamsConfig = z.object({ webhook: z.string().describe('Secret reference holding the incoming webhook URL'), title: z.string().optional() }).strict();

/** A card with the live link and the publish stamp; images are linked, not embedded, because webhooks cannot carry files. */
export const teamsTarget: Target<z.output<typeof TeamsConfig>> = {
  id: 'teams',
  description: 'A Microsoft Teams channel message with the live link',
  configSchema: TeamsConfig,
  async publish(ctx, artifacts) {
    const url = await ctx.secrets(ctx.config.webhook);
    const first: Artifact | undefined = artifacts[0];
    ctx.log.info('publish start', { target: 'teams', artifacts: artifacts.length });
    return timed('teams', async () => {
      if (!first) return { written: [], skipped: [] };
      const facts = artifacts.map((a) => ({ title: a.filename, value: a.stamp.liveUrl ? `[open](${a.stamp.liveUrl})` : a.stamp.version }));
      const card = {
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: ctx.config.title ?? `${first.stamp.title} updated` },
          { type: 'TextBlock', text: `Version ${first.stamp.version}, published ${first.stamp.publishedAt}`, wrap: true, isSubtle: true },
          { type: 'FactSet', facts },
        ], ...(first.stamp.liveUrl ? { actions: [{ type: 'Action.OpenUrl', title: 'Open live diagram', url: first.stamp.liveUrl }] } : {}) } }],
      };
      const res = await ctx.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card) });
      ctx.log.info('publish end', { target: 'teams', status: res.status });
      return res.ok ? { written: [{ artifact: 'card', location: 'teams', bytes: 0 }], skipped: [] } : { written: [], skipped: [{ artifact: 'card', reason: `${res.status}` }] };
    }, ctx.now);
  },
};
