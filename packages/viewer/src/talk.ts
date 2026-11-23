/**
 * Voice walkthroughs on the story card. An author presses Record on a
 * walkthrough or a view with paths and steps through while talking; each
 * step change is marked against the audio. The take can be previewed,
 * recorded again, or saved. A reader plays a saved one: the audio drives
 * the steps, a step the reader picks moves the audio to where it was
 * shown, and the seek bar moves both. One made on an older version says
 * so and skips steps whose boxes are gone.
 */
import type { App } from './app.ts';
import type { Bundle } from './bundle.ts';
import { button, h, iconButton } from './dom.ts';
import { clock, hasStory, positionAt, resolveEntry, samePosition, seekFor, stepBoxes, storyOf, type TimelineEntry } from './recording.ts';
import { Recorder, type Take } from './recorder.ts';
import { setStoryTail } from './story.ts';
import { TalkClient, type HubRecording, type RecordingLimits } from './talk-client.ts';
import type { StepPosition } from './stepper.ts';
import { reportError, reportTalk } from './report.ts';

/** What plays: a saved recording, or the take not yet saved. */
interface Track {
  readonly src: string;
  readonly durationMs: number;
  readonly timeline: readonly TimelineEntry[];
}

export class Talk {
  private readonly el = h('div', 'v-talk');
  private readonly audio = new Audio();
  private readonly recorder = new Recorder();
  private readonly client: TalkClient;
  private readonly canRecord: boolean;
  private recordings: readonly HubRecording[] = [];
  private limits: RecordingLimits = { maxSeconds: 900, maxBytes: 50 * 1024 * 1024 };
  private version: string | undefined;
  private viewId: string | undefined;
  private picked: string | undefined;
  private take: (Take & { url: string }) | undefined;
  private track: Track | undefined;
  private resolved: (StepPosition | undefined)[] = [];
  /** The step the audio last put on the stage; the stage is only moved when this changes, so a reader's own step is not taken back. */
  private audioAt: StepPosition | undefined;
  /** Set while the audio moves the stage, so that move is not taken as the reader's. */
  private driving = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private note = '';

  constructor(
    private readonly app: App,
    bundle: Bundle,
    beside: (leaf: string) => URL,
  ) {
    this.client = new TalkClient(beside, bundle.hub);
    this.canRecord = Boolean(bundle.hub?.canEdit) && Recorder.supported();
    this.version = bundle.version ?? bundle.hub?.version;
    this.audio.preload = 'metadata';
    this.audio.addEventListener('timeupdate', () => this.follow());
    this.audio.addEventListener('play', () => this.render());
    this.audio.addEventListener('pause', () => this.render());
    this.audio.addEventListener('seeked', () => this.follow());
    this.audio.addEventListener('error', () => this.say('The recording could not be played.'));
    app.onStep = () => this.onStep();
    void this.load();
  }

  /** A newer bundle is on the stage: recordings made before it are now on an older version, and steps find their boxes again. */
  onBundle(bundle: Bundle): void {
    this.version = bundle.version ?? bundle.hub?.version;
    this.resolve();
    this.render();
  }

  private async load(): Promise<void> {
    try {
      const list = await this.client.list();
      this.recordings = list.recordings;
      this.limits = list.limits;
    } catch (err) {
      reportError(err, 'recording');
    }
    this.onStep(true);
  }

  private get current(): HubRecording | undefined {
    const mine = this.recordings.filter((r) => r.view === this.viewId);
    return mine.find((r) => r.id === this.picked) ?? mine[0];
  }

  private onStep(force = false): void {
    const view = this.app.context.view;
    const moved = view?.id !== this.viewId;
    if (moved) {
      this.leaveView();
      this.viewId = view?.id;
    }
    const story = storyOf(view, this.app.context.drawn);
    const card = this.app.main.querySelector<HTMLElement>(':scope > .v-story');
    const shown = hasStory(story) && (this.canRecord || this.recordings.some((r) => r.view === this.viewId));
    if (card) setStoryTail(card, shown ? this.el : undefined);
    if (!shown || !story) return;
    const at = this.app.position;
    if (this.recorder.recording) this.recorder.mark(at, stepBoxes(story, at) ?? []);
    else if (this.track && !this.driving && !this.audio.paused) {
      const t = seekFor(this.track.timeline, this.resolved, at, this.audio.currentTime * 1000);
      if (t !== undefined) {
        this.audioAt = at;
        this.audio.currentTime = t / 1000;
      }
    }
    if (force || moved || !this.el.childElementCount) this.render();
  }

