import { describe, expect, test } from 'bun:test';
import { MIN_GAP_MS, PEER_TTL_MS, Presence, Roster, newSession, type InBeat, type OutBeat } from './presence.ts';
import type { Seat } from './seat.ts';

const beat = (session: string, extra: Partial<InBeat> = {}): InBeat => ({ session, event: 'beat', name: session.toUpperCase(), guest: false, ...extra });

describe('the roster', () => {
  test('hears joins, moves, and leaves, never itself, and drops the silent after the time to live', () => {
    let t = 0;
    const r = new Roster('me', () => t);
    expect(r.hear(beat('me'))).toBe('self');
    expect(r.hear(beat('ana', { event: 'join', view: 'orders' }))).toBe('joined');
    expect(r.hear(beat('ana', { view: 'billing' }))).toBe('moved');
    expect(r.get('ana')?.seat).toEqual({ view: 'billing' });
    t = 10_000;
    r.hear(beat('bo', { presenting: true }));
    // Presenters first, then by name.
    expect(r.list().map((p) => p.session)).toEqual(['bo', 'ana']);
    t = PEER_TTL_MS + 1;
    expect(r.sweep()).toEqual(['ana']);
    expect(r.hear(beat('bo', { event: 'leave' }))).toBe('left');
    expect(r.list()).toEqual([]);
  });

  test('counts who follows this tab, and an unfollow clears it', () => {
    const r = new Roster('me');
    r.hear(beat('ana', { following: 'me' }));
    r.hear(beat('bo', { following: 'ana' }));
    expect(r.followers()).toBe(1);
    r.hear(beat('ana', { event: 'unfollow', following: 'me' }));
    expect(r.followers()).toBe(0);
  });
});

function harness(seat: { current: Seat }) {
  let t = 1_000;
  const sent: OutBeat[] = [];
  const p = new Presence('me', { seat: () => seat.current, post: (b) => sent.push(b), changed: () => undefined }, () => t);
  return { p, sent, tick: (ms: number) => (t += ms) };
}

describe('presence', () => {
  test('a session id is random and fits what the hub accepts', () => {
    const a = newSession();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    expect(newSession()).not.toBe(a);
  });

  test('a new place goes out at once; a camera alone waits for the heartbeat unless someone follows', () => {
    const seat = { current: { view: 'orders', cam: { x: 0, y: 0, w: 100, h: 100 } } as Seat };
    const { p, sent, tick } = harness(seat);
    p.start();
    p.stop();
    expect(sent.map((b) => b.event)).toEqual(['join']);
    tick(MIN_GAP_MS);
    seat.current = { ...seat.current, cam: { x: 5, y: 0, w: 100, h: 100 } };
    p.moved();
    expect(sent).toHaveLength(1);
    seat.current = { ...seat.current, view: 'billing' };
    p.moved();
    expect(sent.at(-1)).toMatchObject({ event: 'beat', view: 'billing' });
    // A follower arrives: it gets a beat now, and then every camera move goes out.
    p.hear(beat('ana', { following: 'me' }));
    expect(sent).toHaveLength(3);
    tick(MIN_GAP_MS);
    seat.current = { ...seat.current, cam: { x: 9, y: 0, w: 100, h: 100 } };
    p.moved();
    expect(sent.at(-1)?.cam).toEqual({ x: 9, y: 0, w: 100, h: 100 });
  });

  test('beats asked for faster than five a second collapse into one that goes when the gap has passed', async () => {
    const seat = { current: { view: 'a' } as Seat };
    const sent: OutBeat[] = [];
    const p = new Presence('me', { seat: () => seat.current, post: (b) => sent.push(b), changed: () => undefined });
    p.start();
    p.stop();
    for (const v of ['b', 'c', 'd']) {
      seat.current = { view: v };
      p.moved();
    }
    expect(sent.map((b) => b.view)).toEqual(['a']);
    await Bun.sleep(MIN_GAP_MS + 30);
    expect(sent.map((b) => b.view)).toEqual(['a', 'd']);
  });

  test('following names the leader, stopping names who was followed, and leaving posts a final beat once', () => {
    const { p, sent } = harness({ current: {} });
    p.start();
    p.stop();
    p.follow('ana');
    expect(sent.at(-1)).toMatchObject({ event: 'follow', following: 'ana' });
    expect(p.leader).toBe('ana');
    p.follow(undefined);
    expect(sent.at(-1)).toMatchObject({ event: 'unfollow', following: 'ana' });
    p.leave();
    p.leave();
    expect(sent.filter((b) => b.event === 'leave')).toHaveLength(1);
  });

  test('a reader who joins is answered, so they see the room at once', async () => {
    const { p, sent } = harness({ current: { view: 'a' } });
    p.start();
    p.stop();
    p.hear(beat('ana', { event: 'join' }));
    await Bun.sleep(550);
    expect(sent.map((b) => b.event)).toEqual(['join', 'beat']);
  });
});
