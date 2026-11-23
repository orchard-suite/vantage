/**
 * The visual diff of one view between two versions: both texts are loaded,
 * laid out, and compared on the render pool; the result is the newer
 * picture with highlights and the narrative of what changed.
 */
import type { LayoutChange } from '@vantage/layout';
import type { AppContext } from '../context.ts';
import { badRequest, notFound } from '../http.ts';
import type { DocumentRow, VersionRow } from './repo.ts';
import { resourceInputs } from './assets.ts';

export interface VisualDiff {
  readonly svg: string;
  readonly changes: readonly LayoutChange[];
}

export async function visualDiff(ctx: AppContext, doc: DocumentRow, from: VersionRow, to: VersionRow, viewId: string, theme: 'light' | 'dark' = 'light'): Promise<VisualDiff> {
  const resources = await resourceInputs(ctx, { orgId: doc.org_id, workspaceId: doc.workspace_id, attachments: to.attachments });
  const out = await ctx.render.run('diff', { from: { yaml: from.yaml, imports: from.imports }, to: { yaml: to.yaml, imports: to.imports }, resources, viewId, theme });
  if (!out.ok && out.reason === 'unparsable') throw badRequest('one of the versions does not parse');
  if (!out.ok) throw notFound(`view ${viewId} in both versions`);
  return { svg: out.svg, changes: out.changes };
}
