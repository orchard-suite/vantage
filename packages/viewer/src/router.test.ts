import { describe, expect, test } from 'bun:test';
import { formatRoute, parseRoute } from './router.ts';

describe('router', () => {
  test('parses view, node, and open container', () => {
    expect(parseRoute('#subscriptions')).toEqual({ view: 'subscriptions' });
    expect(parseRoute('#subscriptions/prod-sub')).toEqual({ view: 'subscriptions', node: 'prod-sub' });
    expect(parseRoute('#subscriptions/prod-sub?open=rg-prod-web')).toEqual({ view: 'subscriptions', node: 'prod-sub', open: 'rg-prod-web' });
    expect(parseRoute('#subscriptions?open=rg-prod-web')).toEqual({ view: 'subscriptions', open: 'rg-prod-web' });
    expect(parseRoute('')).toEqual({});
  });

  test('round trips encoded ids', () => {
    const r = { view: 'a view', node: 'x/y', open: 'c&d' };
    expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(formatRoute({})).toBe('#');
    expect(formatRoute({ view: 'v' })).toBe('#v');
  });
});