  /** The reader went to another view: playback stops, and a take in progress is dropped. */
  private leaveView(): void {
    this.stopTimer();
    this.recorder.cancel();
    this.audio.pause();
    this.discard();
    this.track = undefined;
    this.picked = undefined;
    this.note = '';
  }

  /** The audio moved: put the step it shows on the stage when that step changed. */
  private follow(): void {
    if (!this.track) return;
    const at = positionAt(this.track.timeline, this.resolved, this.audio.currentTime * 1000);
    this.renderTime();
    if (!at || samePosition(at, this.audioAt)) return;
    this.audioAt = at;
    if (samePosition(at, this.app.position)) return;
    this.driving = true;
    try {
      this.app.stepTo(at);
    } finally {
      this.driving = false;
    }
  }

  private resolve(): void {
    const story = storyOf(this.app.context.view, this.app.context.drawn);
    const drawn = new Set(this.app.context.drawn?.boxes.map((b) => b.id) ?? []);
    this.resolved = story && this.track ? this.track.timeline.map((e) => resolveEntry(e, story, drawn)) : [];
    this.audioAt = undefined;
  }

  private play(track: Track): void {
    if (this.track?.src !== track.src) {
      this.track = track;
      this.audio.src = track.src;
      this.resolve();
    }
    void this.audio.play().catch((err: unknown) => {
      this.say('The recording could not be played.');
      reportError(err, 'recording');
    });
    reportTalk('play', track.durationMs);
  }

  private playSaved(): void {
    const r = this.current;
    if (!r) return;
    this.play({ src: this.client.audioUrl(r.id), durationMs: r.durationMs, timeline: r.timeline });
  }

  private async record(): Promise<void> {
    this.audio.pause();
    this.discard();
    this.track = undefined;
    const story = storyOf(this.app.context.view, this.app.context.drawn);
    const at = this.app.position;
    try {
      await this.recorder.start(at, story ? stepBoxes(story, at) ?? [] : []);
    } catch (err) {
      this.say(err instanceof DOMException && err.name === 'NotAllowedError' ? 'The browser was not allowed to use the microphone.' : 'Recording could not start.');
      reportError(err, 'recording');
      return;
    }
    this.note = '';
    // The timer text changes once a second; nothing else on the card moves while recording.
    this.timer = setInterval(() => {
      if (this.recorder.elapsed >= this.limits.maxSeconds * 1000) void this.stop();
      else this.renderTime();
    }, 1000);
    this.render();
  }

  private async stop(): Promise<void> {
    this.stopTimer();
    const take = await this.recorder.stop().catch(() => undefined);
    if (!take) return this.render();
    this.take = { ...take, url: URL.createObjectURL(take.blob) };
    if (take.blob.size > this.limits.maxBytes) this.note = `This take is larger than the hub keeps (${Math.round(this.limits.maxBytes / 1048576)} MB). Record a shorter one.`;
    reportTalk('record', take.durationMs);
    this.render();
  }

  private async save(): Promise<void> {
    const take = this.take;
    if (!take || !this.viewId || !this.version) return;
    this.say('Saving the recording.');
    try {
      const saved = await this.client.save(take, this.viewId, this.version);
      this.recordings = [saved, ...this.recordings];
      this.picked = saved.id;
      this.audio.pause();
      this.discard();
      this.track = undefined;
      this.say('Saved. Readers of this view can play it now.');
      reportTalk('save', take.durationMs);
    } catch (err) {
      this.say(`The recording was not saved: ${(err as Error).message}`);
    }
  }

  private async remove(): Promise<void> {
    const r = this.current;
    if (!r || !confirm('Delete this voice walkthrough for everyone?')) return;
    try {
      await this.client.remove(r.id);
      if (this.track?.src === this.client.audioUrl(r.id)) {
        this.audio.pause();
        this.track = undefined;
      }
      this.recordings = this.recordings.filter((x) => x.id !== r.id);
      this.picked = undefined;
      this.say('Deleted.');
      this.onStep(true);
    } catch (err) {
      this.say(`The recording was not deleted: ${(err as Error).message}`);
    }
  }

