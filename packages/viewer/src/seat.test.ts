import { describe, expect, test } from 'bun:test';
import { initials, makeSeat, PEER_COLORS, peerColor, samePlace, sameSeat } from './seat.ts';

describe('seats', () => {
  test('a seat leaves out what is empty and rounds the camera, so equal seats compare equal', () => {
    const a = makeSeat({ view: 'orders', open: undefined, step: { path: 0, step: -1 }, groups: undefined, cam: { x: 1.04, y: 2.96, w: 300.01, h: 200 }, presenting: false });
    expect(a).toEqual({ view: 'orders', step: { path: 0, step: -1 }, cam: { x: 1, y: 3, w: 300, h: 200 } });
    const b = makeSeat({ view: 'orders', open: undefined, step: { path: 0, step: -1 }, groups: undefined, cam: { x: 1.01, y: 3.01, w: 300, h: 200 }, presenting: false });
    expect(sameSeat(a, b)).toBe(true);
    expect(makeSeat({ view: undefined, open: undefined, step: undefined, groups: undefined, cam: undefined, presenting: false })).toEqual({});
  });

  test('the place is everything but the camera', () => {
    expect(samePlace({ view: 'a', cam: { x: 0, y: 0, w: 1, h: 1 } }, { view: 'a', cam: { x: 9, y: 0, w: 1, h: 1 } })).toBe(true);
    expect(samePlace({ view: 'a' }, { view: 'a', step: { walk: 1 } })).toBe(false);
    expect(sameSeat({ view: 'a', cam: { x: 0, y: 0, w: 1, h: 1 } }, { view: 'a', cam: { x: 9, y: 0, w: 1, h: 1 } })).toBe(false);
  });

  test('initials and colors', () => {
    expect(initials('Ana Lopez')).toBe('AL');
    expect(initials('ana')).toBe('A');
    expect(initials('first.middle.last')).toBe('FL');
    expect(initials('  ')).toBe('·');
    expect(PEER_COLORS).toContain(peerColor('abc'));
    expect(peerColor('abc')).toBe(peerColor('abc'));
  });
});
