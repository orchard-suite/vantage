/**
 * Hub mode, authors only: the YAML of the document in a code editor beside
 * the picture. As the author types, the view on the stage redraws from the
 * edited text (the hub lays it out with the document's own imports, icons,
 * and pictures) and the checker's problems show at their lines. Save makes
 * a version with a message; a head that moved is merged, and conflicts
 * come back marked in the text. A save from elsewhere is offered to merge
 * or load; with nothing of the author's to lose it loads on its own.
 */
import type { App } from './app.ts';
import type { Bundle, BundleHub, BundleView } from './bundle.ts';
import { button, h, iconButton } from './dom.ts';
import { HubClient, HubError, type DraftPicture } from './hub.ts';
import { loadEditor } from './edit-load.ts';
import { EditState } from './edit-state.ts';
import { conflictCount, conflictMarks, errorCount, placeDiagnostics, type DraftDiagnostic } from './editor/marks.ts';
import type { CodeEditor } from './editor/code.ts';
import { reportError } from './report.ts';
import { formatRoute } from './router.ts';

/** Quiet time after the last keystroke before the picture redraws. */
const DRAW_DELAY_MS = 450;
/** Problems listed under the editor at most; every one is marked at its line. */
const LISTED = 6;

type Tone = 'ok' | 'warn' | 'error';

export class EditPanel {
  private readonly el = h('section', 'v-edit');
  private readonly host = h('div', 'v-edit-code');
  private readonly state = h('span', 'v-edit-state');
  private readonly score = h('span', 'v-edit-score');
  private readonly pick = h('select', 'v-select v-edit-view');
  private readonly banner = h('div', 'v-edit-banner');
  private readonly notes = h('div', 'v-edit-notes');
  private readonly message = h('input', 'v-input v-edit-message');
  private readonly saveBtn: HTMLButtonElement;
  private editor: CodeEditor | undefined;
  private session: EditState | undefined;
  private viewId: string | undefined;
  private draftView: BundleView | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  private busy = false;
  /** Errors in the text as last drawn; Save still saves, and says so. */

  constructor(
    private readonly app: App,
    private readonly client: HubClient,
    private readonly theme: 'light' | 'dark',
  ) {
    this.el.setAttribute('aria-label', 'Edit YAML');
    const head = h('div', 'v-edit-head');
    this.pick.setAttribute('aria-label', 'View to draw');
    this.pick.addEventListener('change', () => this.pickView(this.pick.value));
    this.state.setAttribute('role', 'status');
    this.state.setAttribute('aria-live', 'polite');
    head.append(h('b', undefined, 'YAML'), this.pick, this.score, this.state, iconButton('close', 'Close the editor', () => this.close(), 'v-btn v-icon-btn v-quiet'));
    // Closing or reloading the tab with unsaved YAML asks first, as the close button does.
    window.addEventListener('beforeunload', (e) => {
      if (this.editor && this.session?.dirty(this.editor.text())) e.preventDefault();
    });
    this.message.placeholder = 'What changed';
    this.message.setAttribute('aria-label', 'Version message');
    this.message.addEventListener('keydown', (e) => e.key === 'Enter' && void this.save());
    this.saveBtn = button('Save', () => void this.save(), 'Save as a new version', 'v-btn v-btn-primary');
    const foot = h('div', 'v-edit-foot');
    foot.append(this.message, this.saveBtn);
    this.notes.setAttribute('aria-label', 'Problems and layout notes');
    this.el.append(head, this.banner, this.host, this.notes, foot);
  }

  get open(): boolean {
    return this.editor !== undefined;
  }

  async toggle(): Promise<void> {
    if (this.open) return this.close();
    this.say('Loading the editor', 'ok');
    this.app.root.classList.add('v-editing');
    this.app.root.appendChild(this.el);
    this.relayout();
    try {
      const [kit, src] = await Promise.all([loadEditor(), this.client.source()]);
      this.session = new EditState(src.version, src.yaml);
      const view = this.app.context.view;
      this.viewId = view?.kind === 'walkthrough' ? view.baseView : view?.id;
      this.editor = kit.create({ parent: this.host, text: src.yaml, label: 'Document YAML', onChange: () => this.changed(), onSave: () => void this.save() });
      this.editor.focus();
      this.draw();
    } catch (err) {
      reportError(err, 'editor');
      this.say(`The editor could not open: ${(err as Error).message}`, 'error');
    }
  }

