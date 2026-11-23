import { describe, expect, test } from 'bun:test';
import { applySteer } from './steer.ts';

const YAML = `title: Sample # the title
nodes:
  - name: Shoppers
    type: users
  - id: apps
    name: Apps
    children:
      - name: Web App   # next.js
        type: web
      - name: Orders API
        type: api
relations:
  - { from: shoppers, to: web-app, label: buys }
views:
  # the overview
  - id: context
    title: Context
    include: { tags: [context] }
    collapse: [apps]
`;

describe('steer edits', () => {
  test('order writes arrange.order and keeps comments', () => {
    const r = applySteer(YAML, { kind: 'order', view: 'context', node: 'apps', order: ['orders-api', 'web-app'] });
    expect(r.message).toBe('steer: reorder apps');
    expect(r.yaml).toContain('# the title');
    expect(r.yaml).toContain('# next.js');
    expect(r.yaml).toContain('# the overview');
    expect(r.yaml).toContain('arrange:');
    expect(r.yaml).toContain('order: [ orders-api, web-app ]');
    expect(r.yaml.split('views:')[0]).toBe(YAML.split('views:')[0]);
    const again = applySteer(r.yaml, { kind: 'order', view: 'context', node: 'apps', order: ['web-app', 'orders-api'] });
    expect(again.yaml.match(/node: apps/g)?.length).toBe(1);
  });

  test('collapse off removes the entry and drops the empty list; expand on moves it', () => {
    const off = applySteer(YAML, { kind: 'collapse', view: 'context', node: 'apps', on: false });
    expect(off.yaml).not.toContain('collapse');
    expect(off.message).toBe('steer: open apps');
    const on = applySteer(YAML, { kind: 'expand', view: 'context', node: 'apps', on: true });
    expect(on.yaml).toContain('expand: [ apps ]');
    expect(on.yaml).not.toContain('collapse');
  });

  test('hide, arrange, note, question, and bind each change one thing', () => {
    expect(applySteer(YAML, { kind: 'hide', view: 'context', node: 'shoppers' }).yaml).toContain('hide: [ shoppers ]');
    const a = applySteer(YAML, { kind: 'arrange', view: 'context', node: 'root', as: 'grid', direction: 'down' });
    expect(a.yaml).toContain('as: grid');
    expect(a.yaml).toContain('direction: down');
    expect(a.message).toBe('steer: arrange root as grid, direction down');
    const n = applySteer(YAML, { kind: 'note', view: 'context', text: 'Only entry point.', at: 'web-app' });
    expect(n.yaml).toContain('{ text: Only entry point., at: web-app }');
    const q = applySteer(YAML, { kind: 'question', view: 'context', text: 'Who buys?' });
    expect(q.yaml).toContain('question: Who buys?');
    const b = applySteer(YAML, { kind: 'bind', node: 'web-app', bind: 'orrery:app-1' });
    expect(b.yaml).toContain('bind: orrery:app-1');
    expect(b.yaml).toContain('# next.js');
    expect(b.yaml.split('relations:')[1]).toBe(YAML.split('relations:')[1]);
    expect(applySteer(b.yaml, { kind: 'bind', node: 'web-app', bind: '' }).yaml).not.toContain('bind:');
  });

  test('unknown view or node is a 400', () => {
    expect(() => applySteer(YAML, { kind: 'hide', view: 'nope', node: 'shoppers' })).toThrow('view nope not found');
    expect(() => applySteer(YAML, { kind: 'bind', node: 'nope', bind: 'x' })).toThrow('node nope not found');
    expect(() => applySteer(YAML, { kind: 'arrange', view: 'context', node: 'root' })).toThrow('arrange needs as or direction');
  });
});
