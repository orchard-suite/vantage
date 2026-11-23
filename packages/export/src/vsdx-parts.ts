/** The fixed OOXML parts of a .vsdx package: content types, relationships, document, and properties. */
import { PLAIN } from '@vantage/render';
import { xmlEsc } from './common.ts';

export const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main';
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';

export function contentTypes(pageCount: number): string {
  const pages = Array.from({ length: pageCount }, (_, i) => `<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('');
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>${pages}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

export function rootRels(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

export function documentRels(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/></Relationships>`;
}

export function pagesRels(pageCount: number): string {
  const rels = Array.from({ length: pageCount }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i + 1}.xml"/>`).join('');
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

/** A page's relationships to the pictures its foreign shapes draw. */
export function pageRels(media: readonly { readonly relId: string; readonly target: string }[]): string {
  const rels = media.map((m) => `<Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.target}"/>`).join('');
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

/** The document part with one plain stylesheet every shape points at. */
export function documentXml(): string {
  const cells = [
    ['EnableLineProps', '1'], ['EnableFillProps', '1'], ['EnableTextProps', '1'],
    ['LineWeight', '0.01'], ['LinePattern', '1'], ['LineColor', PLAIN.ink], ['Rounding', '0'],
    ['FillForegnd', PLAIN.paper], ['FillBkgnd', PLAIN.paper], ['FillPattern', '1'],
    ['BeginArrow', '0'], ['EndArrow', '0'], ['BeginArrowSize', '2'], ['EndArrowSize', '2'],
    ['TextBkgnd', '0'], ['LeftMargin', '0.05'], ['RightMargin', '0.05'], ['TopMargin', '0.05'], ['BottomMargin', '0.05'], ['VerticalAlign', '1'],
  ].map(([n, v]) => `<Cell N="${n}" V="${v}"/>`).join('');
  const character = `<Section N="Character"><Row IX="0"><Cell N="Font" V="0"/><Cell N="Color" V="${PLAIN.ink}"/><Cell N="Style" V="0"/><Cell N="Size" V="0.1666667"/></Row></Section>`;
  const paragraph = '<Section N="Paragraph"><Row IX="0"><Cell N="IndFirst" V="0"/><Cell N="IndLeft" V="0"/><Cell N="IndRight" V="0"/><Cell N="SpLine" V="-1.2"/><Cell N="HorzAlign" V="1"/></Row></Section>';
  return `${XML_HEAD}<VisioDocument xmlns="${VISIO_NS}" xmlns:r="${REL_NS}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"/><FaceNames><FaceName NameU="Inter"/></FaceNames><StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style">${cells}${character}${paragraph}</StyleSheet></StyleSheets></VisioDocument>`;
}

export function coreProps(title: string, author: string | undefined): string {
  const now = new Date().toISOString();
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title>${author ? `<dc:creator>${xmlEsc(author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export function appProps(): string {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Visio</Application><AppVersion>16.0000</AppVersion></Properties>`;
}
