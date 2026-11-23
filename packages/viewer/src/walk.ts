/**
 * A walkthrough's steps over its base view: the story card for the step,
 * the boxes it lights, and the frame around them.
 */
import type { BundleView } from './bundle.ts';
import { h } from './dom.ts';
import { hideStory, renderStory } from './story.ts';

export interface WalkHost {
  readonly card: HTMLElement;
  readonly pin: (ids: readonly string[] | undefined) => void;
  readonly frame: (ids: readonly string[]) => void;
  /** The card changed height; the camera's insets follow. */
  readonly resized: () => void;
  /** A step rendered, from a click, a key, or a jump; voice walkthroughs follow it. */
  readonly moved?: () => void;
}

export class Walk {
  /** The step on the card, zero based. */
  index = 0;

  constructor(private readonly host: WalkHost) {}

  /** Shows the step of `v` on the card, framing its boxes when `frame`; hides the card for anything but a walkthrough. */
  render(v: BundleView | undefined, frame: boolean): void {
    if (!v || v.kind !== 'walkthrough' || !v.steps?.length) return hideStory(this.host.card);
    const step = v.steps[this.index]!;
    renderStory(this.host.card, {
      label: h('span', 'v-story-label', 'Walkthrough'),
      index: this.index,
      total: v.steps.length,
      color: 'var(--accent)',
      badge: String(this.index + 1),
      title: step.title,
      text: step.text,
      prev: () => this.move(v, -1),
      next: () => this.move(v, 1),
      hasPrev: this.index > 0,
      hasNext: this.index < v.steps.length - 1,
      announce: `Step ${this.index + 1}: ${step.title}`,
    });
    this.host.pin(step.highlight);
    this.host.resized();
    if (frame) this.host.frame([...(step.highlight ?? []), ...(step.focus ? [step.focus] : [])]);
    this.host.moved?.();
  }

  move(v: BundleView, d: number): void {
    if (!v.steps) return;
    this.index = Math.max(0, Math.min(v.steps.length - 1, this.index + d));
    this.render(v, true);
  }

  /** Goes to a step without framing it, for a reader following another; the camera follows on its own. */
  go(v: BundleView, i: number): void {
    if (!v.steps?.length || i === this.index) return;
    this.index = Math.max(0, Math.min(v.steps.length - 1, i));
    this.render(v, false);
  }

  /** One step on; false at the last. */
  forward(v: BundleView): boolean {
    if (this.index >= (v.steps?.length ?? 0) - 1) return false;
    this.move(v, 1);
    return true;
  }

  back(v: BundleView): boolean {
    if (this.index === 0) return false;
    this.move(v, -1);
    return true;
  }
}
