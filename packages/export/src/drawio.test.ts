import { describe, expect, test } from 'bun:test';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { drawioModel, renderDrawio } from './drawio.ts';
import { icons, layoutsOf } from './fixture.test-helper.ts';

interface Cell {
  readonly id: string;
  readonly value?: string;
  readonly style?: string;
  readonly parent?: string;
  readonly source?: string;
  readonly target?: string;
  readonly vertex?: string;
  readonly edge?: string;
  readonly mxGeometry?: { x?: string; y?: string; width?: string; height?: string; Array?: { mxPoint: { x: string; y: string }[] | { x: string; y: string } } };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => name === 'mxCell' || name === 'diagram' || name === 'mxPoint' });

function cellsOf(model: string): Cell[] {
  const doc = parser.parse(model) as { mxGraphModel: { root: { mxCell: Cell[] } } };
  return doc.mxGraphModel.root.mxCell;
}

describe('drawio', () => {
  test('file has one diagram per view and parses', () => {
    const layouts = layoutsOf('shop', ['context', 'requests']);
    const xml = renderDrawio(layouts, { icons });
    expect(XMLValidator.validate(xml)).toBe(true);
    const doc = parser.parse(xml) as { mxfile: { diagram: { name: string; id: string }[] } };
    expect(doc.mxfile.diagram.map((d) => d.id)).toEqual(['context', 'requests']);
    expect(doc.mxfile.diagram[1]!.name).toBe(layouts[1]!.title);
  });

  test('boxes become vertices, children sit in their container with relative geometry', () => {
    const [layout] = layoutsOf('shop', ['requests']);
    const cells = cellsOf(drawioModel(layout!, { icons }));
    const byId = new Map(cells.map((c) => [c.id, c]));
    expect(byId.get('0')).toBeDefined();
    expect(byId.get('1')?.parent).toBe('0');
    const containers = layout!.boxes.filter((b) => b.kind === 'container');
    expect(containers.length).toBeGreaterThan(0);
    for (const b of layout!.boxes) {
      const cell = byId.get(`n-${b.id}`);
      expect(cell?.vertex).toBe('1');
      expect(cell?.value).toContain(b.name.lines[0]!);
      const parent = b.parentId ? layout!.boxes.find((p) => p.id === b.parentId) : undefined;
      expect(cell?.parent).toBe(parent ? `n-${parent.id}` : '1');
      expect(Number(cell?.mxGeometry?.x)).toBeCloseTo(b.x - (parent?.x ?? 0), 2);
      expect(Number(cell?.mxGeometry?.y)).toBeCloseTo(b.y - (parent?.y ?? 0), 2);
      expect(Number(cell?.mxGeometry?.width)).toBeCloseTo(b.w, 2);
      if (b.kind === 'container') expect(cell?.style).toContain('container=1');
    }
    const withIcon = layout!.boxes.find((b) => b.icon && !b.iconOnly);
    expect(withIcon).toBeDefined();
    const icon = byId.get(`i-${withIcon!.id}`);
    expect(icon?.parent).toBe(`n-${withIcon!.id}`);
    expect(icon?.style).toContain('image=data:image/svg+xml,');
    expect(icon?.style).not.toContain('currentColor');
  });

  test('edges keep waypoints, terminals, dashes, and labels', () => {
    const [layout] = layoutsOf('shop', ['requests']);
    const cells = cellsOf(drawioModel(layout!));
    const byId = new Map(cells.map((c) => [c.id, c]));
    for (const e of layout!.edges) {
      const cell = byId.get(`e-${e.id}`);
      expect(cell?.edge).toBe('1');
      expect(cell?.source).toBe(`n-${e.from}`);
      expect(cell?.target).toBe(`n-${e.to}`);
      expect(cell?.style).toContain('edgeStyle=orthogonalEdgeStyle');
      const way = e.points.slice(1, -1);
      const pts = cell?.mxGeometry?.Array?.mxPoint;
      const list = Array.isArray(pts) ? pts : pts ? [pts] : [];
      expect(list.length).toBe(way.length);
      list.forEach((p, i) => {
        expect(Number(p.x)).toBeCloseTo(way[i]!.x, 2);
        expect(Number(p.y)).toBeCloseTo(way[i]!.y, 2);
      });
      if (e.label) expect(cell?.value).toBe(e.label.lines.join('<br>'));
      if (e.kind === 'async') expect(cell?.style).toContain('dashed=1');
    }
  });

  test('story extras become notes, highlights behind leaves, and text cells', () => {
    const [layout] = layoutsOf('harbor', ['poster']);
    const extras = layout!.extras ?? [];
    const cells = cellsOf(drawioModel(layout!));
    const ids = cells.map((c) => c.id);
    for (const x of extras) {
      if (x.kind === 'note') expect(cells.find((c) => c.id === `x-${x.kind}-${x.id}`)?.style).toContain('shape=note');
      if (x.kind === 'text') expect(cells.find((c) => c.id === `x-${x.kind}-${x.id}`)?.style).toMatch(/^text;/);
      if (x.kind === 'highlight') {
        const firstLeaf = ids.findIndex((id) => id.startsWith('n-') && layout!.boxes.find((b) => `n-${b.id}` === id)?.kind !== 'container');
        expect(ids.indexOf(`x-${x.kind}-${x.id}`)).toBeLessThan(firstLeaf);
      }
    }
    expect(extras.some((x) => x.kind === 'text' || x.kind === 'note' || x.kind === 'highlight')).toBe(true);
  });
});
