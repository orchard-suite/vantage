import { describe, expect, test } from 'bun:test';
import type { BundleBox } from './bundle.ts';
import { nearestBox, Picker } from './pick.ts';

const box = (id: string, x: number, y: number, w: number, h: number): BundleBox => ({ id, name: id, kind: 'leaf', x, y, w, h });
const BOXES = [box('group', 0, 0, 400, 300), box('api', 20, 40, 100, 60), box('db', 200, 40, 100, 60), box('far', 600, 0, 50, 50)];

describe('nearestBox', () => {
  test('a spot inside boxes means the innermost', () => {
    expect(nearestBox(BOXES, 50, 60)).toBe('api');
    expect(nearestBox(BOXES, 160, 200)).toBe('group');
  });

  test('a spot outside every box means the closest edge', () => {
    expect(nearestBox(BOXES, 520, 20)).toBe('far');
    expect(nearestBox(BOXES, 450, 20)).toBe('group');
    expect(nearestBox([], 0, 0)).toBeUndefined();
  });
});

describe('Picker', () => {
  test('takes clicks only while picking; a box toggles in and out', () => {
    let lit: readonly string[] | undefined;
    let changes = 0;
    const p = new Picker({ stage: () => ({ svg: undefined, view: undefined }), highlight: (ids) => (lit = ids), changed: () => changes++ });
    expect(p.box('api')).toBe(false);
    expect(p.escape()).toBe(false);
    p.toggle();
    expect(p.box('api')).toBe(true);
    expect(p.box('db')).toBe(true);
    expect(p.ids).toEqual(['api', 'db']);
    expect(lit).toEqual(['api', 'db']);
    p.box('api');
    expect(p.ids).toEqual(['db']);
    expect(p.escape()).toBe(true);
    expect(p.active).toBe(false);
    expect(p.ids).toEqual(['db']);
    p.clear();
    expect(p.ids).toEqual([]);
    expect(lit).toBeUndefined();
    expect(changes).toBe(6);
    p.peek(['db']);
    expect(lit).toEqual(['db']);
    p.peek(undefined);
    expect(lit).toBeUndefined();
  });

  test('leaves pins it did not make alone', () => {
    const calls: (readonly string[] | undefined)[] = [];
    const p = new Picker({ stage: () => ({ svg: undefined, view: undefined }), highlight: (ids) => calls.push(ids), changed: () => undefined });
    p.refresh();
    p.peek(undefined);
    expect(calls).toEqual([]);
  });
});
