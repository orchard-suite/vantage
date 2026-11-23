import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { loadModelFromText, type NodeInput } from '@vantage/model';
import { importDiagram } from './index.ts';
import { expectPinsHonoured } from './pins.test-helper.ts';

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const factLines = (n: NodeInput): string[] => (n.facts ?? []).map((f) => (typeof f === 'string' ? f : `${f.label}: ${f.value}`));
const ends = (r: { from: string | string[]; to: string | string[] }): string => `${String(r.from)}>${String(r.to)}`;

function cell(n: string, v: string | number): string {
  return `<Cell N="${n}" V="${v}"/>`;
}

/** A 2-D shape at a pin in inches with a width and height, a fill, a stroke, and text. */
function box(id: number, pinX: number, pinY: number, w: number, h: number, text: string, fill = '#dae8fc', stroke = '#6c8ebf', extra = ''): string {
  return `<Shape ID="${id}" Type="Shape" NameU="Rectangle.${id}">${cell('PinX', pinX)}${cell('PinY', pinY)}${cell('Width', w)}${cell('Height', h)}${cell('LocPinX', w / 2)}${cell('LocPinY', h / 2)}${cell('FillForegnd', fill)}${cell('FillPattern', 1)}${cell('LineColor', stroke)}${cell('LinePattern', 1)}${extra}<Text>${text}</Text></Shape>`;
}

function line(id: number, b: [number, number], e: [number, number], text = '', pattern = 1, beginArrow = 0, endArrow = 4): string {
  return `<Shape ID="${id}" Type="Shape" NameU="Dynamic connector.${id}">${cell('BeginX', b[0])}${cell('BeginY', b[1])}${cell('EndX', e[0])}${cell('EndY', e[1])}${cell('PinX', (b[0] + e[0]) / 2)}${cell('PinY', (b[1] + e[1]) / 2)}${cell('Width', 1)}${cell('Height', 0)}${cell('LinePattern', pattern)}${cell('BeginArrow', beginArrow)}${cell('EndArrow', endArrow)}${text ? `<Text>${text}</Text>` : ''}</Shape>`;
}

function vsdx(pageXml: string, pageH = 8.5): Uint8Array {
  const pages = `<?xml version="1.0" encoding="utf-8"?><Pages xmlns="${NS}" xmlns:r="${REL}"><Page ID="0" NameU="Flow" Name="Flow"><PageSheet>${cell('PageWidth', 11)}${cell('PageHeight', pageH)}</PageSheet><Rel r:id="rId1"/></Page></Pages>`;
  const rels = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="page1.xml"/></Relationships>`;
  const masters = `<?xml version="1.0" encoding="utf-8"?><Masters xmlns="${NS}"><Master ID="7" NameU="Database"/><Master ID="8" NameU="Decision"/></Masters>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'visio/pages/pages.xml': strToU8(pages),
    'visio/pages/_rels/pages.xml.rels': strToU8(rels),
    'visio/masters/masters.xml': strToU8(masters),
    'visio/pages/page1.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?><PageContents xmlns="${NS}" xmlns:r="${REL}">${pageXml}</PageContents>`),
  };
  return zipSync(files);
}

