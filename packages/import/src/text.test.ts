import { describe, expect, test } from 'bun:test';
import { htmlToLines, isShortLabel, partsOf } from './text.ts';

describe('label text', () => {
  test('html labels become lines', () => {
    expect(htmlToLines('<div>Orders<br>Service</div><div>Plan: P1</div>')).toEqual(['Orders', 'Service', 'Plan: P1']);
    expect(htmlToLines('<ul><li>one</li><li>two</li></ul>')).toEqual(['• one', '• two']);
    expect(htmlToLines('A &amp; B&nbsp;')).toEqual(['A & B']);
    expect(htmlToLines('<font color="#000" style="font-size:13px">Storefront<br>Web</font><br><font color="#666">App Service</font>')).toEqual(['Storefront Web', 'App Service']);
  });

  test('first line names, a short second line is the subtitle, then facts, bullets, prose', () => {
    const p = partsOf(['Storefront API', 'App Service, ASP.NET', 'Plan: P1v3', '• Blue green', '- Canary', 'Handles all public traffic for the shop.']);
    expect(p.name).toBe('Storefront API');
    expect(p.subtitle).toBe('App Service, ASP.NET');
    expect(p.facts).toEqual(['Plan: P1v3']);
    expect(p.bullets).toEqual(['Blue green', 'Canary']);
    expect(p.description).toBe('Handles all public traffic for the shop.');
  });

  test('a long second line is prose, not a subtitle; a URL is not a fact', () => {
    const p = partsOf(['Gateway', 'This gateway terminates TLS and forwards requests to the backend pool.', 'https://example.com']);
    expect(p.subtitle).toBeUndefined();
    expect(p.facts).toEqual([]);
    expect(p.description).toContain('terminates TLS');
    expect(isShortLabel(['Public'])).toBe(true);
    expect(isShortLabel(['A sentence that goes on for a while.'])).toBe(false);
  });
});
