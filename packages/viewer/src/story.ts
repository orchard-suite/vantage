/**
 * The story card: one step of a path or a walkthrough, floating over the
 * bottom of the stage. A progress rule in the path's color, the count and
 * the arrows, then the step itself. The card can be folded to its head
 * row so the picture has the room; the fold lasts while the card lives.
 * A tail (the voice walkthrough controls) rides under the head row and
 * stays across steps, so a recording or a playback keeps its element.
 */
import { h, iconButton } from './dom.ts';

export interface StoryStep {
  /** Left of the count: the path chooser, or a plain label. */
  readonly label: HTMLElement;
  /** Zero based; -1 is the overview before the first step. */
  readonly index: number;
  readonly total: number;
  readonly title: string;
  readonly text?: string | undefined;
  readonly badge?: string | undefined;
  /** A CSS color for the badge and the progress rule. */
  readonly color: string;
  readonly prev: () => void;
  readonly next: () => void;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
  /** What a screen reader hears when the step changes. */
  readonly announce: string;
}

const tails = new WeakMap<HTMLElement, HTMLElement>();

/** Puts an element under the card's head row on every render, or takes it away; the card shows it at once if it is up. */
export function setStoryTail(card: HTMLElement, tail: HTMLElement | undefined): void {
  const old = tails.get(card);
  if (old === tail) return;
  old?.remove();
  if (tail) tails.set(card, tail);
  else tails.delete(card);
  const head = card.querySelector(':scope > .v-story-head');
  if (tail && head) head.after(tail);
  card.dispatchEvent(new Event('v-resize', { bubbles: true }));
}

export function renderStory(card: HTMLElement, s: StoryStep): void {
  card.replaceChildren();
  card.style.setProperty('--story', s.color);
  const rule = h('div', 'v-story-rule');
  const fill = h('i');
  fill.style.width = `${s.total ? ((s.index + 1) / s.total) * 100 : 0}%`;
  rule.appendChild(fill);
  const head = h('div', 'v-story-head');
  const count = h('span', 'v-story-count', s.index < 0 ? `${s.total} steps` : `${s.index + 1} / ${s.total}`);
  const prev = iconButton('prev', 'Previous step (←)', s.prev);
  prev.disabled = !s.hasPrev;
  const next = iconButton('next', s.index < 0 ? 'Start (→)' : 'Next step (→)', s.next, s.index < 0 ? 'v-btn v-icon-btn v-start' : 'v-btn v-icon-btn', s.index < 0 ? 'Start' : undefined);
  next.disabled = !s.hasNext;
  const folded = card.classList.contains('folded');
  const fold = iconButton(folded ? 'plus' : 'minus', folded ? 'Show the step' : 'Fold the card', () => {
    card.classList.toggle('folded');
    renderStory(card, s);
    card.dispatchEvent(new Event('v-resize', { bubbles: true }));
  }, 'v-btn v-icon-btn v-quiet');
  fold.setAttribute('aria-expanded', String(!folded));
  head.append(s.label, count, prev, next, fold);
  const body = h('div', 'v-story-body');
  if (s.badge !== undefined) body.appendChild(h('span', 'v-story-badge', s.badge));
  const words = h('div', 'v-story-words');
  words.appendChild(h('div', 'v-story-title', s.title));
  if (s.text) words.appendChild(h('p', 'v-story-text', s.text));
  body.appendChild(words);
  const live = h('span', 'v-live');
  live.setAttribute('aria-live', 'polite');
  live.textContent = s.announce;
  const tail = tails.get(card);
  card.append(rule, head, ...(tail ? [tail] : []), body, live);
  card.classList.add('show');
}

export function hideStory(card: HTMLElement): void {
  card.classList.remove('show');
  card.replaceChildren();
}
