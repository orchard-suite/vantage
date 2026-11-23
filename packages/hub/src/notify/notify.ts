/**
 * Notifications per workspace: drift found, a review changed something, a
 * publication failed, and a person mentioned. Every notification is stored
 * here, so a workspace reads its own history, and is then sent to Dispatch
 * as one event when the hub has DISPATCH_URL and DISPATCH_TOKEN. Dispatch
 * owns delivery: email, Teams, people, groups, and escalation chains.
 *
 * A workspace addresses its own notifications with `to` (people by email,
 * groups and chains by slug); every event also carries the label
 * `workspace`, so a Dispatch subscription can take them without a `to`. A
 * mention is addressed to the mentioned person alone.
 */
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { randomId } from '../crypto.ts';
import { maybe } from '../db/db.ts';
import type { Logger } from '../log.ts';

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Who Dispatch tells: a person by email, or one of Dispatch's groups or escalation chains by slug. */
export const TargetSchema = z.union([
  z.object({ person: z.string().email() }).strict(),
  z.object({ group: z.string().regex(SLUG) }).strict(),
  z.object({ chain: z.string().regex(SLUG) }).strict(),
]);

export type Target = z.output<typeof TargetSchema>;

export const NotificationSettingsSchema = z
  .object({
    /** Who the workspace's notifications go to; empty leaves routing to Dispatch's subscriptions. */
    to: z.array(TargetSchema).max(20).optional(),
    /** Kinds this workspace wants; default all. */
    kinds: z.array(z.enum(['drift', 'review', 'publication-failed', 'mention'])).optional(),
  })
  .strict();

export type NotificationSettings = z.output<typeof NotificationSettingsSchema>;
export type NotificationKind = 'drift' | 'review' | 'publication-failed' | 'mention';

export interface Notification {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly link?: string;
}

export interface Delivery {
  readonly channel: 'dispatch';
  readonly ok: boolean;
  readonly detail: string;
}

export interface NotificationRow {
  readonly id: string;
  readonly workspace_id: string;
  /** The one person a notification is addressed to; null for the workspace's own list. */
  readonly user_id: string | null;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly delivered: readonly Delivery[];
  readonly created_at: Date;
}

interface WorkspaceNotifying {
  readonly slug: string;
  readonly settings: NotificationSettings;
}

async function workspaceNotifying(ctx: AppContext, workspaceId: string): Promise<WorkspaceNotifying> {
  const row = await maybe<{ slug: string; settings: Record<string, unknown> }>(ctx.db, 'select slug, settings from workspaces where id = $1', [workspaceId]);
  const parsed = NotificationSettingsSchema.safeParse(row?.settings['notifications'] ?? {});
  if (!parsed.success) ctx.log.warn('notify.settings.invalid', { workspaceId, issues: parsed.error.issues.length });
  return { slug: row?.slug ?? '', settings: parsed.success ? parsed.data : {} };
}

const EVENT_KIND: Record<NotificationKind, string> = { drift: 'vantage.drift', review: 'vantage.review', 'publication-failed': 'vantage.publication_failed', mention: 'vantage.mention' };
const SEVERITY: Record<NotificationKind, 'warning' | 'info'> = { drift: 'warning', review: 'info', 'publication-failed': 'warning', mention: 'info' };
const DISPATCH_TIMEOUT_MS = 10_000;

/** One event to Dispatch; a refusal or failure is the delivery's outcome, never thrown. */
async function dispatch(ctx: AppContext, log: Logger, id: string, n: Notification, workspace: string, to: readonly Target[]): Promise<Delivery> {
  const { DISPATCH_URL: base, DISPATCH_TOKEN: token } = ctx.config;
  if (!base || !token) return { channel: 'dispatch', ok: false, detail: 'no Dispatch configured' };
  const event = {
    kind: EVENT_KIND[n.kind],
    key: id,
    title: n.title,
    text: n.body,
    severity: SEVERITY[n.kind],
    ...(n.link ? { links: [{ title: 'Open in Vantage', url: n.link }] } : {}),
    labels: { workspace },
    ...(to.length > 0 ? { to } : {}),
  };
  try {
    const res = await ctx.fetch(`${base}/v1/events`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS) });
    const answer = (await res.json().catch(() => ({}))) as DispatchAnswer & { error?: string };
    if (!res.ok) {
      log.warn('notify.dispatch.refused', { id, status: res.status });
      return { channel: 'dispatch', ok: false, detail: `${res.status} ${answer.error ?? ''}`.trim() };
    }
    log.info('notify.dispatch', { id, status: res.status, queued: answer.queued ?? 0, messages: answer.messages ?? 0, pages: answer.pages ?? 0 });
    return { channel: 'dispatch', ok: true, detail: summary(answer) };
  } catch (err) {
    log.warn('notify.dispatch.failed', { id, error: (err as Error).message });
    return { channel: 'dispatch', ok: false, detail: (err as Error).message };
  }
}

