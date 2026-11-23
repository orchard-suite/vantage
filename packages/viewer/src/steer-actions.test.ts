import { describe, expect, test } from 'bun:test';
import { arrange, bind, childrenOf, collapse, expand, hide, moveInOrder, note, question, reorder, ROOT } from './steer-actions.ts';
import type { BundleBox, BundlePicture } from './bundle.ts';

const box = (id: string, x: number, y: number, parentId?: string): BundleBox => ({ id, name: id, kind: 'leaf', x, y, w: 100, h: 40, ...(parentId !== undefined ? { parentId } : {}) });
const pic: BundlePicture = {
  svg: '',
  width: 500,
  height: 300,
  edges: [],
  boxes: [{ ...box('apps', 0, 0), kind: 'container' }, box('web', 200, 110, 'apps'), box('api', 20, 100, 'apps'), box('db', 20, 200, 'apps'), box('users', 300, 0)],
};

describe('steer action builders', () => {
  test('childrenOf lists a container in reading order and ROOT lists the top level', () => {
    expect(childrenOf(pic, 'apps').map((b) => b.id)).toEqual(['api', 'web', 'db']);
    expect(childrenOf(pic, ROOT).map((b) => b.id)).toEqual(['apps', 'users']);
  });

  test('moveInOrder shifts one id and clamps at the ends', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a']);
    expect(moveInOrder(['a', 'b'], 'zz', 1)).toEqual(['a', 'b']);
  });

  test('builders name the view and node and drop what was not picked', () => {
    expect(reorder('v', 'apps', ['b', 'a'])).toEqual({ kind: 'order', view: 'v', node: 'apps', order: ['b', 'a'] });
    expect(collapse('v', 'apps')).toEqual({ kind: 'collapse', view: 'v', node: 'apps', on: true });
    expect(expand('v', 'apps', false)).toEqual({ kind: 'expand', view: 'v', node: 'apps', on: false });
    expect(hide('v', 'db')).toEqual({ kind: 'hide', view: 'v', node: 'db' });
    expect(arrange('v', 'root', { as: 'grid', direction: '' })).toEqual({ kind: 'arrange', view: 'v', node: 'root', as: 'grid' });
    expect(arrange('v', 'root', { as: '', direction: 'down' })).toEqual({ kind: 'arrange', view: 'v', node: 'root', direction: 'down' });
    expect(arrange('v', 'root', { as: '', direction: '' })).toBeUndefined();
    expect(note('v', '  Entry point. ', 'web')).toEqual({ kind: 'note', view: 'v', text: 'Entry point.', at: 'web' });
    expect(note('v', 'Under the view')).toEqual({ kind: 'note', view: 'v', text: 'Under the view' });
    expect(note('v', '   ')).toBeUndefined();
    expect(question('v', ' Who buys? ')).toEqual({ kind: 'question', view: 'v', text: 'Who buys?' });
    expect(question('v', '')).toEqual({ kind: 'question', view: 'v', text: '' });
    expect(bind('web', ' orrery:app-1 ')).toEqual({ kind: 'bind', node: 'web', bind: 'orrery:app-1' });
  });
});
