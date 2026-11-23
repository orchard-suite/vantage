import { describe, expect, test } from 'bun:test';
import { flagged, whoText } from './reactions.ts';
import type { BoxReactions, KindTally } from './hub.ts';

const tally = (...people: string[]): KindTally => ({ count: people.length, people: people.map((p) => ({ id: p, label: p })), mine: false });
const box = (view: string, id: string, up: string[], wrong: string[], question: string[]): BoxReactions => ({ view, box: id, orphaned: false, total: up.length + wrong.length + question.length, kinds: { up: tally(...up), wrong: tally(...wrong), question: tally(...question) } });

describe('reactions', () => {
  test('the most flagged box leads: looks wrong, then questions, then everything', () => {
    const list = [box('v', 'liked', ['A', 'B', 'C'], [], []), box('v', 'asked', [], [], ['A']), box('v', 'wrong', [], ['A'], []), box('other', 'elsewhere', [], ['A', 'B'], [])];
    expect(flagged(list, 'v').map((b) => b.box)).toEqual(['wrong', 'asked', 'liked']);
  });

  test('the hover names who reacted, one line per kind', () => {
    expect(whoText(box('v', 'b', ['One'], ['Two', 'Three'], []))).toBe('Thumbs up: One\nLooks wrong: Two, Three');
  });
});
