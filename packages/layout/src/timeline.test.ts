import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { layoutView } from './layout.ts';
import type { Layout, LayoutBox } from './types.ts';

// A roadmap with one-day bars, a shared successor, and arrows across lanes.
const doc = `
views:
  - id: roadmap
    kind: timeline
    title: Roadmap
    lanes: [Operator, Tools, Partner]
    items:
      - { id: done, text: Plugin ships (T-25), lane: Tools, start: 2026-11-18 }
      - { id: layout, text: The home folder follows the new layout (T-27), lane: Operator, start: 2026-11-19, end: 2026-11-20 }
      - { id: sync, text: Personal sync (T-308), lane: Operator, start: 2026-11-20, end: 2026-11-21 }
      - { id: sched, text: Schedules move (T-29), lane: Operator, start: 2026-11-20, end: 2026-11-21 }
      - { id: retire, text: Old extension retires (T-30), lane: Operator, start: 2026-11-23 }
      - { id: mail, text: Mail plugin (T-32), lane: Tools, start: 2026-11-24, end: 2026-12-02 }
      - { id: test, text: Partner connection test (P-233), lane: Partner, start: 2026-11-23 }
      - { id: records, text: Records service (P-234), lane: Partner, start: 2026-12-03, end: 2026-12-23 }
      - { id: pkg, text: Package (T-34), lane: Partner, start: 2026-12-28 }
      - { id: pilot, text: Pilot (T-35), lane: Partner, start: 2027-01-04, end: 2027-01-15 }
    dependencies:
      - { from: done, to: layout }
      - { from: layout, to: sched }
      - { from: sched, to: retire }
      - { from: sync, to: retire }
      - { from: done, to: mail }
      - { from: test, to: records }
      - { from: records, to: pkg }
      - { from: pkg, to: pilot }
`;

function roadmap(): Layout {
  const { model } = loadModelFromText(doc);
  if (!model) throw new Error('the fixture does not load');
  return layoutView(model, model.views.find((v) => v.id === 'roadmap')!);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function labelRect(b: LayoutBox): Rect | undefined {
  const n = b.name;
  if (!n || n.anchor !== 'start') return undefined;
  const width = Math.max(...n.lines.map((l) => l.length)) * n.size * 0.5;
  return { x: b.x + n.x, y: b.y + n.y, w: width, h: n.lines.length * n.lineHeight };
}

function crosses(points: readonly { x: number; y: number }[], r: Rect): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (Math.max(a.x, b.x) > r.x + 1 && Math.min(a.x, b.x) < r.x + r.w - 1 && Math.max(a.y, b.y) > r.y + 1 && Math.min(a.y, b.y) < r.y + r.h - 1) return true;
  }
  return false;
}

describe('timeline layout', () => {
  test('every item has a row of its own', () => {
    const l = roadmap();
    const tops = l.boxes.map((b) => Math.round(b.y + b.h / 2));
    expect(new Set(tops).size).toBe(l.boxes.length);
  });

  test('no arrow runs through a label or another item', () => {
    const l = roadmap();
    for (const e of l.edges) {
      for (const b of l.boxes) {
        const label = labelRect(b);
        if (label) expect({ edge: e.id, label: b.id, crosses: crosses(e.points, label) }).toEqual({ edge: e.id, label: b.id, crosses: false });
        if (b.id !== e.from && b.id !== e.to) expect({ edge: e.id, box: b.id, crosses: crosses(e.points, b) }).toEqual({ edge: e.id, box: b.id, crosses: false });
      }
    }
  });

  test('every dependency is drawn and ends on its item', () => {
    const l = roadmap();
    expect(l.edges).toHaveLength(8);
    for (const e of l.edges) {
      const to = l.boxes.find((b) => b.id === e.to)!;
      const end = e.points.at(-1)!;
      expect(end.x).toBeGreaterThanOrEqual(to.x - 0.5);
      expect(end.x).toBeLessThanOrEqual(to.x + to.w + 0.5);
      expect(end.y).toBeGreaterThanOrEqual(to.y - 0.5);
      expect(end.y).toBeLessThanOrEqual(to.y + to.h + 0.5);
    }
  });

  test('labels are whole, never cut short', () => {
    for (const b of roadmap().boxes) expect(b.name?.lines.join(' ')).toBe(b.node.name);
  });

  test('a span of weeks gets a tick each Monday', () => {
    const ticks = (roadmap().extras ?? []).flatMap((x) => (x.kind === 'text' && x.id.startsWith('tick-label-') ? [x.id] : []));
    expect(ticks.map((id) => id.replace('tick-label-', '')).slice(0, 3)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']);
  });
});
