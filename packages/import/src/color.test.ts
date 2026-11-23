import { describe, expect, test } from 'bun:test';
import { isNeutral, matchFamily, toHsl } from './color.ts';

describe('palette matching', () => {
  test('hues land on the nearest family', () => {
    expect(matchFamily('#dae8fc')).toEqual({ family: 'blue' });
    expect(matchFamily('#f8cecc')).toEqual({ family: 'red' });
    expect(matchFamily('#fff2cc')).toEqual({ family: 'amber' });
    expect(matchFamily('#e1d5e7')).toEqual({ family: 'violet' });
  });

  test('a far hue keeps its hex beside the family', () => {
    expect(matchFamily('#d5e8d4')).toEqual({ family: 'emerald', exact: '#d5e8d4' });
    expect(matchFamily('#00ff00')).toEqual({ family: 'emerald', exact: '#00ff00' });
  });

  test('greys are slate, white and black are nothing', () => {
    expect(matchFamily('#f5f5f5')).toEqual({ family: 'slate' });
    expect(matchFamily('#333333')).toEqual({ family: 'slate', exact: '#333333' });
    expect(matchFamily('#ffffff')).toBeUndefined();
    expect(isNeutral('none')).toBe(true);
    expect(isNeutral('#000')).toBe(true);
    expect(toHsl('zzz')).toBeUndefined();
  });
});
