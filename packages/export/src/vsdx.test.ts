import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { renderVsdx, vsdxPage } from './vsdx.ts';
import { layoutsOf } from './fixture.test-helper.ts';

interface Cell { readonly N: string; readonly V: string }
interface Shape { readonly ID: string; readonly Cell: Cell[]; readonly Text?: unknown; readonly Section?: { N: string }[] }

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => ['Shape', 'Cell', 'Connect', 'Page', 'Section', 'Override', 'Relationship'].includes(name) });
const cellV = (s: Shape, n: string): number => Number(s.Cell.find((c) => c.N === n)?.V);

describe('vsdx', () => {
  test('package has the required parts, one page per view', () => {
    const layouts = layoutsOf('shop', ['context', 'requests']);
    const files = unzipSync(renderVsdx(layouts, { title: 'Shop' }));
    const names = Object.keys(files).sort();
    expect(names).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
      'visio/_rels/document.xml.rels', 'visio/document.xml', 'visio/pages/_rels/pages.xml.rels',
      'visio/pages/page1.xml', 'visio/pages/page2.xml', 'visio/pages/pages.xml',
    ]);
    for (const name of names) expect(XMLValidator.validate(strFromU8(files[name]!))).toBe(true);
    const types = parser.parse(strFromU8(files['[Content_Types].xml']!)) as { Types: { Override: { PartName: string }[] } };
    expect(types.Types.Override.map((o) => o.PartName)).toContain('/visio/pages/page2.xml');
    const pages = parser.parse(strFromU8(files['visio/pages/pages.xml']!)) as { Pages: { Page: { Name: string; Rel: { 'r:id': string } }[] } };
    expect(pages.Pages.Page.map((p) => p.Name)).toEqual(layouts.map((l) => l.title));
    expect(pages.Pages.Page[1]!.Rel['r:id']).toBe('rId2');
    expect(strFromU8(files['docProps/core.xml']!)).toContain('<dc:title>Shop</dc:title>');
  });

  test('shapes carry flipped inch geometry, text, colors, and connectors glue to boxes', () => {
    const [layout] = layoutsOf('shop', ['requests']);
    const xml = vsdxPage(layout!).xml;
    const doc = parser.parse(xml) as { PageContents: { Shapes: { Shape: Shape[] }; Connects: { Connect: { FromSheet: string; ToSheet: string; FromCell: string }[] } } };
    const shapes = doc.PageContents.Shapes.Shape;
    expect(shapes.length).toBe(layout!.boxes.length + layout!.edges.length + (layout!.extras?.length ?? 0));
    const first = layout!.boxes.find((b) => b.kind !== 'container')!;
    const shape = shapes.find((s) => cellV(s, 'Width') === Math.round((first.w / 96) * 10000) / 10000 && Math.abs(cellV(s, 'PinX') - (first.x + first.w / 2) / 96) < 0.001)!;
    expect(shape).toBeDefined();
    expect(cellV(shape, 'PinY')).toBeCloseTo((layout!.height - first.y - first.h / 2) / 96, 3);
    expect(xml).toContain(`<Text><cp IX="0"/>${first.name.lines[0]!}`);
    expect(shape.Cell.find((c) => c.N === 'FillForegnd')?.V).toMatch(/^#[0-9a-f]{6}$/);
    expect(shape.Cell.find((c) => c.N === 'LineColor')?.V).toMatch(/^#[0-9a-f]{6}$/);
    const containerIndex = shapes.findIndex((s) => s.Section?.some((x) => x.N === 'Geometry') && cellV(s, 'Rounding') > 0.1);
    expect(containerIndex).toBeGreaterThanOrEqual(0);
    const connectors = shapes.filter((s) => s.Cell.some((c) => c.N === 'BeginX'));
    expect(connectors.length).toBe(layout!.edges.length);
    const edge = layout!.edges.find((e) => e.points.length > 2)!;
    const conn = connectors[layout!.edges.indexOf(edge)]!;
    expect(cellV(conn, 'BeginX')).toBeCloseTo(edge.points[0]!.x / 96, 3);
    expect(cellV(conn, 'EndY')).toBeCloseTo((layout!.height - edge.points[edge.points.length - 1]!.y) / 96, 3);
    expect(conn.Section?.length).toBeGreaterThan(0);
    expect(doc.PageContents.Connects.Connect.length).toBe(layout!.edges.length * 2);
    expect(doc.PageContents.Connects.Connect.every((c) => c.FromCell === 'BeginX' || c.FromCell === 'EndX')).toBe(true);
  });
});