  /** Called after every bundle refresh: keeps the draft on the stage, and answers a save from elsewhere. */
  onBundle(bundle: Bundle): void {
    const s = this.session;
    const v = bundle.hub?.version;
    if (!this.editor || !s || !v) return;
    if (this.draftView) this.app.showDraft(this.draftView);
    const arrival = s.arrival(v, this.editor.text());
    if (arrival === 'reload') void this.loadTheirs('Someone saved a newer version. The editor now holds it.');
    else if (arrival === 'offer') this.offer();
  }

  private close(): void {
    if (this.editor && this.session?.dirty(this.editor.text()) && !confirm('Close the editor and drop your changes?')) return;
    clearTimeout(this.timer);
    this.seq++;
    this.editor?.destroy();
    this.editor = undefined;
    this.session = undefined;
    this.draftView = undefined;
    this.el.remove();
    this.app.root.classList.remove('v-editing');
    this.app.showDraft(undefined);
    this.relayout();
  }

  private relayout(): void {
    window.dispatchEvent(new Event('resize'));
  }

  private changed(): void {
    clearTimeout(this.timer);
    this.say('Waiting for you to pause', 'ok');
    this.timer = setTimeout(() => this.draw(), DRAW_DELAY_MS);
  }

  private pickView(id: string): void {
    this.viewId = id;
    if (this.app.views.some((v) => v.id === id)) location.hash = formatRoute({ view: id });
    this.draw();
  }

  /** Lays the view out from the edited text and puts it on the stage. */
  private draw(): void {
    const ed = this.editor;
    if (!ed) return;
    const text = ed.text();
    const conflicts = conflictMarks(text);
    if (conflicts.length) {
      ed.mark(conflicts);
      this.listNotes([], undefined);
      const n = conflictCount(text);
      return this.say(n === 1 ? '1 conflict to resolve' : `${n} conflicts to resolve`, 'warn');
    }
    const n = ++this.seq;
    this.say('Drawing', 'ok');
    this.client.draft(text, this.viewId, this.theme).then(
      (d) => n === this.seq && this.drawn(d, text),
      (err: unknown) => n === this.seq && this.say(`Could not draw: ${(err as Error).message}`, 'error'),
    );
  }

  private drawn(d: DraftPicture, text: string): void {
    const ed = this.editor;
    if (!ed) return;
    const { marks, loose } = placeDiagnostics(d.diagnostics, text.split('\n').length);
    ed.mark(marks);
    this.fillViews(d);
    if (d.entry) {
      this.draftView = d.entry;
      this.app.showDraft(d.entry);
    }
    this.listNotes(d.diagnostics, d.metrics?.notes, loose);
    this.score.textContent = d.metrics ? `Score ${d.metrics.score}` : '';
    this.score.dataset['tone'] = !d.metrics ? '' : d.metrics.score >= 80 ? 'ok' : d.metrics.score >= 60 ? 'warn' : 'bad';
    const errors = errorCount(d.diagnostics);
    if (errors) this.say(errors === 1 ? '1 problem' : `${errors} problems`, 'error');
    else if (!d.entry) this.say('Nothing to draw yet', 'warn');
    else this.say(this.session?.dirty(text) ? 'Drawn, not saved' : 'Up to date', 'ok');
  }

  private fillViews(d: DraftPicture): void {
    if (d.view) this.viewId = d.view;
    this.pick.replaceChildren(
      ...d.views.map((v) => {
        const o = h('option', undefined, v.title);
        o.value = v.id;
        o.selected = v.id === this.viewId;
        return o;
      }),
    );
    this.pick.hidden = d.views.length < 2;
  }

  private listNotes(all: readonly DraftDiagnostic[], layout: readonly string[] | undefined, loose: readonly DraftDiagnostic[] = []): void {
    this.notes.replaceChildren();
    const shown = [...all.filter((d) => d.line !== undefined), ...loose].slice(0, LISTED);
    for (const d of shown) {
      const row = h(d.line !== undefined ? 'button' : 'div', `v-edit-note ${d.severity === 'error' ? 'bad' : 'warn'}`);
      if (d.line !== undefined) {
        const line = d.line;
        (row as HTMLButtonElement).type = 'button';
        row.addEventListener('click', () => this.editor?.goTo(line));
        row.appendChild(h('span', 'v-edit-line', `Line ${line}`));
      }
      row.appendChild(h('span', undefined, d.path ? `${d.path}: ${d.message}` : d.message));
      this.notes.appendChild(row);
    }
    for (const note of layout ?? []) this.notes.appendChild(h('div', 'v-edit-note', note));
    this.notes.hidden = !this.notes.childElementCount;
  }