/** What Dispatch answers for an event: channels queued, messages to people (one per person per medium), and chains started. */
interface DispatchAnswer {
  readonly queued?: number;
  readonly messages?: number;
  readonly pages?: number;
  readonly repeat?: boolean;
}

function summary(a: DispatchAnswer): string {
  if (a.repeat) return 'already sent';
  const parts = [`${a.queued ?? 0} ${a.queued === 1 ? 'channel' : 'channels'}`, `${a.messages ?? 0} ${a.messages === 1 ? 'message' : 'messages'}`];
  if (a.pages) parts.push(`${a.pages} ${a.pages === 1 ? 'chain' : 'chains'}`);
  return parts.join(', ');
}

async function record(ctx: AppContext, id: string, delivered: Delivery): Promise<void> {
  await ctx.db.query('update notifications set delivered = $2 where id = $1', [id, JSON.stringify([delivered])]);
}

/** Stores the notification and sends it to Dispatch, addressed to the workspace's `to`; a failure is recorded, never thrown. */
export async function notify(ctx: AppContext, n: Notification): Promise<NotificationRow> {
  const log = ctx.log.child({ workspaceId: n.workspaceId, kind: n.kind });
  const ws = await workspaceNotifying(ctx, n.workspaceId);
  const wanted = ws.settings.kinds === undefined || ws.settings.kinds.includes(n.kind);
  const send = wanted && Boolean(ctx.config.DISPATCH_URL);
  log.info('notify.start', { title: n.title, to: ws.settings.to?.length ?? 0, wanted, dispatch: Boolean(ctx.config.DISPATCH_URL) });
  const id = randomId();
  const text = n.link ? `${n.body}\n\n${n.link}` : n.body;
  await ctx.db.query('insert into notifications (id, org_id, workspace_id, kind, title, body) values ($1, $2, $3, $4, $5, $6)', [id, n.orgId, n.workspaceId, n.kind, n.title, text]);
  if (send) await record(ctx, id, await dispatch(ctx, log, id, n, ws.slug, ws.settings.to ?? []));
  log.info('notify.end', { id, sent: send });
  return (await maybe<NotificationRow>(ctx.db, `select ${COLUMNS} from notifications where id = $1`, [id]))!;
}

const COLUMNS = 'id, workspace_id, user_id, kind, title, body, delivered, created_at';

export interface PersonNotification extends Notification {
  /** The one person told. */
  readonly userId: string;
}

export interface PersonNotified {
  readonly row: NotificationRow;
  /** Settles when Dispatch took the event or refused it, and its outcome is stored on the row; never rejects. */
  readonly delivery: Promise<void>;
}

/**
 * Stores a notification for one person at once and sends it to Dispatch,
 * addressed to their own email, in the background, so the request that
 * caused it never waits on Dispatch. No address means nothing is sent.
 */
export async function notifyPerson(ctx: AppContext, n: PersonNotification): Promise<PersonNotified> {
  const log = ctx.log.child({ workspaceId: n.workspaceId, kind: n.kind, userId: n.userId });
  const ws = await workspaceNotifying(ctx, n.workspaceId);
  const wanted = ws.settings.kinds === undefined || ws.settings.kinds.includes(n.kind);
  const person = await maybe<{ email: string | null }>(ctx.db, 'select email from users where id = $1 and disabled_at is null', [n.userId]);
  const address = wanted && ctx.config.DISPATCH_URL && person?.email ? person.email : undefined;
  const text = n.link ? `${n.body}\n\n${n.link}` : n.body;
  const id = randomId();
  await ctx.db.query('insert into notifications (id, org_id, workspace_id, user_id, kind, title, body) values ($1, $2, $3, $4, $5, $6, $7)', [id, n.orgId, n.workspaceId, n.userId, n.kind, n.title, text]);
  log.info('notify.person', { id, send: Boolean(address), wanted, hasAddress: Boolean(person?.email) });
  const row = (await maybe<NotificationRow>(ctx.db, `select ${COLUMNS} from notifications where id = $1`, [id]))!;
  const delivery = address
    ? dispatch(ctx, log, id, n, ws.slug, [{ person: address }])
        .then(async (d) => {
          await record(ctx, id, d);
          log.info('notify.person.end', { id, ok: d.ok });
        })
        .catch((err: unknown) => log.warn('notify.person.failed', { id, error: (err as Error).message }))
    : Promise.resolve();
  return { row, delivery };
}

/** The workspace's own list; notifications addressed to one person stay theirs. */
export async function listNotifications(ctx: AppContext, workspaceId: string, limit = 50): Promise<NotificationRow[]> {
  return ctx.db.query<NotificationRow>(`select ${COLUMNS} from notifications where workspace_id = $1 and user_id is null order by created_at desc limit $2`, [workspaceId, Math.min(limit, 500)]);
}
