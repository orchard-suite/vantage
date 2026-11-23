/**
 * The arithmetic of a voice walkthrough, apart from the browser: which
 * boxes a step lights, where each recorded step lands in the picture the
 * reader has now, which step a moment of audio shows, and which moment a
 * step the reader picked starts at. A recording made on an older version
 * finds its steps by the boxes they lit; a step whose boxes are all gone
 * is skipped, so the step before it stays up.
 */
import type { BundleView } from './bundle.ts';
import type { StepPosition } from './stepper.ts';

/** One step shown while recording: when (ms from the start), where, and the boxes it lit. */
export interface TimelineEntry {
  readonly at: number;
  readonly path: number;
  readonly step: number;
  readonly boxes: readonly string[];
}

/** The audio types to ask MediaRecorder for, best first: opus in WebM (Chrome, Firefox), AAC in MP4 (Safari), opus in Ogg. */
export const RECORD_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'] as const;

export function pickType(supported: (type: string) => boolean): string | undefined {
  return RECORD_TYPES.find((t) => supported(t));
}

/** The view whose steps a story walks: a walkthrough's own steps, else the paths of the picture on the stage. */
export function storyOf(current: BundleView | undefined, drawn: BundleView | undefined): BundleView | undefined {
  return current?.kind === 'walkthrough' ? current : drawn;
}

/** Whether a view has steps to record over. */
export function hasStory(view: BundleView | undefined): boolean {
  return view?.kind === 'walkthrough' ? Boolean(view.steps?.length) : Boolean(view?.paths?.length);
}

/** The boxes a step lights; the overview lights none. Undefined when the view has no such step. */
export function stepBoxes(story: BundleView, p: StepPosition): readonly string[] | undefined {
  if (story.kind === 'walkthrough') {
    const s = p.path === 0 ? story.steps?.[p.step] : undefined;
    return s ? [...new Set([...(s.highlight ?? []), ...(s.focus ? [s.focus] : [])])] : undefined;
  }
  const path = story.paths?.[p.path];
  if (!path) return undefined;
  if (p.step === -1) return [];
  const s = path.steps[p.step];
  return s ? [s.from, s.to] : undefined;
}

function positions(story: BundleView): StepPosition[] {
  if (story.kind === 'walkthrough') return (story.steps ?? []).map((_, step) => ({ path: 0, step }));
  return (story.paths ?? []).flatMap((p, path) => p.steps.map((_, step) => ({ path, step })));
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Where a recorded step lands in the story the reader has: the same place
 * when it still lights the same boxes, else the first step that does, else
 * the same place while any of its boxes are still drawn. Undefined skips it.
 */
export function resolveEntry(e: TimelineEntry, story: BundleView, drawn: ReadonlySet<string>): StepPosition | undefined {
  const here = { path: e.path, step: e.step };
  const at = stepBoxes(story, here);
  if (e.step === -1) return at ? here : undefined;
  if (at && sameSet(at, e.boxes)) return here;
  const moved = e.boxes.length ? positions(story).find((p) => sameSet(stepBoxes(story, p)!, e.boxes)) : undefined;
  if (moved) return moved;
  if (at && (!e.boxes.length || e.boxes.some((b) => drawn.has(b)))) return here;
  return undefined;
}

/** The step the audio shows at `ms`: the latest entry at or before it that lands somewhere. */
export function positionAt(timeline: readonly TimelineEntry[], resolved: readonly (StepPosition | undefined)[], ms: number): StepPosition | undefined {
  for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i]!.at <= ms && resolved[i]) return resolved[i];
  return resolved.find((p) => p !== undefined);
}

export const samePosition = (a: StepPosition | undefined, b: StepPosition | undefined): boolean => a?.path === b?.path && a?.step === b?.step;

/** Where the audio should jump when the reader steps to `p`: the moment that step was shown nearest to now, or undefined when it never was. */
export function seekFor(timeline: readonly TimelineEntry[], resolved: readonly (StepPosition | undefined)[], p: StepPosition, nowMs: number): number | undefined {
  let best: number | undefined;
  timeline.forEach((e, i) => {
    if (samePosition(resolved[i], p) && (best === undefined || Math.abs(e.at - nowMs) < Math.abs(best - nowMs))) best = e.at;
  });
  return best;
}

/** A length as m:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
