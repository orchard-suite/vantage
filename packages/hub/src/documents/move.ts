/**
 * Moving a diagram to another workspace of the same organization, to a new
 * slug, or both; a move with only a new slug renames it in place. The
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
 * new one (movedTo). A new slug follows the rule a new document's does.
 */
import type { AppContext } from '../context.ts';
import type { Surface } from '../audit.ts';
import { audit } from '../audit.ts';
import { slug as slugOf } from '@vantage/model';
import { badRequest, conflict } from '../http.ts';
import { enqueueDraw } from '../worker/jobs.ts';
import { headVersion, type DocumentRow } from './repo.ts';
import type { WorkspaceRow } from '../authz.ts';

export interface MoveActor {
  readonly orgId: string;
  readonly userId: string;
  readonly who: string;
  readonly surface: Surface;
}

export interface MoveTarget {
  /** The workspace it goes to; its own for a rename in place. */
  readonly workspace: WorkspaceRow;
  /** The slug it takes there; its own when absent. */
  readonly slug?: string | undefined;
}

export async function moveDocument(ctx: AppContext, actor: MoveActor, document: DocumentRow, target: MoveTarget): Promise<DocumentRow> {
  const to = target.workspace;
  const slug = target.slug ?? document.slug;
  if (slugOf(slug) !== slug) throw badRequest(`${slug} is not a slug: lower case letters, digits, and single dashes${slugOf(slug) ? `; try ${slugOf(slug)}` : ''}`);
  const across = to.id !== document.workspace_id;
  if (!across && slug === document.slug) return document;
  const head = across ? await headVersion(ctx.db, document) : undefined;
  // A workspace icon is named as pack/name; the head's text says which ones it uses.
  const text = head ? [head.yaml, ...Object.values(head.imports)].join('\n') : '';
  const moved = await ctx.db.transaction(async (tx) => {
    const taken = await tx.query('select 1 as x from documents where workspace_id = $1 and slug = $2', [to.id, slug]);
    if (taken.length) throw conflict(`${to.name} already has a diagram at ${slug}; pick another slug or rename that one first`);
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
    // A rename in place keeps its folder; a document that leaves its workspace leaves its folder too.
    const rows = await tx.query<DocumentRow>(
      'update documents set workspace_id = $2, slug = $3, folder_id = case when workspace_id = $2 then folder_id else null end where id = $1 returning *',
      [document.id, to.id, slug],
    );
    await tx.query('update publications set workspace_id = $2 where document_id = $1', [document.id, to.id]);
    await tx.query('update revisions set workspace_id = $2 where document_id = $1 and workspace_id is not null', [document.id, to.id]);
    const kinds = await tx.query<{ id: string }>('update item_kinds set workspace_id = $2 where document_id = $1 returning id', [document.id, to.id]);
    const items = kinds.length ? await tx.query('update items set workspace_id = $2 where kind_id = any($1::text[]) returning id', [kinds.map((k) => k.id), to.id]) : [];
    await tx.query('delete from document_aliases where workspace_id = $1 and slug = $2', [to.id, slug]);
    await tx.query(
      `insert into document_aliases (workspace_id, slug, document_id) values ($1, $2, $3)
       on conflict (workspace_id, slug) do update set document_id = excluded.document_id, created_at = now()`,
      [document.workspace_id, document.slug, document.id],
    );
    const details = { documentId: document.id, slug: document.slug, newSlug: slug, name: document.name, from: document.workspace_id, to: to.id, icons: named.length, items: items.length };
    await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'document.move', surface: actor.surface, target: `workspace:${document.workspace_id}`, details });
    if (across) await audit(tx, ctx.log, { orgId: actor.orgId, who: actor.who, what: 'document.move', surface: actor.surface, target: `workspace:${to.id}`, details });
    return rows[0]!;
  });
  // Live data comes from the workspace's connectors, so only a new workspace draws it again.
  if (across) await enqueueDraw(ctx.db, { orgId: actor.orgId, kind: 'overlay', documentId: document.id, payload: { reason: 'moved' } });
  ctx.log.info('document.moved', { documentId: document.id, from: document.workspace_id, to: to.id, slug: document.slug, newSlug: slug, by: actor.userId });
  return moved;
}
