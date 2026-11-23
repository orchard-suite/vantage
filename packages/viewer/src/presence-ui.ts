/**
 * What presence looks like: the readers here as avatars in the app bar
 * (presenters first), and the bar over the stage that says whom this
 * reader follows, offers to follow a presenter, or says the leader left.
 * While following, the stage wears a frame in the leader's color.
 */
import { button, h, iconButton } from './dom.ts';
import type { Peer } from './presence.ts';
import { initials, peerColor } from './seat.ts';

/** Avatars shown before the rest fold into a count. */
const SHOWN = 4;
/** How long a note such as "Ana left" stays up. */
const NOTE_MS = 5_000;

export interface PresenceUiHost {
  /** The stage area the bar and the frame go on. */
  readonly area: HTMLElement;
  /** A view's title, or undefined when this reader's copy has no such view. */
  readonly viewTitle: (id: string) => string | undefined;
  readonly follow: (session: string) => void;
  readonly unfollow: () => void;
}

export function peerLabel(p: Peer): string {
  return p.mine ? 'You, in another tab' : p.name;
}

/** Where a peer is, in words: "on Orders", or why this reader cannot see it. */
export function peerPlace(p: Peer, title: (id: string) => string | undefined): string {
  if (!p.seat.view) return 'on a view you cannot open';
  const t = title(p.seat.view);
  return t ? `on ${t}` : 'on a view you cannot open';
}

export class PresenceUi {
  readonly avatars: HTMLElement;
  private readonly bar: HTMLElement;
  /** Presenters this reader closed the offer for. */
  private readonly declined = new Set<string>();
  private noteTimer: ReturnType<typeof setTimeout> | undefined;
  private note: string | undefined;
  private last: { peers: readonly Peer[]; leader: string | undefined } = { peers: [], leader: undefined };

  constructor(private readonly host: PresenceUiHost) {
    this.avatars = h('div', 'v-peers');
    this.avatars.setAttribute('role', 'group');
    this.avatars.setAttribute('aria-label', 'Also here');
    this.avatars.hidden = true;
    this.bar = h('div', 'v-follow');
    this.bar.setAttribute('role', 'status');
    this.bar.hidden = true;
    host.area.appendChild(this.bar);
  }

  /** Says something for a few seconds in the bar, over any offer. */
  say(text: string): void {
    this.note = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.note = undefined;
      this.renderBar(this.last.peers, this.last.leader);
    }, NOTE_MS);
    this.renderBar(this.last.peers, this.last.leader);
  }

  render(peers: readonly Peer[], leader: string | undefined): void {
    this.last = { peers, leader };
    this.renderAvatars(peers, leader);
    this.renderBar(peers, leader);
  }

  private renderAvatars(peers: readonly Peer[], leader: string | undefined): void {
    this.avatars.replaceChildren();
    this.avatars.hidden = !peers.length;
    for (const p of peers.slice(0, SHOWN)) {
      const followed = p.session === leader;
      const what = `${peerLabel(p)}, ${peerPlace(p, this.host.viewTitle)}${p.seat.presenting ? ', presenting' : ''}. ${followed ? 'Stop following' : 'Follow'}.`;
      const b = button(initials(p.name), () => (followed ? this.host.unfollow() : this.host.follow(p.session)), what, 'v-peer');
      b.style.setProperty('--peer', `var(--path-${peerColor(p.session)})`);
      b.setAttribute('aria-pressed', String(followed));
      b.classList.toggle('v-presenting', Boolean(p.seat.presenting));
      b.classList.toggle('v-guest', p.guest);
      this.avatars.appendChild(b);
    }
    const rest = peers.slice(SHOWN);
    if (rest.length) {
      const more = h('span', 'v-peer v-peer-more', `+${rest.length}`);
      more.title = rest.map((p) => `${peerLabel(p)}, ${peerPlace(p, this.host.viewTitle)}`).join('\n');
      more.setAttribute('aria-label', `${rest.length} more: ${rest.map(peerLabel).join(', ')}`);
      this.avatars.appendChild(more);
    }
  }

  private renderBar(peers: readonly Peer[], leader: string | undefined): void {
    const lead = leader ? peers.find((p) => p.session === leader) : undefined;
    this.host.area.classList.toggle('v-following', lead !== undefined);
    if (lead) this.host.area.style.setProperty('--follow', `var(--path-${peerColor(lead.session)})`);
    this.bar.replaceChildren();
    if (lead) {
      const where = lead.seat.view && !this.host.viewTitle(lead.seat.view) ? ', on a view you cannot open' : '';
      this.bar.append(h('span', 'v-follow-dot'), text('Following ', peerLabel(lead), where));
      this.bar.appendChild(button('Stop', () => this.host.unfollow(), `Stop following ${peerLabel(lead)}`, 'v-btn v-follow-stop'));
      this.bar.style.setProperty('--peer', `var(--path-${peerColor(lead.session)})`);
      this.bar.hidden = false;
      return;
    }
    if (this.note) {
      this.bar.append(text('', this.note, ''));
      this.bar.style.removeProperty('--peer');
      this.bar.hidden = false;
      return;
    }
    const presenter = peers.find((p) => p.seat.presenting && !this.declined.has(p.session));
    if (presenter) {
      this.bar.append(h('span', 'v-follow-dot'), text('', peerLabel(presenter), ' is presenting'));
      this.bar.appendChild(button('Follow', () => this.host.follow(presenter.session), `Follow ${peerLabel(presenter)}`, 'v-btn v-btn-primary v-follow-stop'));
      this.bar.appendChild(iconButton('close', 'Not now', () => {
        this.declined.add(presenter.session);
        this.renderBar(peers, leader);
      }, 'v-btn v-icon-btn v-quiet'));
      this.bar.style.setProperty('--peer', `var(--path-${peerColor(presenter.session)})`);
      this.bar.hidden = false;
      return;
    }
    this.bar.hidden = true;
  }
}

/** A line with one name in bold. */
function text(before: string, name: string, after: string): HTMLElement {
  const line = h('span', 'v-follow-text');
  line.append(before, h('b', undefined, name), after);
  return line;
}
