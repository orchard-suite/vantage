/**
 * Resolves an address to the thing it names and hands back its text form,
 * as the caller may see it. The verbs, the REST text routes, and the
 * working copy all read through here, so every door answers the same text.
 */
import { STALE, staleOf } from './stale.ts';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { memberWorkspaces, requireWorkspace, type AccessibleWorkspace } from '../authz.ts';
import { documentBySlug, headVersion, movedTo, type DocumentRow, type VersionRow } from '../documents/repo.ts';
import { readPage } from '../documents/pages.ts';
import { readDecision, requireDecision } from '../decisions/read.ts';
import { revisionsOf, type RevisionRow } from '../decisions/repo.ts';
import type { Decision } from '../decisions/types.ts';
import { HttpError, badRequest } from '../http.ts';
import { HUB_VERSION } from '../version.ts';
import { guideText, schemaText } from '@vantage/mcp';
import { PERSONAL, thingAddress, type Address } from './address.ts';
import { recordText } from './record-text.ts';
import { itemThing, placeAddress } from './items.ts';
import { documentLink, recordLink } from './links.ts';
import { scopesState, scopesText, scopesVersion } from '../scopes/text.ts';
import { settingsThing, standardThing } from '../standards/text.ts';
import { conflictsThing, conflictThing } from '../standards/conflicts.ts';
import { exceptionsThing } from '../standards/exception-text.ts';
import { readException } from '../standards/exception-write.ts';
import { scopeThing } from '../scopes/profile.ts';

export type Role = 'viewer' | 'author';

/** One thing's text as it stands, and the version to send back with a change to it. */
export interface TextThing {
  /** The address as the hub writes it, without a part. */
  readonly address: string;
  readonly version: string;
  readonly text: string;
  readonly kind: 'yaml' | 'markdown' | 'json';
  /** The thing's page in the hub; the guide, the schema, the scope tree, and the standards have none. */
  readonly link?: string;
}

export async function personalWorkspace(ctx: AppContext, p: Principal, role: Role): Promise<AccessibleWorkspace> {
  const mine = (await memberWorkspaces(ctx.db, p)).find((w) => w.kind === 'personal' && w.owner_user_id === p.userId);
  if (!mine) throw new HttpError(404, 'you have no personal workspace; name the workspace (vantage_outline lists them)');
  return requireWorkspace(ctx.db, p, mine.slug, role);
}

export async function workspaceAt(ctx: AppContext, p: Principal, slug: string, role: Role): Promise<AccessibleWorkspace> {
  return slug === PERSONAL ? personalWorkspace(ctx, p, role) : requireWorkspace(ctx.db, p, slug, role);
}

export interface DocumentAt {
  readonly ws: AccessibleWorkspace;
  readonly doc: DocumentRow;
  readonly head: VersionRow | undefined;
}

/** The document an address names, or undefined when the workspace has none by that slug. */
export async function documentAt(ctx: AppContext, p: Principal, a: { workspace: string; document: string }, role: Role): Promise<DocumentAt | undefined> {
  const ws = await workspaceAt(ctx, p, a.workspace, role);
  const doc = await documentBySlug(ctx.db, ws.id, a.document);
  return doc ? { ws, doc, head: await headVersion(ctx.db, doc) } : undefined;
}

export async function requireDocumentAt(ctx: AppContext, p: Principal, a: { workspace: string; document: string }, role: Role): Promise<DocumentAt & { head: VersionRow }> {
  const at = await documentAt(ctx, p, a, role);
  if (!at) {
    const ws = await workspaceAt(ctx, p, a.workspace, 'viewer');
    const moved = await movedTo(ctx.db, ws.id, a.document);
    if (moved) throw new HttpError(404, `${a.workspace}/${a.document} moved to ${moved}; use that address`);
    throw new HttpError(404, `no document ${a.workspace}/${a.document}; vantage_outline ${a.workspace} lists the documents there`);
  }
  if (!at.head) throw new HttpError(404, `${a.workspace}/${a.document} has no saved version yet`);
  return { ...at, head: at.head };
}

