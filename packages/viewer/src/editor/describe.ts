/**
 * Describe it, on the New page: the system in words (and any notes pasted
 * beside them), a model, and Generate. The hub's worker asks the model for
 * a whole document, checks and lays it out, and asks once more when it is
 * not good enough; the draft then lands in the editor, unsaved, for the
 * author to adjust and create. Spend counts against the same limits as
 * revisions, and the page says what is left.
 */
import { allowanceNote, spend, tokens } from '../allowance.ts';
import type { Allowance } from '../hub.ts';
import { headers } from './http.ts';

const POLL_MS = 1500;

/** What the page knows when it opens; the hub writes it into the page. */
export interface DescribeSetup {
  readonly models: readonly string[];
  readonly defaultModel: string;
  readonly allowance: Allowance;
}

export interface DescribeHost {
  /** The workspace the diagram will be saved to. */
  readonly workspace: () => string;
  /** Puts a draft in the editor; it redraws like typing. */
  readonly draft: (yaml: string) => void;
  readonly focusEditor: () => void;
}

interface Generation {
  readonly id: string;
  readonly state: 'queued' | 'running' | 'ready' | 'failed';
  readonly model: string;
  readonly yaml: string | null;
  readonly summary: string | null;
  readonly error: string | null;
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
}

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the new page has no #${id}`);
  return el as T;
}

export class Describe {
  private readonly panel = need<HTMLElement>('new-describe');
  private readonly text = need<HTMLTextAreaElement>('new-desc');
  private readonly notes = need<HTMLTextAreaElement>('new-paste');
  private readonly model = need<HTMLSelectElement>('new-model');
  private readonly go = need<HTMLButtonElement>('new-gen');
  private readonly state = need<HTMLParagraphElement>('new-gen-state');
  private readonly allow = need<HTMLParagraphElement>('new-gen-allow');
  private readonly draftNote = need<HTMLDivElement>('new-draft');
  private allowance: Allowance;
  private running = false;

  constructor(setup: DescribeSetup, private readonly host: DescribeHost) {
    this.allowance = setup.allowance;
    for (const m of setup.models) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      o.selected = m === setup.defaultModel;
      this.model.append(o);
    }
    this.model.hidden = setup.models.length < 2;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#new-mode button')) b.addEventListener('click', () => this.mode(b.dataset['mode'] === 'describe'));
    this.text.addEventListener('input', () => this.render());
    this.go.addEventListener('click', () => void this.generate());
    need<HTMLElement>('new-mode').hidden = false;
    this.render();
  }

  private mode(describe: boolean): void {
    this.panel.hidden = !describe;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#new-mode button')) b.setAttribute('aria-pressed', String((b.dataset['mode'] === 'describe') === describe));
    if (describe) this.text.focus();
  }

  private render(): void {
    const note = allowanceNote(this.allowance);
    this.allow.textContent = note.stop ?? note.warn ?? note.line;
    this.allow.className = `f-hint${note.stop ? ' bad' : note.warn ? ' warn' : ''}`;
    this.go.disabled = this.running || Boolean(note.stop) || !this.text.value.trim();
    this.go.textContent = this.running ? 'Drawing' : 'Generate';
  }

  private say(text: string, tone: 'ok' | 'bad' = 'ok'): void {
    this.state.textContent = text;
    this.state.className = `f-hint${tone === 'bad' ? ' bad' : ''}`;
  }

  private async generate(): Promise<void> {
    this.running = true;
    this.render();
    this.say(`Asking ${this.model.value} for a diagram. This takes a minute or so; the hub checks it and asks again if it needs fixing.`);
    try {
      const res = await fetch('/api/v1/generations', { method: 'POST', headers: headers(), credentials: 'same-origin', body: JSON.stringify({ workspace: this.host.workspace(), description: this.text.value, notes: this.notes.value || undefined, model: this.model.value }) });
      const g = (await res.json()) as Generation & { error?: string };
      if (!res.ok) throw new Error(g.error ?? `the hub answered ${res.status}`);
      this.finish(await this.follow(g));
    } catch (err) {
      this.say((err as Error).message, 'bad');
    } finally {
      this.running = false;
      this.render();
    }
  }

  /** Polls until the generation leaves the queue. */
  private async follow(g: Generation): Promise<Generation> {
    let cur = g;
    while (cur.state === 'queued' || cur.state === 'running') {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const res = await fetch(`/api/v1/generations/${encodeURIComponent(cur.id)}`, { credentials: 'same-origin' });
      if (res.ok) cur = (await res.json()) as Generation;
    }
    return cur;
  }

  private finish(g: Generation): void {
    const used = g.tokens.input + g.tokens.output + g.tokens.cacheRead + g.tokens.cacheWrite;
    this.allowance = spend(this.allowance, used);
    if (g.state === 'failed' || !g.yaml) return this.say(`No diagram this time: ${g.error ?? 'no reason given'}`, 'bad');
    this.host.draft(g.yaml);
    this.draftNote.replaceChildren();
    const b = document.createElement('div');
    b.className = 'banner';
    const words = document.createElement('span');
    words.textContent = `Draft from ${g.model}, ${tokens(used)} tokens. ${g.summary ?? ''} It is not saved yet: adjust it, then create the diagram.`;
    b.append(words);
    this.draftNote.append(b);
    this.say('The draft is in the editor.');
    this.mode(false);
    this.host.focusEditor();
  }
}
