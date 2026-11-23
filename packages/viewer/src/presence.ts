/**
 * Presence in the hub viewer: this tab's beats out, everyone else's in.
 *
 * A tab joins with its seat, beats every few seconds, and says right away
 * when it moves somewhere (another view, step, or group). Its camera goes
 * out at most five times a second, and only while someone follows it or it
 * presents; otherwise the heartbeat carries it. A peer not heard from for
 * PEER_TTL_MS is gone, so a tab that closes without a word still leaves.
 * A tab that joins is answered by everyone, so it sees the room at once.
 * A tab hidden for a while leaves and joins again when it is shown.
 */
import { sameSeat, samePlace, type Seat } from './seat.ts';

export const HEARTBEAT_MS = 10_000;
export const PEER_TTL_MS = 30_000;
/** At most five beats a second. */
export const MIN_GAP_MS = 200;
/** A hidden tab leaves after this, so a glance at another tab does not flicker the room. */
export const HIDDEN_LEAVE_MS = 15_000;

export type BeatEvent = 'join' | 'beat' | 'leave' | 'follow' | 'unfollow';

/** What this tab posts. */
export type OutBeat = Seat & { readonly session: string; readonly event: BeatEvent; readonly following?: string };

/** What the hub passes on: a beat with the sender's name as the hub knows it. */
export type InBeat = OutBeat & { readonly name: string; readonly guest: boolean; readonly mine?: boolean };

export interface Peer {
  readonly session: string;
  readonly name: string;
  readonly guest: boolean;
  /** The same signed-in person, in another tab. */
  readonly mine: boolean;
  readonly seat: Seat;
  readonly following: string | undefined;
  readonly heard: number;
}

/** Who else is here, by session, with the clock that expires them. */
export class Roster {
  private readonly peers = new Map<string, Peer>();

  constructor(private readonly self: string, private readonly now: () => number = Date.now) {}

  /** Takes a beat; says whether it brought someone new or took someone away. */
  hear(b: InBeat): 'joined' | 'left' | 'moved' | 'self' {
    if (b.session === this.self) return 'self';
    if (b.event === 'leave') return this.peers.delete(b.session) ? 'left' : 'moved';
    const known = this.peers.has(b.session);
    const { session, event: _e, name, guest, mine, following, ...seat } = b;
    this.peers.set(session, { session, name, guest, mine: mine ?? false, seat, following: b.event === 'unfollow' ? undefined : following, heard: this.now() });
    return known ? 'moved' : 'joined';
  }

  /** Drops peers not heard from in PEER_TTL_MS; returns their sessions. */
  sweep(): string[] {
    const gone = [...this.peers.values()].filter((p) => this.now() - p.heard > PEER_TTL_MS).map((p) => p.session);
    for (const s of gone) this.peers.delete(s);
    return gone;
  }

  get(session: string): Peer | undefined {
    return this.peers.get(session);
  }

  /** Presenters first, then by name, so the order holds still between beats. */
  list(): Peer[] {
    return [...this.peers.values()].sort((a, b) => Number(Boolean(b.seat.presenting)) - Number(Boolean(a.seat.presenting)) || a.name.localeCompare(b.name) || a.session.localeCompare(b.session));
  }

  /** How many peers follow this tab. */
  followers(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.following === this.self) n++;
    return n;
  }

  clear(): void {
    this.peers.clear();
  }
}

export interface PresenceHost {
  /** Where this tab is now. */
  readonly seat: () => Seat;
  /** Posts one beat; `final` when the page is going away and the post must outlive it. */
  readonly post: (beat: OutBeat, final: boolean) => void;
  /** The room changed: someone came, went, or moved. */
  readonly changed: () => void;
  /** A peer left, by beat or by silence. */
  readonly left?: (session: string) => void;
}

/** A session id for this tab: random, not tied to the person. */
export function newSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class Presence {
  readonly roster: Roster;
  private following: string | undefined;
  private sent: Seat | undefined;
  private sentAt = -Infinity;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private here = false;

  constructor(readonly session: string, private readonly host: PresenceHost, private readonly now: () => number = Date.now) {
    this.roster = new Roster(session, now);
  }

  /** Joins the room and keeps beating; the sweep drops the silent. */
  start(): void {
    this.join();
    this.timers.push(setInterval(() => this.here && this.send('beat'), HEARTBEAT_MS));
    this.timers.push(setInterval(() => this.sweep(), PEER_TTL_MS / 6));
  }

  /** The event stream reconnected: anything said meanwhile was missed, so join again and hear the room afresh. */
  rejoin(): void {
    this.roster.clear();
    this.host.changed();
    this.join();
  }

  /** The page is going away. */
  leave(): void {
    if (!this.here) return;
    this.here = false;
    this.host.post({ session: this.session, event: 'leave' }, true);
  }

  /** The tab was hidden or shown. */
  visible(shown: boolean): void {
    clearTimeout(this.hiddenTimer);
    if (shown) {
      if (!this.here) this.rejoin();
    } else this.hiddenTimer = setTimeout(() => this.leave(), HIDDEN_LEAVE_MS);
  }

  /** This tab's seat may have moved: a new place goes out now, a camera only when someone watches it. */
  moved(): void {
    if (!this.here) return;
    const seat = this.host.seat();
    if (this.sent && sameSeat(seat, this.sent)) return;
    if (this.sent && samePlace(seat, this.sent) && !this.watched(seat)) return;
    this.schedule();
  }

  /** Starts or stops following a peer; undefined stops. */
  follow(session: string | undefined): void {
    if (session === this.following) return;
    const was = this.following;
    this.following = session;
    if (this.here) this.send(session ? 'follow' : 'unfollow', was);
  }

  get leader(): string | undefined {
    return this.following;
  }

  hear(b: InBeat): void {
    const was = this.roster.get(b.session);
    const what = this.roster.hear(b);
    if (what === 'self') return;
    if (what === 'left') this.host.left?.(b.session);
    // Someone who joins hears the room from each of us, a little apart; a new follower gets our camera now.
    if (this.here && b.event === 'join') setTimeout(() => this.here && this.send('beat'), 50 + Math.random() * 450);
    else if (this.here && b.event !== 'unfollow' && b.following === this.session && was?.following !== this.session) this.send('beat');
    this.host.changed();
  }

  private join(): void {
    this.here = true;
    this.send('join');
  }

  private sweep(): void {
    const gone = this.roster.sweep();
    for (const s of gone) this.host.left?.(s);
    if (gone.length) this.host.changed();
  }

  private watched(seat: Seat): boolean {
    return Boolean(seat.presenting) || this.roster.followers() > 0;
  }

  /** Sends now, or once MIN_GAP_MS has passed since the last beat; beats asked for meanwhile become the one that goes. */
  private schedule(): void {
    if (this.pending) return;
    const wait = this.sentAt + MIN_GAP_MS - this.now();
    if (wait <= 0) return this.send('beat');
    this.pending = setTimeout(() => {
      this.pending = undefined;
      if (this.here) this.send('beat');
    }, wait);
  }

  private send(event: BeatEvent, unfollowed?: string): void {
    const seat = this.host.seat();
    this.sent = seat;
    this.sentAt = this.now();
    const following = event === 'unfollow' ? unfollowed : this.following;
    this.host.post({ ...seat, session: this.session, event, ...(following ? { following } : {}) }, false);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    clearTimeout(this.pending);
    clearTimeout(this.hiddenTimer);
    this.timers = [];
  }
}
