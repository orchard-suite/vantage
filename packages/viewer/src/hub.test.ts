import { describe, expect, test } from 'bun:test';
import { ago } from './hub.ts';

describe('ago', () => {
  test('rounds to the nearest unit and falls back to the date', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(ago('2026-10-28T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-28T11:55:00Z', now)).toBe('5m ago');
    expect(ago('2026-10-28T09:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-10-25T12:00:00Z', now)).toBe('3d ago');
    expect(ago('2026-09-01T12:00:00Z', now)).toBe('2026-09-01');
  });
});
