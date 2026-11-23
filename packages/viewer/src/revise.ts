/**
 * The revise section under the comments: pick a model, send the ticked
 * comments to the organization's model in one go, and wait for its
 * proposal. A proposal shows its summary and a visual diff over the stage;
 * Accept saves it as a version and resolves what it carried out, Reject
 * drops it. Shown only to authors on a hub with a model API.
 */
import type { BundleView } from './bundle.ts';
import { button, h } from './dom.ts';
import type { HubClient, HubRevision, ReviseStatus } from './hub.ts';
import { allowanceNote, spend, tokens } from './allowance.ts';

export interface ReviseHost {
  readonly client: HubClient;
  /** Ids of the open comments the reader ticked on this view. */
  readonly ticked: () => readonly string[];
  readonly view: () => BundleView | undefined;
  /** A revision was saved as this version; refresh comments and wait for the picture. */
  readonly saved: (version: string) => Promise<void>;
  readonly say: (text: string, tone?: 'ok' | 'warn' | 'error') => void;
}

const POLL_MS = 1500;

type Enabled = Extract<ReviseStatus, { enabled: true }>;

export class RevisePanel {
  readonly el = h('div', 'v-revise');
  /** The proposal's visual diff, drawn over the stage while previewed. */
  readonly overlay = h('div', 'v-diffview');
  private status: Enabled | undefined;
  private current: HubRevision | undefined;
  private model: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  constructor(private readonly host: ReviseHost) {
    this.overlay.setAttribute('role', 'region');
    this.overlay.setAttribute('aria-label', 'Proposed revision');
  }

  /** Reads whether this hub revises for this reader; false leaves the section out. */
  async load(): Promise<boolean> {
    const s = await this.host.client.reviseStatus();
    if (!s.enabled || !s.canRevise) return false;
    this.status = s;
    this.model = s.defaultModel;
    const latest = s.latest;
    if (latest && (latest.state === 'queued' || latest.state === 'running' || latest.state === 'ready')) this.track(latest);
    this.render();
    return true;
  }

  render(): void {
    const s = this.status;
    this.el.replaceChildren();
    if (!s) return;
    this.el.appendChild(h('h3', undefined, 'Revise with AI'));
    const r = this.current;
    if (r?.state === 'queued' || r?.state === 'running') {
      this.el.appendChild(h('p', 'v-muted', `Working on ${plural(r.comments.length, 'comment')} with ${r.model}. You can keep working; the proposal shows here when it is ready.`));
      return;
    }
    if (r?.state === 'ready') return this.proposal(r);
    if (r?.state === 'failed') this.el.appendChild(h('p', 'v-revise-error', `The last revision failed: ${r.error ?? 'no reason given'}`));
    const n = this.host.ticked().length;
    const note = allowanceNote(s.allowance);
    this.el.appendChild(h('p', 'v-muted', n ? `Send the ${plural(n, 'ticked comment')} on this view to the model in one go. You check its changes before anything is saved.` : 'Tick the comments on this view you want carried out, then send them in one go.'));
    const row = h('div', 'v-row');
    if (s.models.length > 1) {
      const pick = h('select', 'v-select');
      pick.setAttribute('aria-label', 'Model');
      for (const m of s.models) {
        const o = h('option', undefined, m);
        o.value = m;
        o.selected = m === this.model;
        pick.appendChild(o);
      }
      pick.addEventListener('change', () => (this.model = pick.value));
      row.appendChild(pick);
    }
    const go = button(n ? `Revise from ${plural(n, 'comment')}` : 'Revise', () => void this.ask(), 'Ask the model to carry out the ticked comments', 'v-btn v-btn-primary');
    go.disabled = !n || Boolean(note.stop) || this.busy;
    row.appendChild(go);
    this.el.appendChild(row);
    if (note.stop ?? note.warn) this.el.appendChild(h('p', note.stop ? 'v-revise-error' : 'v-revise-warn', note.stop ?? note.warn));
    this.el.appendChild(h('p', 'v-muted', note.line));
  }

