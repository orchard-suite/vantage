import { describe, expect, test } from 'bun:test';
import { childElements, decodeEntities, parseXml, textOf } from './xml.ts';

describe('xml walker', () => {
  test('elements, attributes, entities, cdata, comments, mixed content', () => {
    const root = parseXml(`<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y='q"'><b/>text &lt;here&gt;<![CDATA[<raw>]]><c z="&#65;&#x42;">in</c></a>`);
    expect(root.name).toBe('a');
    expect(root.attrs).toEqual({ x: '1 & 2', y: 'q"' });
    expect(childElements(root).map((e) => e.name)).toEqual(['b', 'c']);
    expect(textOf(root)).toBe('text <here><raw>in');
    expect(childElements(root, 'c')[0]!.attrs['z']).toBe('AB');
  });

  test('attribute values may hold a closing angle bracket', () => {
    const root = parseXml(`<a value="x &gt; y" style="a=b;c=>d"><b/></a>`);
    expect(root.attrs['style']).toBe('a=b;c=>d');
    expect(childElements(root)).toHaveLength(1);
  });

  test('malformed input throws', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/unexpected/);
    expect(() => parseXml('<a>')).toThrow(/unclosed/);
    expect(decodeEntities('&nbsp;&unknown;')).toBe('\u00a0&unknown;');
  });
});