  private async save(): Promise<void> {
    const ed = this.editor;
    const s = this.session;
    if (!ed || !s || this.busy) return;
    const text = ed.text();
    const conflicts = conflictMarks(text);
    if (conflicts.length) {
      ed.goTo(conflicts[0]!.line);
      return this.say('Resolve the marked conflicts before you save', 'warn');
    }
    this.setBusy(true);
    try {
      const r = await this.client.saveSource(text, this.message.value, s.base);
      if (r.status === 'conflict') {
        s.merged(r.head.id);
        ed.setText(r.preview);
        this.showBanner(`Someone changed the same lines. ${r.conflicts === 1 ? 'One place is' : `${r.conflicts} places are`} marked: keep the lines you want, delete the markers, then save.`, []);
        return;
      }
      if (r.status === 'unchanged') return this.say('Nothing to save', 'ok');
      const saved = r.yaml ?? text;
      s.saved(r.version.id, saved);
      if (r.yaml !== undefined) ed.setText(r.yaml);
      this.message.value = '';
      this.showBanner(undefined, []);
      this.say(r.merged ? 'Saved, merged with a newer version' : 'Saved. Rendering', 'ok');
    } catch (err) {
      this.say(err instanceof HubError && err.status === 422 ? notSaved(err) : (err as Error).message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /** Someone else saved over the version the author is editing. */
  private offer(): void {
    this.showBanner('Someone saved a newer version while you were editing.', [
      button('Merge into mine', () => void this.mergeTheirs(), 'Keep your changes and take theirs where they do not touch the same lines', 'v-btn v-btn-primary'),
      button('Load theirs', () => void this.loadTheirs('Loaded the newer version. Your changes are gone.'), 'Drop your changes and edit the newer version', 'v-btn'),
    ]);
  }

  private async mergeTheirs(): Promise<void> {
    const ed = this.editor;
    const s = this.session;
    if (!ed || !s) return;
    try {
      const m = await this.client.mergeSource(ed.text(), s.base);
      s.merged(m.head);
      ed.setText(m.yaml);
      if (m.status === 'conflict') this.showBanner(`${m.conflicts === 1 ? 'One place' : `${m.conflicts} places`} changed on both sides. Keep the lines you want, delete the markers, then save.`, []);
      else {
        this.showBanner(undefined, []);
        this.say('Merged. Save when you are ready', 'ok');
      }
    } catch (err) {
      this.say((err as Error).message, 'error');
    }
  }

  private async loadTheirs(said: string): Promise<void> {
    const ed = this.editor;
    const s = this.session;
    if (!ed || !s) return;
    try {
      const src = await this.client.source();
      s.loaded(src.version, src.yaml);
      ed.setText(src.yaml);
      this.showBanner(undefined, []);
      this.say(said, 'warn');
    } catch (err) {
      this.say((err as Error).message, 'error');
    }
  }

  private showBanner(text: string | undefined, actions: readonly HTMLButtonElement[]): void {
    this.banner.replaceChildren();
    this.banner.classList.toggle('show', text !== undefined);
    if (text === undefined) return;
    const row = h('div', 'v-row');
    row.append(...actions);
    this.banner.append(h('p', undefined, text), ...(actions.length ? [row] : []));
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.saveBtn.disabled = busy;
    this.saveBtn.textContent = busy ? 'Saving' : 'Save';
  }

  private say(text: string, tone: Tone): void {
    this.state.textContent = text;
    this.state.dataset['tone'] = tone;
  }
}

/** What the editor says when the hub refuses a save for its errors; the notes list them. */
function notSaved(err: HubError): string {
  const errors = err.details?.['errors'];
  const n = Array.isArray(errors) ? errors.length : 0;
  return n === 1 ? 'Not saved: fix the problem first' : n ? `Not saved: fix the ${n} problems first` : 'Not saved: fix the problems first';
}

/** Puts Edit YAML in the app bar for an author; the editor opens beside the picture. */
export function wireEditor(app: App, hub: BundleHub, theme: Bundle['theme']): EditPanel {
  const panel = new EditPanel(app, new HubClient(hub), theme === 'dark' ? 'dark' : 'light');
  app.bar.addAction(iconButton('code', 'Edit the YAML beside the picture', () => void panel.toggle(), 'v-btn v-edit-btn', 'Edit YAML'), 'before-present');
  return panel;
}