  private discard(): void {
    if (this.take) URL.revokeObjectURL(this.take.url);
    this.take = undefined;
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private say(text: string): void {
    this.note = text;
    this.render();
  }

  private render(): void {
    const row = h('div', 'v-talk-row');
    if (this.recorder.recording) {
      row.append(iconButton('stop', 'Stop recording', () => void this.stop(), 'v-btn v-talk-stop', 'Stop'), h('span', 'v-talk-dot'), h('span', 'v-talk-time', ''), h('span', 'v-talk-hint', 'Step through as you talk.'));
    } else if (this.take) {
      const take = this.take;
      row.append(this.playButton(() => this.play({ src: take.url, durationMs: take.durationMs, timeline: take.timeline })), this.seekBar(), h('span', 'v-talk-time', ''));
      const keep = button('Save', () => void this.save(), 'Save this recording for readers', 'v-btn v-btn-primary');
      keep.disabled = take.blob.size > this.limits.maxBytes;
      row.append(keep, button('Record again', () => void this.record()), iconButton('trash', 'Discard this take', () => this.leaveTake(), 'v-btn v-icon-btn v-quiet'));
    } else {
      const r = this.current;
      if (r) row.append(this.playButton(() => this.playSaved()), this.seekBar(), h('span', 'v-talk-time', ''), this.chooser());
      if (this.canRecord) row.append(iconButton('mic', 'Record a voice walkthrough of this story', () => void this.record(), r ? 'v-btn v-icon-btn v-quiet' : 'v-btn', r ? undefined : 'Record'));
      if (r && this.canRecord) row.append(iconButton('trash', 'Delete this voice walkthrough', () => void this.remove(), 'v-btn v-icon-btn v-quiet'));
    }
    const parts: HTMLElement[] = [row];
    const older = !this.take && !this.recorder.recording && this.current && this.current.version !== this.version;
    if (older) parts.push(h('p', 'v-talk-note', 'Recorded on an older version. Steps whose boxes are gone are skipped.'));
    if (this.note) parts.push(h('p', 'v-talk-note', this.note));
    this.el.replaceChildren(...parts);
    this.renderTime();
    this.el.dispatchEvent(new Event('v-resize', { bubbles: true }));
  }

  private leaveTake(): void {
    this.audio.pause();
    this.discard();
    this.track = undefined;
    this.render();
  }

  private playButton(start: () => void): HTMLButtonElement {
    const playing = !this.audio.paused && this.track !== undefined;
    return iconButton(playing ? 'pause' : 'play', playing ? 'Pause the voice walkthrough' : 'Play the voice walkthrough', () => (playing ? this.audio.pause() : start()), 'v-btn v-icon-btn v-talk-play');
  }

  private seekBar(): HTMLInputElement {
    const bar = h('input', 'v-talk-seek');
    bar.type = 'range';
    bar.min = '0';
    bar.step = '0.1';
    bar.setAttribute('aria-label', 'Position in the voice walkthrough');
    bar.addEventListener('input', () => {
      const len = this.length();
      if (!this.track) return;
      this.audio.currentTime = (Number(bar.value) / 1000) * len / 1000;
    });
    return bar;
  }

  private chooser(): HTMLElement {
    const mine = this.recordings.filter((r) => r.view === this.viewId);
    if (mine.length < 2) return h('span', 'v-talk-by', this.current?.authorLabel ?? '');
    const select = h('select', 'v-select v-talk-pick');
    select.setAttribute('aria-label', 'Voice walkthroughs of this view');
    for (const r of mine) {
      const o = h('option', undefined, `${r.authorLabel ?? 'Someone'}, ${clock(r.durationMs)}, ${new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
      o.value = r.id;
      o.selected = r.id === this.current?.id;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      this.audio.pause();
      this.track = undefined;
      this.picked = select.value;
      this.render();
    });
    return select;
  }

  /** The length on the bar: the recorded length, since a WebM take may not carry its own duration. */
  private length(): number {
    return this.take?.durationMs ?? this.track?.durationMs ?? this.current?.durationMs ?? 0;
  }

  private renderTime(): void {
    const time = this.el.querySelector('.v-talk-time');
    const len = this.length();
    if (this.recorder.recording) {
      if (time) time.textContent = `Recording ${clock(this.recorder.elapsed)} of ${clock(this.limits.maxSeconds * 1000)}`;
      return;
    }
    const ms = this.track ? this.audio.currentTime * 1000 : 0;
    if (time) time.textContent = `${clock(ms)} / ${clock(len)}`;
    const bar = this.el.querySelector<HTMLInputElement>('.v-talk-seek');
    if (bar) {
      bar.max = '1000';
      bar.value = String(len ? Math.min(1000, (ms / len) * 1000) : 0);
    }
  }
}
