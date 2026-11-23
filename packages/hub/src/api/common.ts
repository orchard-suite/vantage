/** Helpers every API module uses: typed JSON bodies and the document lookup with a role check. */
import type { Context } from 'hono';
import { z, type ZodType } from 'zod';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import { requireWorkspace, requireWorkspaceById, type AccessibleWorkspace } from '../authz.ts';
import { documentById, documentBySlug, type DocumentRow } from '../documents/repo.ts';
import { badRequest, notFound } from '../http.ts';
import type { Principal, Role } from '../auth/principal.ts';
import { requireUser } from '../authz.ts';

export async function body<T>(c: Context<HubEnv>, schema: ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest('invalid body', { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  return parsed.data;
}

export function principal(c: Context<HubEnv>): Principal {
  return requireUser(c.get('principal'));
}

export interface DocumentScope {
  readonly p: Principal;
  readonly workspace: AccessibleWorkspace;
  readonly document: DocumentRow;
}

/** The document at /:workspace/:doc, with the caller holding at least `role` there. */
export async function scopedDocument(ctx: AppContext, c: Context<HubEnv>, role: Role): Promise<DocumentScope> {
  const p = principal(c);
  const workspace = await requireWorkspace(ctx.db, p, c.req.param('workspace') ?? '', role);
  const document = await documentBySlug(ctx.db, workspace.id, c.req.param('doc') ?? '');
  if (!document) throw notFound('document');
  return { p, workspace, document };
}

export const Id = z.string().min(1).max(200);
export const Name = z.string().min(1).max(200);
export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lower case letters, digits, and dashes').max(80);

export function who(p: Principal): string {
  return p.token ? `${p.userId} via token ${p.token.id}` : p.userId;
}

/** The document at /documents/:id, with the caller holding at least `role` in its workspace. */
export async function scopedDocumentById(ctx: AppContext, c: Context<HubEnv>, role: Role): Promise<DocumentScope> {
  const p = principal(c);
  const document = await documentById(ctx.db, c.req.param('id') ?? '');
  if (!document || document.org_id !== p.orgId) throw notFound('document');
  const workspace = await requireWorkspaceById(ctx.db, p, document.workspace_id, role);
  return { p, workspace, document };
}
