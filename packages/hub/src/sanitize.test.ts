import { describe, expect, test } from 'bun:test';
import { sanitizeBundle, sanitizeMarkdown } from './sanitize.ts';

describe('sanitize', () => {
  test('drops scripts, event handlers, and unsafe schemes but keeps inline tags', () => {
    expect(sanitizeMarkdown('hi <script>alert(1)</script> there')).toBe('hi  there');
    expect(sanitizeMarkdown('<b onclick="x()">bold</b>')).toBe('<b>bold</b>');
    expect(sanitizeMarkdown('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeMarkdown('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com" rel="noopener noreferrer">x</a>');
    expect(sanitizeMarkdown('[x](javascript:alert(1))')).toBe('[x](#)');
    expect(sanitizeMarkdown('<img src=x onerror=alert(1)>plain **md**')).toBe('plain **md**');
  });

  test('sanitizes only markdown fields across a bundle', () => {
    const b = sanitizeBundle({ title: '<script>t</script>', views: [{ notes: '<i>n</i><script>x</script>', boxes: [{ description: '<svg onload=1>d' }] }] });
    expect(b.title).toBe('<script>t</script>');
    expect(b.views[0]!.notes).toBe('<i>n</i>');
    expect(b.views[0]!.boxes[0]!.description).toBe('d');
  });
});