  private proposal(r: HubRevision): void {
    this.el.appendChild(h('p', 'v-revise-summary', r.summary ?? 'The model proposed changes.'));
    const missed = r.comments.length - r.addressed.length;
    this.el.appendChild(h('p', 'v-muted', `Carries out ${plural(r.addressed.length, 'comment')}${missed ? `; ${missed} stay${missed === 1 ? 's' : ''} open` : ''}. ${tokens(total(r))} tokens.`));
    const row = h('div', 'v-row');
    row.append(button('Preview', () => this.preview(r), 'See the changes on this view', 'v-btn'), this.acceptButton(r), this.rejectButton(r));
    this.el.appendChild(row);
  }

  private acceptButton(r: HubRevision): HTMLButtonElement {
    const b = button('Accept', () => void this.decide(r, true), 'Save these changes as a new version', 'v-btn v-btn-primary');
    b.disabled = this.busy;
    return b;
  }

  private rejectButton(r: HubRevision): HTMLButtonElement {
    const b = button('Reject', () => void this.decide(r, false), 'Drop these changes; the comments stay open', 'v-btn');
    b.disabled = this.busy;
    return b;
  }

  private async ask(): Promise<void> {
    const ids = this.host.ticked();
    if (!ids.length || !this.model) return;
    this.busy = true;
    try {
      this.track(await this.host.client.requestRevision(ids, this.model));
      this.host.say(`Sent ${plural(ids.length, 'comment')} to ${this.model}.`);
    } catch (err) {
      this.host.say((err as Error).message, 'error');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /** Follows a revision until it leaves the queue. */
  private track(r: HubRevision): void {
    this.current = r;
    clearTimeout(this.timer);
    if (r.state !== 'queued' && r.state !== 'running') return;
    this.timer = setTimeout(() => {
      void this.host.client.revision(r.id).then(
        (next) => {
          if (next.state !== r.state) {
            const done = next.state !== 'queued' && next.state !== 'running';
            if (done && this.status) this.status = { ...this.status, allowance: spend(this.status.allowance, total(next)) };
            if (next.state === 'ready') this.host.say('The proposal is ready. Preview it, then accept or reject.');
            if (next.state === 'failed') this.host.say(`The revision failed: ${next.error ?? 'no reason given'}`, 'error');
          }
          this.track(next);
          this.render();
        },
        () => this.track(r),
      );
    }, POLL_MS);
  }

  private async decide(r: HubRevision, accept: boolean): Promise<void> {
    this.busy = true;
    this.render();
    try {
      if (accept) {
        const saved = await this.host.client.acceptRevision(r.id);
        this.current = { ...r, state: 'accepted' };
        this.close();
        await this.host.saved(saved.version.id);
      } else {
        this.current = await this.host.client.rejectRevision(r.id);
        this.close();
        this.host.say('Dropped. The comments stay open.');
      }
    } catch (err) {
      this.host.say((err as Error).message, 'error');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private preview(r: HubRevision): void {
    const view = this.host.view();
    if (!view) return;
    const theme = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
    const bar = h('div', 'bar');
    bar.append(h('span', undefined, `Proposed changes to ${view.title}`), this.acceptButton(r), this.rejectButton(r), button('Close', () => this.close(), 'Close the preview', 'v-btn'));
    const img = h('img');
    img.alt = `Proposed changes to ${view.title}`;
    img.src = this.host.client.revisionDiffSvgUrl(r.id, view.id, theme);
    this.overlay.replaceChildren(bar, img);
    this.overlay.classList.add('show');
  }

  private close(): void {
    this.overlay.classList.remove('show');
    this.overlay.replaceChildren();
  }
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

/** Every token a revision spent, the way the limits count them. */
function total(r: HubRevision): number {
  return r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;
}
