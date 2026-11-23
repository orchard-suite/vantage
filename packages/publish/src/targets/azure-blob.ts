/**
 * Azure Blob Storage over its REST API: PUT each artifact as a block blob.
 * Auth is a SAS token (secret ref `sas`) or a bearer token (secret ref
 * `token`, for workload identity through a token exchanger). A static
 * website container (`$web`) makes the interactive HTML a live page that
 * SharePoint or any wiki can embed.
 */
import { z } from 'zod';
import { timed, type Target } from '../target.ts';

const Config = z
  .object({
    account: z.string().min(1).describe('Storage account name'),
    container: z.string().min(1).describe('Container, for example $web'),
    prefix: z.string().optional().describe('Folder inside the container'),
    auth: z.enum(['sas', 'token']).default('sas'),
    secret: z.string().default('sas').describe('Secret reference holding the SAS query string or the bearer token'),
    endpoint: z.string().optional().describe('Override the blob endpoint, for sovereign clouds or emulators'),
  })
  .strict();

export const azureBlobTarget: Target<z.output<typeof Config>> = {
  id: 'azure-blob',
  description: 'Azure Blob Storage container, including a static website container',
  configSchema: Config,
  async publish(ctx, artifacts) {
    const c = ctx.config;
    const base = (c.endpoint ?? `https://${c.account}.blob.core.windows.net`).replace(/\/$/, '');
    const secret = await ctx.secrets(c.secret);
    const prefix = c.prefix ? `${c.prefix.replace(/^\/|\/$/g, '')}/` : '';
    ctx.log.info('publish start', { target: 'azure-blob', account: c.account, container: c.container, artifacts: artifacts.length, auth: c.auth });
    return timed('azure-blob', async () => {
      const written = [];
      const skipped = [];
      for (const a of artifacts) {
        const path = `${c.container}/${prefix}${a.filename}`;
        const url = c.auth === 'sas' ? `${base}/${path}?${secret.replace(/^\?/, '')}` : `${base}/${path}`;
        const res = await ctx.fetch(url, {
          method: 'PUT',
          headers: {
            'x-ms-blob-type': 'BlockBlob',
            'x-ms-version': '2023-11-03',
            'content-type': a.contentType,
            'x-ms-blob-cache-control': a.kind === 'html' ? 'no-cache' : 'public, max-age=300',
            'x-ms-meta-vantage-version': a.stamp.version,
            ...(c.auth === 'token' ? { authorization: `Bearer ${secret}` } : {}),
          },
          body: a.bytes,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        if (res.ok) {
          written.push({ artifact: a.filename, location: `${base}/${path}`, bytes: a.bytes.byteLength });
          ctx.log.debug('put ok', { path, status: res.status });
        } else {
          const reason = `${res.status} ${await res.text().catch(() => '')}`.trim();
          skipped.push({ artifact: a.filename, reason });
          ctx.log.warn('put failed', { path, reason });
        }
      }
      ctx.log.info('publish end', { target: 'azure-blob', written: written.length, skipped: skipped.length });
      return { written, skipped };
    }, ctx.now);
  },
};
