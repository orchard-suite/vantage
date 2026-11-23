/**
 * Presence and follow in the hub viewer. Beats go to the hub's
 * `/api/presence` and come back as `presence` events on the stream the
 * viewer already holds. A reader who follows another takes the leader's
 * seat on every beat; a pan, a zoom, a step, or another view picked by
 * hand stops following, and so does the leader leaving.
 */
import type { App } from './app.ts';
import { Presence, newSession, type InBeat, type OutBeat } from './presence.ts';
import { PresenceUi, peerLabel } from './presence-ui.ts';
import { sameSeat, type Seat } from './seat.ts';
import { reportEvent } from './report.ts';

/** A press that wanders this far, in screen pixels, is a pan. */
const DRAG_SLOP = 4;
/** Keys that move the reader: steps, views, zoom, fit. */
const MOVING_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', '+', '=', '-', 'z']);

export type StopReason = 'manual' | 'button' | 'left';

export function startPresence(app: App, file: string | null, events: EventSource): void {
  const url = `/api/presence${file ? `?file=${encodeURIComponent(file)}` : ''}`;
  const post = (beat: OutBeat, final: boolean): void => {
    const body = JSON.stringify(beat);
    if (final && navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
    // Presence is best effort: a beat that fails is followed by the next one.
    void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  };
  let applied: Seat | undefined;
  const presence = new Presence(newSession(), {
    seat: () => app.seat,
    post,
    changed: () => room(),
    left: (session) => {
      if (session !== presence.leader) return;
      const name = ui.lastName ?? 'The reader you followed';
      stop('left');
      ui.view.say(`${name} left, so you stopped following.`);
    },
  });
  const ui = {
    view: new PresenceUi({
      area: app.main,
      viewTitle: (id) => app.views.find((v) => v.id === id)?.title,
      follow: (session) => follow(session),
      unfollow: () => stop('button'),
    }),
    lastName: undefined as string | undefined,
  };
  app.bar.tools.insertBefore(ui.view.avatars, app.bar.tools.firstElementChild);

  function room(): void {
    const leader = presence.leader;
    const lead = leader ? presence.roster.get(leader) : undefined;
    if (lead) {
      ui.lastName = peerLabel(lead);
      if (!applied || !sameSeat(applied, lead.seat)) {
        applied = lead.seat;
        app.sit(lead.seat);
      }
    }
    ui.view.render(presence.roster.list(), leader);
  }

  function follow(session: string): void {
    const p = presence.roster.get(session);
    if (!p) return;
    // Take the leader's seat first, so the follow beat says where the follower now is.
    applied = p.seat;
    app.sit(p.seat);
    presence.follow(session);
    reportEvent('presence_follow', { guest: String(p.guest), presenting: String(Boolean(p.seat.presenting)) });
    room();
  }

  function stop(reason: StopReason): void {
    if (!presence.leader) return;
    presence.follow(undefined);
    applied = undefined;
    reportEvent('presence_unfollow', { reason });
    room();
  }

  events.addEventListener('presence', (e) => {
    try {
      presence.hear(JSON.parse((e as MessageEvent<string>).data) as InBeat);
    } catch {
      // A beat this viewer cannot read is skipped; the next one carries the same seat.
    }
  });
  let opened = false;
  events.addEventListener('open', () => {
    if (opened) presence.rejoin();
    opened = true;
  });
  app.onSeat = () => presence.moved();
  window.addEventListener('hashchange', () => {
    // The viewer follows by replacing the route, which fires no hashchange: one that fires was the reader's own.
    stop('manual');
    presence.moved();
  });
  window.addEventListener('pagehide', () => presence.leave());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) presence.rejoin();
  });
  document.addEventListener('visibilitychange', () => presence.visible(!document.hidden));
  wireManualStop(app, () => stop('manual'));
  presence.start();
}

/** Anything the reader does to move the picture by hand while following. */
function wireManualStop(app: App, stop: () => void): void {
  const canvas = app.main.querySelector<HTMLElement>('.v-canvas');
  if (canvas) {
    let down: { x: number; y: number } | undefined;
    canvas.addEventListener('wheel', stop, { passive: true });
    canvas.addEventListener('dblclick', stop);
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    window.addEventListener('pointerup', () => (down = undefined));
    window.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_SLOP) {
        down = undefined;
        stop();
      }
    });
  }
  app.bar.toolbar.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.v-zoom, .v-detail')) stop();
  });
  app.main.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.v-story button')) stop();
  });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey && MOVING_KEYS.has(e.key)) stop();
  }, true);
}