export const pagePaths = (v: Pick<VersionRow, 'attachments'>): string[] => v.attachments.filter((x) => /\.md$/i.test(x.path)).map((x) => x.path);

export interface RecordAt {
  readonly decision: Decision;
  readonly version: string;
  readonly revisions: readonly RevisionRow[];
}

export async function recordAt(ctx: AppContext, p: Principal, ref: string, role: Role = 'viewer'): Promise<RecordAt> {
  const { row } = await requireDecision(ctx, p, ref, role);
  const decision = await readDecision(ctx, p, ref);
  const revisions = await revisionsOf(ctx.db, row.id);
  return { decision, version: revisions[0]?.id ?? 'none', revisions };
}

/** The whole text of the thing an address names. A workspace, a registry, and the root have an outline and no text. */
export async function readThing(ctx: AppContext, p: Principal, given: Address): Promise<TextThing> {
  const a = await placeAddress(ctx, p, given);
  switch (a.kind) {
    case 'item':
      return itemThing(ctx, p, a.key);
    case 'guide':
      return { address: 'guide', version: HUB_VERSION, text: guideText(), kind: 'markdown' };
    case 'schema':
      return { address: 'schema', version: HUB_VERSION, text: schemaText(), kind: 'json' };
    case 'scopes': {
      const text = scopesText(await scopesState(ctx, p));
      return { address: 'scopes', version: await scopesVersion(text), text, kind: 'yaml' };
    }
    case 'scope':
      return { ...(await scopeThing(ctx, p, a.id)), kind: 'markdown' };
    case 'standards':
      return { ...(await settingsThing(ctx, p)), kind: 'yaml' };
    case 'standard':
      return { ...(await standardThing(ctx, p, a.scope)), kind: 'markdown' };
    case 'conflicts':
      return { ...(await conflictsThing(ctx, p)), kind: 'markdown' };
    case 'conflict':
      return { ...(await conflictThing(ctx, p, a.number)), kind: 'markdown' };
    case 'exceptions':
      return { ...(await exceptionsThing(ctx, p)), kind: 'markdown' };
    case 'exception':
      return { ...(await readException(ctx, p, a.number)), kind: 'markdown' };
    case 'document': {
      const { ws, doc, head } = await requireDocumentAt(ctx, p, a, 'viewer');
      return { address: `${ws.slug}/${doc.slug}`, version: head.id, text: head.yaml, kind: 'yaml', link: documentLink(ctx, ws.slug, doc.slug) };
    }
    case 'page': {
      const { ws, doc, head } = await requireDocumentAt(ctx, p, a, 'viewer');
      if (a.page === STALE) {
        const s = await staleOf(ctx, doc.org_id, `${ws.slug}/${doc.slug}`, head.yaml);
        return { address: `${ws.slug}/${doc.slug}/${STALE}`, version: `${head.id}.${s.head?.slice(0, 12) ?? 'none'}`, text: s.text, kind: 'markdown', link: documentLink(ctx, ws.slug, doc.slug) };
      }
      const body = await readPage(ctx, head, a.page);
      if (body === undefined) throw new HttpError(404, `no page ${a.page} in ${ws.slug}/${doc.slug}; its pages: ${pagePaths(head).join(', ') || 'none'}`);
      return { address: `${ws.slug}/${doc.slug}/${a.page}`, version: head.id, text: body, kind: 'markdown', link: documentLink(ctx, ws.slug, doc.slug) };
    }
    case 'record': {
      const { decision, version } = await recordAt(ctx, p, a.ref);
      return { address: decision.ref, version, text: recordText(decision), kind: 'markdown', link: recordLink(ctx, decision.workspace, decision.ref) };
    }
    default:
      throw badRequest(`${thingAddress(a) || 'that'} has no text of its own; vantage_outline it for what is inside`);
  }
}
