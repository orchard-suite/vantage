/**
 * Draws and checks a document the hub holds, named by its address, with
 * its imports, its pictures, and its workspace's icons, so an agent never
 * sends back text the hub already has.
 */
import type { SavedDocuments, SavedDrawing } from '@vantage/mcp';
import { formatDiagnostic } from '@vantage/model';
import type { SavedDrawInput } from '../render/saved-draw-task.ts';
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
  const draw = async (address: string, what: SavedDrawInput['draw']): Promise<SavedDrawing> => {
    try {
      const { doc, head } = await at(address);
      const resources = await resourceInputs(ctx, { orgId: doc.org_id, workspaceId: doc.workspace_id, attachments: head.attachments });
      const out = await ctx.render.run('savedDraw', { yaml: head.yaml, imports: head.imports, resources, draw: what });
      return out.drawn ? { drawn: out.drawn } : { refused: text(out.diagnostics.map(formatDiagnostic).join('\n') || `${address} drew nothing`, true) };
    } catch (err) {
      return { refused: text(refusalText(err), true) };
    }
  };
  return {
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
    drawView: (address, view) => draw(address, { view }),
    drawExplore: (address, explore) => draw(address, { explore }),
    drawDocument: (address, document) => draw(address, { document }),
  };
}