describe('vsdx import', () => {
  test('shapes in inches become pixel pins with y flipped; text, colors, connectors, glue', () => {
    const page = `<Shapes>
      ${box(1, 2, 6.5, 2, 1, 'Web App\nASP.NET\nPlan: P1v3')}
      ${box(2, 6, 6.5, 2, 1, 'Orders DB', '#e1d5e7', '#9673a6', '<Cell N="Master" V="7"/>')}
      ${box(3, 6, 3, 1.5, 1, 'Paid?', '#fff2cc', '#d6b656')}
      ${line(4, [3, 6.5], [5, 6.5], 'reads')}
      ${line(5, [6, 6], [6, 3.5], 'checks', 2, 0, 13)}
      ${line(6, [1, 1], [2, 1])}
    </Shapes>
    <Connects>
      <Connect FromSheet="4" FromCell="BeginX" FromPart="9" ToSheet="1" ToCell="PinX" ToPart="3"/>
      <Connect FromSheet="4" FromCell="EndX" FromPart="12" ToSheet="2" ToCell="PinX" ToPart="3"/>
      <Connect FromSheet="5" FromCell="BeginX" FromPart="9" ToSheet="2" ToCell="PinX" ToPart="3"/>
      <Connect FromSheet="5" FromCell="EndX" FromPart="12" ToSheet="3" ToCell="PinX" ToPart="3"/>
    </Connects>`;
    const r = importDiagram(vsdx(page), { filename: 'flow.vsdx' });
    expect(r.report.format).toBe('vsdx');
    expect(r.report.pages[0]!.name).toBe('Flow');
    const names = r.document.nodes.map((n) => n.name);
    expect(names).toEqual(['Web App', 'Orders DB', 'Paid?']);
    const web = r.document.nodes[0]!;
    expect(web.subtitle).toBe('ASP.NET');
    expect(factLines(web)).toEqual(['Plan: P1v3']);
    expect(web.color).toBe('blue');
    const view = r.document.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    // PinX 2, Width 2 => left edge 1 in => 96 px; PinY 6.5, Height 1 on an 8.5 in page => top at 1.5 in => 144 px.
    expect(view.pins!.nodes['web-app']).toEqual({ x: 96, y: 144, w: 192, h: 96 });
    expect(view.pins!.nodes['paid']).toEqual({ x: 504, y: 480, w: 144, h: 96 });
    const rels = r.document.relations!;
    expect(rels).toHaveLength(2);
    expect(ends(rels[0]!)).toBe('web-app>orders-db');
    expect(rels[0]).toMatchObject({ label: 'reads', style: 'straight' });
    expect(ends(rels[1]!)).toBe('orders-db>paid');
    expect(rels[1]).toMatchObject({ label: 'checks', kind: 'async', heads: { from: 'none', to: 'open' } });
    expect(r.report.pages[0]!.dropped).toEqual(['6: line with no ends']);
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expectPinsHonoured(loaded.model!, 'flow');
  });

  test('master names pick shapes and groups hold their children', () => {
    const page = `<Shapes>
      <Shape ID="10" Type="Group" NameU="Group.10">${cell('PinX', 4)}${cell('PinY', 4)}${cell('Width', 6)}${cell('Height', 4)}${cell('LocPinX', 3)}${cell('LocPinY', 2)}${cell('FillForegnd', '#f5f5f5')}${cell('FillPattern', 1)}${cell('LineColor', '#666666')}${cell('LinePattern', 1)}<Text>Platform</Text>
        <Shapes>
          <Shape ID="11" Type="Shape" Master="7">${cell('PinX', 1.5)}${cell('PinY', 2)}${cell('Width', 2)}${cell('Height', 1)}${cell('LocPinX', 1)}${cell('LocPinY', 0.5)}${cell('FillForegnd', '#ffffff')}${cell('FillPattern', 1)}${cell('LineColor', '#000000')}${cell('LinePattern', 1)}<Text>Ledger</Text></Shape>
          <Shape ID="12" Type="Shape" Master="8">${cell('PinX', 4.5)}${cell('PinY', 2)}${cell('Width', 2)}${cell('Height', 1)}${cell('LocPinX', 1)}${cell('LocPinY', 0.5)}${cell('FillForegnd', '#ffffff')}${cell('FillPattern', 1)}${cell('LineColor', '#000000')}${cell('LinePattern', 1)}<Text>Approved?</Text></Shape>
        </Shapes>
      </Shape>
    </Shapes>`;
    const r = importDiagram(vsdx(page), { filename: 'groups.vsdx' });
    const platform = r.document.nodes[0]!;
    expect(platform.name).toBe('Platform');
    expect(platform.children?.map((c) => [c.name, c.shape])).toEqual([['Ledger', 'cylinder'], ['Approved?', 'diamond']]);
    const view = r.document.views[0]!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    // The group spans x 1..7 in and y 2..6 in; Ledger sits at local (0.5..2.5, 1.5..2.5), so its top is 4.5 in up: 4 in from the top.
    expect(view.pins!.nodes['platform']).toEqual({ x: 96, y: 240, w: 576, h: 384 });
    expect(view.pins!.nodes['ledger']).toEqual({ x: 144, y: 384, w: 192, h: 96 });
    const loaded = loadModelFromText(r.yaml);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expectPinsHonoured(loaded.model!, 'flow');
  });
});
