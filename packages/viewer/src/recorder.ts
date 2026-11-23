/**
 * The microphone side of a voice walkthrough: MediaRecorder in the first
 * audio type the browser records in, and the step timeline kept beside it.
 * Each mark is the moment a step was shown, in ms from the start.
 */
import { pickType, type TimelineEntry } from './recording.ts';
import type { StepPosition } from './stepper.ts';

/** About 32 kbit/s: plenty for a voice, and a 15 minute take stays near 4 MB. */
const BITS_PER_SECOND = 32_000;

export interface Take {
  readonly blob: Blob;
  readonly type: string;
  readonly durationMs: number;
  readonly timeline: readonly TimelineEntry[];
}

export class Recorder {
  private media: MediaRecorder | undefined;
  private stream: MediaStream | undefined;
  private chunks: Blob[] = [];
  private marks: TimelineEntry[] = [];
  private started = 0;

  /** Whether this browser can record here: a secure page with a microphone API and an audio type it records in. */
  static supported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && pickType((t) => MediaRecorder.isTypeSupported(t)) !== undefined;
  }

  get recording(): boolean {
    return this.media?.state === 'recording';
  }

  /** Milliseconds since the take started. */
  get elapsed(): number {
    return this.recording ? performance.now() - this.started : 0;
  }

  /** Asks for the microphone and starts; the first mark is the step on the stage now. Rejects when the reader says no. */
  async start(at: StepPosition, boxes: readonly string[]): Promise<void> {
    const type = pickType((t) => MediaRecorder.isTypeSupported(t))!;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.media = new MediaRecorder(this.stream, { mimeType: type, audioBitsPerSecond: BITS_PER_SECOND });
    this.media.addEventListener('dataavailable', (e) => {
      if (e.data.size) this.chunks.push(e.data);
    });
    this.media.start(1000);
    this.started = performance.now();
    this.marks = [{ at: 0, ...at, boxes }];
  }

  /** The stage moved to another step while recording. */
  mark(at: StepPosition, boxes: readonly string[]): void {
    if (!this.recording) return;
    const last = this.marks[this.marks.length - 1];
    if (last && last.path === at.path && last.step === at.step) return;
    this.marks.push({ at: Math.round(this.elapsed), ...at, boxes });
  }

  /** Stops and hands back the take. */
  stop(): Promise<Take> {
    const media = this.media;
    if (!media || media.state === 'inactive') return Promise.reject(new Error('not recording'));
    const durationMs = Math.max(1, Math.round(this.elapsed));
    return new Promise((resolve) => {
      media.addEventListener(
        'stop',
        () => {
          this.release();
          resolve({ blob: new Blob(this.chunks, { type: media.mimeType }), type: media.mimeType, durationMs, timeline: this.marks });
        },
        { once: true },
      );
      media.stop();
    });
  }

  /** Drops a take in progress and lets go of the microphone. */
  cancel(): void {
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    this.release();
    this.chunks = [];
  }

  private release(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = undefined;
    this.media = undefined;
  }
}
