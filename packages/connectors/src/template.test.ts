import { describe, expect, test } from 'bun:test';
import { getPath, placeholders, render, renderStrict, splitPath } from './template.ts';

describe('template', () => {
  const ctx = { id: 'a', runtime: { language: 'go', tags: ['x', 'y'] }, items: [{ n: 1 }, { n: 2 }], zero: 0, empty: '', flag: false };

  test('paths', () => {
    expect(splitPath('a.b[0].c')).toEqual(['a', 'b', '0', 'c']);
    expect(splitPath('$.a')).toEqual(['a']);
    expect(getPath(ctx, 'runtime.language')).toBe('go');
    expect(getPath(ctx, 'items[1].n')).toBe(2);
    expect(getPath(ctx, 'runtime.tags.0')).toBe('x');
    expect(getPath(ctx, 'runtime.nope.deeper')).toBeUndefined();
    expect(getPath(ctx, 'id.length')).toBeUndefined();
  });

  test('double and single brace placeholders', () => {
    expect(render('svc:{{id}}/{{ runtime.language }}', ctx)).toEqual({ text: 'svc:a/go', missing: [] });
    expect(render('azure:rg:{id}/{runtime.language}', ctx).text).toBe('azure:rg:a/go');
    expect(render('{"json": 1} {{id}}', ctx).text).toBe('{"json": 1} a');
    expect(placeholders('{{a}} and {b} and {{ secret:x }}')).toEqual(['a', 'b', 'secret:x']);
  });

  test('missing, falsy, and structured values', () => {
    expect(render('{{zero}}|{{flag}}|{{empty}}|{{nope}}', ctx)).toEqual({ text: '0|false||', missing: ['empty', 'nope'] });
    expect(render('{{runtime}}', ctx).text).toBe('{"language":"go","tags":["x","y"]}');
    expect(renderStrict('x:{{id}}', ctx)).toBe('x:a');
    expect(renderStrict('x:{{nope}}', ctx)).toBeUndefined();
  });
});
