/**
 * Draws and checks a document the hub holds, named by its address, with
 * its imports, its pictures, and its workspace's icons, so an agent never
 * sends back text the hub already has.
 */
import type { SavedDocuments } from '@vantage/mcp';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { checkDocument, describeFinding } from '../documents/check.ts';
import { resourceInputs } from '../documents/assets.ts';
import { badRequest } from '../http.ts';
import { parseAddress } from '../text/address.ts';
import { requireDocumentAt } from '../text/things.ts';
import { refusalText, text } from './run.ts';

export function savedDocuments(ctx: AppContext, p: Principal): SavedDocuments {
  const at = async (address: string) => {
    const a = parseAddress(address);
    if (a.kind !== 'document') throw badRequest(`${address} is not a document; a document's address is workspace/document`);
    return requireDocumentAt(ctx, p, a, 'viewer');
  };
  const guarded = async <T>(run: () => Promise<T>): Promise<T | ReturnType<typeof text>> => {
    try {
      return await run();
    } catch (err) {
      return text(refusalText(err), true);
    }
  };
  return {
    text: async (address) => (await at(address)).head.yaml,
    validate: (address) =>
      guarded(async () => {
        const { ws, doc, head } = await at(address);
        const out = await checkDocument(ctx, { orgId: p.orgId, workspaceId: ws.id, attachments: head.attachments }, { yaml: head.yaml, imports: head.imports, scores: true });
        const lines = [
          ...out.errors.map((f) => `error ${describeFinding(f)}`),
          ...out.warnings.map((f) => `warning ${describeFinding(f)}`),
          ...out.notes.map((f) => `note ${describeFinding(f)}`),
          ...out.views.flatMap((v) => [`${v.id}: ${v.score === undefined ? v.kind : `score ${v.score}`}`, ...(v.notes ?? []).map((n) => `  - ${n}`)]),
          out.errors.length ? 'errors found; fix them' : `ok: ${ws.slug}/${doc.slug} version ${head.id}, ${out.views.length} views`,
        ];
        return text(lines.join('\n'), out.errors.length > 0);
      }),
    render: (address, args) =>
      guarded(async () => {
        const { ws, doc, head } = await at(address);
        const resources = await resourceInputs(ctx, { orgId: doc.org_id, workspaceId: doc.workspace_id, attachments: head.attachments });
        const theme = args.theme === 'dark' ? 'dark' : 'light';
        const out = await ctx.render.run('preview', { yaml: head.yaml, imports: head.imports, resources, view: args.view, theme });
        if (out.svg === null) return text(`${ws.slug}/${doc.slug} has no view ${args.view ?? ''} to draw; its views: ${out.views.map((v) => v.id).join(', ') || 'none'}\n${out.diagnostics.map((d) => `${d.severity}: ${d.message}`).join('\n')}`, true);
        const notes = `view ${out.view}: score ${out.metrics?.score ?? 'none'}${out.metrics?.notes.length ? `\n- ${out.metrics.notes.join('\n- ')}` : ''}`;
        if (args.format === 'svg') return { content: [{ type: 'text', text: out.svg }, { type: 'text', text: notes }] };
        const png = await ctx.render.run('png', { svg: out.svg, scale: args.scale ?? 1.5 });
        return { content: [{ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }, { type: 'text', text: notes }] };
      }),
  };
}
