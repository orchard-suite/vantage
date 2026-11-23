import { describe, expect, test } from 'bun:test';
import { EditState } from './edit-state.ts';

describe('editor bookkeeping', () => {
  test('a head from the stream is ours, the one held, or someone else\'s to load or offer', () => {
    const s = new EditState('v1', 'text');
    expect(s.dirty('text')).toBe(false);
    expect(s.arrival('v1', 'text')).toBe('current');
    expect(s.arrival('v2', 'text')).toBe('reload');
    expect(s.arrival('v2', 'changed')).toBe('offer');
    s.saved('v3', 'changed');
    expect(s.arrival('v3', 'changed')).toBe('ours');
    expect(s.dirty('changed')).toBe(false);
  });

  test('a merge not yet saved stays dirty until it is', () => {
    const s = new EditState('v1', 'text');
    s.merged('v2');
    expect(s.base).toBe('v2');
    expect(s.dirty('text')).toBe(true);
    s.loaded('v4', 'fresh');
    expect(s.dirty('fresh')).toBe(false);
  });
});
