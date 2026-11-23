/**
 * Presence: who has a document open right now, where they are in it, and
 * who follows whom. Nothing is stored. Each open viewer posts a beat (its
 * seat: the view, the step, the opened groups, the region of the picture
 * it shows) when it joins, when its seat changes, and every few seconds;
 * the hub stamps the reader's name on it and NOTIFYs the document's
 * presence channel, so every pod with a viewer of that document passes it
 * on down its event streams. Viewers drop a peer they have not heard from
 * in a while, so a closed tab goes without any state on the server.
 */
import { z } from 'zod';
import type { Db } from './db/db.ts';

export const PRESENCE_CHANNEL_PREFIX = 'vantage_pres';
/** NOTIFY refuses payloads near 8000 bytes; a beat is a few hundred. */
export const MAX_BEAT_BYTES = 7_000;
/** How long a reader's name is kept per pod before it is read again. */
const NAME_TTL_MS = 5 * 60_000;

const Session = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);
const Id = z.string().min(1).max(200);
const Coord = z.number().finite();

export const PRESENCE_EVENTS = ['join', 'beat', 'leave', 'follow', 'unfollow'] as const;
export type PresenceEvent = (typeof PRESENCE_EVENTS)[number];

export const BeatSchema = z.object({
  session: Session,
  event: z.enum(PRESENCE_EVENTS).default('beat'),
  view: Id.optional(),
  open: Id.optional(),
  step: z.union([z.object({ walk: z.number().int().min(0) }), z.object({ path: z.number().int().min(0), step: z.number().int().min(-1) })]).optional(),
  groups: z.object({ open: z.array(Id).max(200), shut: z.array(Id).max(200), detail: z.number().int().min(0).max(20).optional() }).optional(),
  cam: z.object({ x: Coord, y: Coord, w: Coord.positive(), h: Coord.positive() }).optional(),
  presenting: z.boolean().optional(),
  /** The session this reader follows, if any. */
  following: Session.optional(),
});
export type Beat = z.infer<typeof BeatSchema>;

/** Who sent a beat, as the hub knows them. */
export interface Speaker {
  /** The user's id; never sent to readers, only compared with theirs. */
  readonly userId: string | null;
  readonly name: string;
  /** The user set a display name; a guest reader sees only those. */
  readonly named: boolean;
  readonly guest: boolean;
}

/** A beat as it rides the channel: what the reader sent, with who they are. */
export type Wire = Beat & { readonly name: string; readonly named: boolean; readonly guest: boolean; readonly user: string | null };

export function stamp(beat: Beat, who: Speaker): Wire {
  return { ...beat, name: who.name, named: who.named, guest: who.guest, user: who.userId };
}

/** Who reads the stream: a guest sees display names only and nothing beyond the view their link is limited to. */
export interface Reader {
  readonly userId: string | null;
  readonly guest: boolean;
  readonly onlyView?: string | undefined;
}

/** The beat as one reader may see it, or undefined when it does not parse. */
export function forReader(payload: string, reader: Reader): string | undefined {
  let w: Wire;
  try {
    w = JSON.parse(payload) as Wire;
  } catch {
    return undefined;
  }
  const { user, named, view, open, step, groups, cam, ...rest } = w;
  const name = reader.guest && !named && !w.guest ? 'Member' : w.name;
  const seen = reader.onlyView === undefined || view === reader.onlyView;
  const seat = seen ? { ...(view !== undefined ? { view } : {}), ...(open !== undefined ? { open } : {}), ...(step ? { step } : {}), ...(groups ? { groups } : {}), ...(cam ? { cam } : {}) } : {};
  return JSON.stringify({ ...rest, name, ...seat, ...(user !== null && user === reader.userId ? { mine: true } : {}) });
}

export async function publishBeat(db: Db, channel: string, wire: Wire): Promise<number> {
  const payload = JSON.stringify(wire);
  if (payload.length > MAX_BEAT_BYTES) return -1;
  await db.notify(channel, payload);
  return payload.length;
}

/** A user's display name, else the part of their subject before any `@`; read once per few minutes per pod. */
export function nameCache(db: Db, now: () => number = Date.now): (userId: string, subject: string) => Promise<{ name: string; named: boolean }> {
  const cache = new Map<string, { at: number; name: string; named: boolean }>();
  return async (userId, subject) => {
    const hit = cache.get(userId);
    if (hit && now() - hit.at < NAME_TTL_MS) return hit;
    const rows = await db.query<{ display_name: string | null }>('select display_name from users where id = $1', [userId]);
    const display = rows[0]?.display_name?.trim();
    const entry = { at: now(), name: display || subject.split('@')[0] || 'Member', named: Boolean(display) };
    cache.set(userId, entry);
    return entry;
  };
}
