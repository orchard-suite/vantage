import { describe, expect, test } from 'bun:test';
import type { BundleView } from './bundle.ts';
import { clock, pickType, positionAt, resolveEntry, seekFor, stepBoxes, type TimelineEntry } from './recording.ts';

const view = (v: Partial<BundleView>): BundleView => ({ id: 'v', kind: 'relation', title: 'V', boxes: [], edges: [], width: 1, height: 1, svg: '', ...v }) as BundleView;

const tour = view({ id: 'tour', kind: 'walkthrough', steps: [{ title: 'A', highlight: ['a'] }, { title: 'B', highlight: ['b'], focus: 'c' }, { title: 'Words' }] });
const paths = view({
  paths: [
    { id: 'p', color: 'blue', steps: [{ from: 'a', to: 'b', badge: '1' }, { from: 'b', to: 'c', badge: '2' }] },
    { id: 'q', color: 'red', steps: [{ from: 'c', to: 'd', badge: '1' }] },
  ] as unknown as NonNullable<BundleView['paths']>,
});
const e = (at: number, path: number, step: number, boxes: string[]): TimelineEntry => ({ at, path, step, boxes });

describe('voice walkthrough timeline', () => {
  test('a step lights its highlight and focus, or the two ends of its arrow', () => {
    expect(stepBoxes(tour, { path: 0, step: 1 })).toEqual(['b', 'c']);
    expect(stepBoxes(tour, { path: 0, step: 9 })).toBeUndefined();
    expect(stepBoxes(paths, { path: 1, step: 0 })).toEqual(['c', 'd']);
    expect(stepBoxes(paths, { path: 0, step: -1 })).toEqual([]);
    expect(stepBoxes(paths, { path: 2, step: 0 })).toBeUndefined();
  });

  test('a recorded step lands where its boxes are now, or is skipped when they vanished', () => {
    const drawn = new Set(['a', 'b', 'c', 'd']);
    expect(resolveEntry(e(0, 0, 1, ['b', 'c']), paths, drawn)).toEqual({ path: 0, step: 1 });
    // The steps were reordered since: the boxes find the step.
    expect(resolveEntry(e(0, 0, 0, ['c', 'd']), paths, drawn)).toEqual({ path: 1, step: 0 });
    // The step changed but one of its boxes is still drawn: keep the place.
    expect(resolveEntry(e(0, 0, 0, ['a', 'x']), paths, drawn)).toEqual({ path: 0, step: 0 });
    // Every box it lit is gone: skip it.
    expect(resolveEntry(e(0, 0, 0, ['x', 'y']), paths, drawn)).toBeUndefined();
    // The step itself is gone.
    expect(resolveEntry(e(0, 0, 5, ['a', 'b']), paths, drawn)).toEqual({ path: 0, step: 0 });
    expect(resolveEntry(e(0, 0, 5, ['x', 'y']), paths, drawn)).toBeUndefined();
    expect(resolveEntry(e(0, 1, -1, []), paths, drawn)).toEqual({ path: 1, step: -1 });
    expect(resolveEntry(e(0, 0, 2, []), tour, drawn)).toEqual({ path: 0, step: 2 });
  });

  test('the audio shows the latest step that lands, and a picked step seeks to its nearest moment', () => {
    const timeline = [e(0, 0, 0, []), e(1000, 0, 1, []), e(2000, 0, 0, []), e(3000, 0, 1, [])];
    const resolved = [{ path: 0, step: 0 }, undefined, { path: 0, step: 0 }, { path: 0, step: 1 }];
    expect(positionAt(timeline, resolved, 1500)).toEqual({ path: 0, step: 0 });
    expect(positionAt(timeline, resolved, 3500)).toEqual({ path: 0, step: 1 });
    expect(seekFor(timeline, resolved, { path: 0, step: 0 }, 2600)).toBe(2000);
    expect(seekFor(timeline, resolved, { path: 0, step: 0 }, 400)).toBe(0);
    expect(seekFor(timeline, resolved, { path: 0, step: 7 }, 400)).toBeUndefined();
  });

  test('picks the first type the browser records in, and reads lengths as m:ss', () => {
    expect(pickType((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickType(() => false)).toBeUndefined();
    expect(clock(0)).toBe('0:00');
    expect(clock(65_400)).toBe('1:05');
  });
});
