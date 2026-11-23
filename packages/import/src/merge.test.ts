import { describe, expect, test } from 'bun:test';
import { mergePages } from './merge.ts';

describe('merging pages', () => {
  test('the same box on two pages is one node with both pins; a page never merges with itself', () => {
    const merged = mergePages([
      {
        nodes: [{ id: 'zone', name: 'Zone', children: [{ id: 'web', name: 'Web' }] }, { id: 'users', name: 'Users' }, { id: 'users-2', name: 'Users' }],
        relations: [{ from: 'users', to: 'web', tags: ['a'], label: 'uses' }],
        view: { id: 'a', title: 'A', include: { tags: ['a'], nodes: ['zone', 'web', 'users', 'users-2'] }, pins: { nodes: { zone: { x: 0, y: 0, w: 300, h: 200 }, web: { x: 20, y: 40, w: 100, h: 50 }, users: { x: 400, y: 0, w: 100, h: 50 }, 'users-2': { x: 400, y: 100, w: 100, h: 50 } } } },
      },
      {
        nodes: [{ id: 'zone-2', name: 'Zone', children: [{ id: 'web-2', name: 'Web', facts: ['Plan: P1'] }, { id: 'db', name: 'DB' }] }, { id: 'users-3', name: 'Users' }],
        relations: [{ from: 'users-3', to: 'web-2', tags: ['b'], label: 'uses' }, { from: 'web-2', to: 'db', tags: ['b'] }],
        view: { id: 'b', title: 'B', include: { tags: ['b'], nodes: ['zone-2', 'web-2', 'db', 'users-3'] }, arrange: [{ node: 'zone-2', as: 'row' }], pins: { nodes: { 'zone-2': { x: 0, y: 0, w: 300, h: 200 }, 'web-2': { x: 20, y: 40, w: 100, h: 50 }, db: { x: 160, y: 40, w: 100, h: 50 }, 'users-3': { x: 400, y: 0, w: 100, h: 50 } }, edges: { 'web-2>db': [{ x: 120, y: 65 }, { x: 160, y: 65 }] } } },
      },
    ]);
    expect(merged.nodes.map((n) => n.id)).toEqual(['zone', 'users', 'users-2']);
    const zone = merged.nodes[0]!;
    expect(zone.children?.map((c) => c.id)).toEqual(['web', 'db']);
    expect(zone.children?.[0]?.facts).toEqual(['Plan: P1']);
    expect(merged.relations).toHaveLength(2);
    expect(merged.relations[0]).toEqual({ from: 'users', to: 'web', tags: ['a', 'b'], label: 'uses' });
    const b = merged.views[1]!;
    expect(b.include?.nodes).toEqual(['zone', 'web', 'db', 'users']);
    expect(b.arrange).toEqual([{ node: 'zone', as: 'row' }]);
    expect(Object.keys(b.pins!.nodes ?? {})).toEqual(['zone', 'web', 'db', 'users']);
    expect(Object.keys(b.pins!.edges!)).toEqual(['web>db']);
    expect(merged.notes).toEqual(['zone: on 2 pages (a, b), kept once', 'web: on 2 pages (a, b), kept once', 'users: on 2 pages (a, b), kept once']);
  });
});
