/**
 * Turns a `file` reference (`workspace/document`, or `g/<signed id>` for a
 * guest) into the document the caller may read, checking grants or the
 * guest link on the way.
 */
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from './env.ts';
import { requireWorkspace, type AccessibleWorkspace } from '../authz.ts';
import { documentById, documentBySlug, type DocumentRow } from '../documents/repo.ts';
import { checkPasscode, recordOpen, resolveGuestLink, type GuestLinkRow } from '../guest.ts';
import { badRequest, forbidden, notFound } from '../http.ts';
import { readCookie } from '../auth/session.ts';
import { open } from '../crypto.ts';
import { clientAddress, type RateLimiter } from '../ratelimit.ts';
import { HttpError } from '../http.ts';

export const GUEST_COOKIE = 'vantage_guest';

export interface ResolvedDocument {
  readonly document: DocumentRow;
  readonly workspace?: AccessibleWorkspace;
  readonly guest?: GuestLinkRow;
  /** The view a guest link is limited to, if any. */
  readonly onlyView?: string;
}

export async function resolveFile(ctx: AppContext, c: Context<HubEnv>, file: string | undefined, guestLimiter: RateLimiter, opts: { recordGuestOpen: boolean }): Promise<ResolvedDocument> {
  if (!file) throw badRequest('file is required: workspace/document');
  const [a, b, extra] = file.split('/');
  if (!a || !b || extra !== undefined) throw badRequest('file must be workspace/document');
  if (a === 'g') return resolveGuest(ctx, c, b, guestLimiter, opts);
  const workspace = await requireWorkspace(ctx.db, c.get('principal'), a, 'viewer');
  const document = await documentBySlug(ctx.db, workspace.id, b);
  if (!document) throw notFound('document');
  return { document, workspace };
}

async function resolveGuest(ctx: AppContext, c: Context<HubEnv>, token: string, limiter: RateLimiter, opts: { recordGuestOpen: boolean }): Promise<ResolvedDocument> {
  const address = clientAddress(c.req.raw);
  if (!limiter.allow(address) || !limiter.allow(token)) {
    ctx.log.warn('guest.ratelimited', { address });
    throw new HttpError(429, 'too many guest requests');
  }
  const guest = await resolveGuestLink(ctx.db, ctx.config, token);
  if (!guest) throw notFound('guest link');
  const unlocked = await open(ctx.config.SESSION_SECRET, readCookie(c.req.header('cookie'), GUEST_COOKIE) ?? '');
  const passcode = c.req.query('passcode');
  if (guest.passcode_hash && unlocked !== guest.id && !(await checkPasscode(guest, passcode))) throw forbidden('passcode required');
  const document = await documentById(ctx.db, guest.document_id);
  if (!document) throw notFound('document');
  if (opts.recordGuestOpen) await recordOpen(ctx.db, ctx.log, guest, address);
  return { document, guest, ...(guest.view_id ? { onlyView: guest.view_id } : {}) };
}
