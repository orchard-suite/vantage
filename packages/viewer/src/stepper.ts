/**
 * Steps through a view's paths. Step -1 is the overview: nothing dimmed.
 * Each step lights the edge and its two ends, dims the rest, and frames
 * the two ends; the text for the step shows in the story card. Several
 * paths are chips at the head of the card.
 */
import type { BundlePath, BundleView } from './bundle.ts';
import { button, h } from './dom.ts';
import { hideStory, renderStory } from './story.ts';

export interface StepperHost {
  readonly card: HTMLElement;
  readonly pin: (ids: readonly string[] | undefined) => void;
  /** Frames the boxes of a step, or the whole picture for the overview. */
  readonly frame: (boxIds: readonly string[] | undefined) => void;
  /** After every render: the step, the path, or the view under the stepper may have changed. */
  readonly moved?: () => void;
}

/** Where a story stands: the path (0 for a walkthrough) and the step in it, -1 for a path's overview. */
export interface StepPosition {
  readonly path: number;
  readonly step: number;
}

export class PathStepper {
  private view: BundleView | undefined;
  private pathIndex = 0;
  private step = -1;

  constructor(private readonly host: StepperHost) {}

  get active(): boolean {
    return Boolean(this.view?.paths?.length);
  }

  get path(): BundlePath | undefined {
    return this.view?.paths?.[this.pathIndex];
  }

  /** True when a next step exists in the current path. */
  get hasNext(): boolean {
    return this.step < (this.path?.steps.length ?? 0) - 1;
  }

  get hasPrev(): boolean {
    return this.step >= 0;
  }

  /** Where the reader is in the paths, for presence; undefined when the view has none. */
  get position(): { path: number; step: number } | undefined {
    return this.active ? { path: this.pathIndex, step: this.step } : undefined;
  }

  /** Goes to a path and step without framing it, for a reader following another; the camera follows on its own. */
  go(path: number, step: number): void {
    const p = this.view?.paths?.[path];
    if (!p || (path === this.pathIndex && step === this.step)) return;
    this.pathIndex = path;
    this.step = Math.max(-1, Math.min(p.steps.length - 1, step));
    this.render();
  }

  /** Moves to a path and step as a click would, clamped to what the view has. */
  goTo(p: StepPosition): void {
    const paths = this.view?.paths ?? [];
    if (!paths.length) return;
    this.pathIndex = Math.max(0, Math.min(paths.length - 1, p.path));
    this.step = Math.max(-1, Math.min(paths[this.pathIndex]!.steps.length - 1, p.step));
    this.render();
    this.frame();
  }

  attach(view: BundleView | undefined): void {
    this.view = view;
    this.pathIndex = 0;
    this.step = -1;
    this.render();
  }

  /** The picture under the stepper changed (depth or open container); keep the step, redo the highlight. */
  retarget(view: BundleView): void {
    this.view = view;
    this.render();
  }

  move(d: number): void {
    const n = this.path?.steps.length ?? 0;
    this.step = Math.max(-1, Math.min(n - 1, this.step + d));
    this.render();
    this.frame();
  }

  /** Frames the current step again after the stage changed size; false when on the overview. */
  reframe(): boolean {
    if (this.step < 0 || !this.path) return false;
    this.frame();
    return true;
  }

  private frame(): void {
    const s = this.path?.steps[this.step];
    this.host.frame(s ? [s.from, s.to] : undefined);
  }

  /** Jumps to the step whose badge was clicked; badge element ids are `badge-<path>-<badge>`. */
  jumpToBadge(badgeId: string): boolean {
    const paths = this.view?.paths ?? [];
    for (let p = 0; p < paths.length; p++) {
      const i = paths[p]!.steps.findIndex((s) => `badge-${paths[p]!.id}-${s.badge}` === badgeId);
      if (i >= 0) {
        this.pathIndex = p;
        this.step = i;
        this.render();
        this.frame();
        return true;
      }
    }
    return false;
  }

  private apply(): void {
    const s = this.path?.steps[this.step];
    if (!s) return this.host.pin(undefined);
    const edge = (s.edgeId && this.view?.edges.some((e) => e.id === s.edgeId) ? s.edgeId : undefined)
      ?? this.view?.edges.find((e) => (e.from === s.from && e.to === s.to) || e.members.includes(`${s.from}>${s.to}`))?.id;
    this.host.pin([s.from, s.to, ...(edge ? [edge] : []), `badge-${this.path!.id}-${s.badge}`]);
  }

  private pick(i: number): void {
    this.pathIndex = i;
    this.step = -1;
    this.render();
    this.frame();
  }

  private render(): void {
    this.draw();
    this.host.moved?.();
  }

  private draw(): void {
    const card = this.host.card;
    const paths = this.view?.paths ?? [];
    if (!paths.length) return hideStory(card);
    const path = this.path!;
    let label: HTMLElement;
    if (paths.length > 1) {
      label = h('div', 'v-chips');
      label.setAttribute('role', 'group');
      label.setAttribute('aria-label', 'Paths');
      paths.forEach((p, i) => {
        const chip = button(p.title ?? p.id, () => this.pick(i), undefined, 'v-chip');
        chip.style.setProperty('--chip', `var(--path-${p.color}, var(--accent))`);
        chip.setAttribute('aria-pressed', String(i === this.pathIndex));
        label.appendChild(chip);
      });
    } else {
      label = h('span', 'v-story-label', path.title ?? 'Path');
    }
    const s = path.steps[this.step];
    const name = (id: string): string => this.view?.boxes.find((b) => b.id === id)?.name ?? id;
    renderStory(card, {
      label,
      index: this.step,
      total: path.steps.length,
      color: `var(--path-${path.color}, var(--accent))`,
      badge: s?.badge,
      title: s ? `${name(s.from)} → ${name(s.to)}${s.label ? `: ${s.label}` : ''}` : path.title ?? 'Path',
      text: s ? s.text : 'Step through with the arrow keys, or click a numbered badge in the picture.',
      prev: () => this.move(-1),
      next: () => this.move(1),
      hasPrev: this.hasPrev,
      hasNext: this.hasNext,
      announce: s ? `Step ${s.badge}: ${s.text ?? s.label ?? ''}` : '',
    });
    this.apply();
  }
}
