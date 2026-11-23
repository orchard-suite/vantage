/**
 * Moving a diagram to another workspace of the same organization. The
 * document keeps its id, versions, comments, stars, guest links, and
 * voice walkthroughs; its publications go with it. It leaves its folder,
 * and the workspace icons it names are copied to the new workspace so the
 * picture still draws. Live data now comes from the new workspace's
 * connectors, so the picture is drawn again there. Both workspaces' activity
 * records the move.
 *
 * A document that defines a kind of item takes the kind and its items with
 * it: a program's roadmap and work live where its diagrams do. The old
 * address stays an alias, so a link or a tool that names it is sent to the
 * new one (movedTo).
 */
import type { AppContext } from '../context.ts';
import type { Surface } from '../audit.ts';
import { audit } from '../audit.ts';
import { HttpError } from '../http.ts';
import { enqueueDraw } from '../worker/jobs.ts';
import { headVersion, type DocumentRow } from './repo.ts';
import type { WorkspaceRow } from '../authz.ts';

export interface MoveActor {
  readonly orgId: string;
  readonly userId: string;
  readonly who: string;
  readonly surface: Surface;
}

export async function moveDocument(ctx: AppContext, actor: MoveActor, document: DocumentRow, to: WorkspaceRow): Promise<DocumentRow> {
  if (to.id === document.workspace_id) return document;
  const head = await headVersion(ctx.db, document);
  // A workspace icon is named as pack/name; the head's text says which ones it uses.
  const text = head ? [head.yaml, ...Object.values(head.imports)].join('\n') : '';
  const moved = await ctx.db.transaction(async (tx) => {
    const taken = await tx.query('select 1 as x from documents where workspace_id = $1 and slug = $2', [to.id, document.slug]);
    if (taken.length) throw new HttpError(409, `${to.name} already has a diagram at ${document.slug}; rename one of them first`);
    const icons = await tx.query<{ id: string }>('select id from workspace_icons where workspace_id = $1', [document.workspace_id]);
    const named = icons.map((i) => i.id).filter((id) => text.includes(id));
    if (named.length) {
      await tx.query(
        `insert into workspace_icons (workspace_id, org_id, id, hash, content_type, size)
           select $2, org_id, id, hash, content_type, size from workspace_icons where workspace_id = $1 and id = any($3::text[])
         on conflict (workspace_id, id) do nothing`,
        [document.workspace_id, to.id, named],
      );
    }
    const rows = await tx.query<DocumentRow>('update documents set workspace_id = $2, folder_id = null where id = $1 returning *', [document.id, to.id]);
    await tx.query('update publications set workspace_id = $2 where document_id = $1', [document.id, to.id]);
    await tx.query('update revisions set workspace_id = $2 where document_id = $1 and workspace_id is not null', [document.id, to.id]);
    const kinds = await tx.query<{ id: string }>('update item_kinds set workspace_id = $2 where document_id = $1 returning id', [document.id, to.id]);
    const items = kinds.length ? await tx.query('update items set workspace_id = $2 where kind_id = any($1::text[]) returning id', [kinds.map((k) => k.id), to.id]) : [];
    await tx.query('delete from document_aliases where workspace_id = $1 and slug = $2', [to.id, document.slug]);
    await tx.query(
      `insert into document_aliases (workspace_id, slug, document_id) values ($1, $2, $3)
       on conflict (workspace_id, slug) do update set document_id = excluded.document_id, created_at = now()`,
      [document.workspace_id, document.slug, document.id],
    );
    const details = { documentId: document.id, slug: document.slug, name: document.name, from: document.workspace_id, to: to.id, icons: named.length, items: items.length };
    await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'document.move', surface: actor.surface, target: `workspace:${document.workspace_id}`, details });
    await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'document.move', surface: actor.surface, target: `workspace:${to.id}`, details });
    return rows[0]!;
  });
  await enqueueDraw(ctx.db, { orgId: actor.orgId, kind: 'overlay', documentId: document.id, payload: { reason: 'moved' } });
  ctx.log.info('document.moved', { documentId: document.id, from: document.workspace_id, to: to.id, by: actor.userId });
  return moved;
}
