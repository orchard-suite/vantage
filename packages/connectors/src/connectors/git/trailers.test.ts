import { describe, expect, test } from 'bun:test';
import { workTrailers } from './trailers.ts';

describe('Work trailers', () => {
  test('reads one key per trailer from the last paragraph, once each, in order', () => {
    expect(workTrailers('feat(shop): cache prices\n\nWhy it matters.\n\nWork: SW-12\nSigned-off-by: a user <user@example.com>\nwork: PLAN-3\nWork: SW-12\n')).toEqual({ keys: ['SW-12', 'PLAN-3'], bad: [] });
  });

  test('a one-paragraph message has none, and a Work line above the last paragraph is body text', () => {
    expect(workTrailers('Work: SW-12')).toEqual({ keys: [], bad: [] });
    expect(workTrailers('feat: x\n\nWork: SW-12\n\nmore body')).toEqual({ keys: [], bad: [] });
  });

  test('a value that is not one item key is kept apart, never guessed', () => {
    expect(workTrailers('fix: y\n\nWork: sw-12\nWork: SW-12, SW-13\nWork: SW-14')).toEqual({ keys: ['SW-14'], bad: ['sw-12', 'SW-12, SW-13'] });
  });

  test('reads CRLF messages', () => {
    expect(workTrailers('fix: y\r\n\r\nWork: SW-9\r\n').keys).toEqual(['SW-9']);
  });
});
