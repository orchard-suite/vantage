/**
 * Deleting a diagram: the document row goes, and its versions, comments,
 * stars, guest links, publications, and voice walkthroughs go with it.
 * Files only its versions held and the walkthroughs' audio leave the blob
 * store; drawn artifacts go at the next gc. The audit
 * entry names the workspace, so the workspace's activity keeps it.
 */
import type { AppContext } from '../context.ts';
import type { Surface } from '../audit.ts';
import { audit } from '../audit.ts';
import { releaseFiles } from '../worker/gc.ts';
import { recordingKeys } from '../recordings.ts';
import type { DocumentRow } from './repo.ts';

export interface DeleteActor {
  readonly orgId: string;
  readonly userId: string;
  readonly who: string;
  readonly surface: Surface;
}

export async function deleteDocument(ctx: AppContext, actor: DeleteActor, document: DocumentRow): Promise<void> {
  const held = await ctx.db.query<{ hash: string }>("select distinct a->>'hash' as hash from versions v, jsonb_array_elements(v.attachments) a where v.document_id = $1", [document.id]);
  const audio = await recordingKeys(ctx.db, document.id);
  await ctx.db.transaction(async (tx) => {
    await tx.query('delete from documents where id = $1', [document.id]);
    await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'document.delete', surface: actor.surface, target: `workspace:${document.workspace_id}`, details: { documentId: document.id, slug: document.slug, name: document.name } });
  });
  const files = await releaseFiles(ctx, actor.orgId, new Set(held.map((r) => r.hash)), new Set());
  for (const key of audio) await ctx.blob.delete(key);
  ctx.log.info('document.deleted', { documentId: document.id, workspaceId: document.workspace_id, by: actor.userId, filesRemoved: files, recordingsRemoved: audio.length });
}
