/**
 * PDF export: one view per page, drawn as vectors through pdfkit. The SVG
 * the renderer already produces is replayed onto the page, so text stays
 * selectable and the Inter faces are embedded from the render assets.
 */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { renderPng, renderSvg, fontFiles, titleBlockHeight, type Resources } from '@vantage/render';
import type { ExportPage, ExportTheme } from './common.ts';

export type PageSize = 'A4' | 'Letter' | 'A3' | 'fit';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export interface PdfOptions extends Resources {
  readonly page?: PageSize;
  readonly orientation?: Orientation;
  readonly theme?: ExportTheme;
  /** Page margin in points. */
  readonly margin?: number;
  /** Document metadata; the title defaults to the first page's title block or view title. */
  readonly title?: string;
  readonly author?: string;
}

/** Page sizes in points, portrait. */
const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  A3: [841.89, 1190.55],
};

/**
 * svg-to-pdfkit folds weight 500 into regular and lets the stylesheet's
 * font-family rule beat element attributes, so the stylesheet goes and
 * medium text is tagged by family before conversion.
 */
const MEDIUM_FAMILY = 'Inter Medium';

/** PDFKit draws PNG and JPEG pictures only, so SVG pictures (logos, custom icons) go in as PNG. */
function rasterizeSvgPictures(svg: string): string {
  return svg.replace(/href="data:image\/svg\+xml;base64,([^"]+)"/g, (whole, b64: string) => {
    try {
      const png = renderPng(Buffer.from(b64, 'base64').toString('utf8'), { width: 512 }).bytes;
      return `href="data:image/png;base64,${Buffer.from(png).toString('base64')}"`;
    } catch {
      return whole;
    }
  });
}

function tagMediumText(svg: string): string {
  return svg.replace(/<style>[\s\S]*?<\/style>/, '').replace(/font-weight="500"/g, `font-weight="500" font-family="${MEDIUM_FAMILY}"`);
}

function pickFont(family: string, bold: boolean): string {
  if (bold) return 'Inter-SemiBold';
  if (family === MEDIUM_FAMILY) return 'Inter-Medium';
  return 'Inter';
}

function pageDims(page: PageSize, orientation: Orientation, w: number, h: number, margin: number): [number, number] {
  if (page === 'fit') return [w + margin * 2, h + margin * 2];
  const [pw, ph] = SIZES[page];
  const landscape = orientation === 'landscape' || (orientation === 'auto' && w > h);
  return landscape ? [ph, pw] : [pw, ph];
}

export async function renderPdf(pages: readonly ExportPage[], opts: PdfOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  if (pages.length === 0) throw new Error('pdf export needs at least one view');
  const margin = opts.margin ?? 36;
  const first = pages[0]!;
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: {
      Title: opts.title ?? first.titleBlock?.title ?? first.layout.title,
      ...(opts.author ?? first.titleBlock?.author ? { Author: opts.author ?? first.titleBlock?.author ?? '' } : {}),
      Creator: 'vantage',
    },
  });
  const [regular, medium, semibold] = fontFiles();
  doc.registerFont('Inter', regular!);
  doc.registerFont('Inter-Medium', medium!);
  doc.registerFont('Inter-SemiBold', semibold!);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const page of pages) {
    const svg = renderSvg(page.layout, {
      ...(opts.theme ? { theme: opts.theme } : {}),
      ...(opts.icons ? { icons: opts.icons } : {}),
    ...(opts.assets ? { assets: opts.assets } : {}),
      ...(page.titleBlock ? { titleBlock: page.titleBlock } : {}),
    });
    const w = page.layout.width;
    const h = page.layout.height + (page.titleBlock ? titleBlockHeight(page.titleBlock) : 0);
    const [pw, ph] = pageDims(opts.page ?? 'A4', opts.orientation ?? 'auto', w, h, margin);
    doc.addPage({ size: [pw, ph], margin: 0 });
    SVGtoPDF(doc, tagMediumText(rasterizeSvgPictures(svg)), margin, margin, {
      width: pw - margin * 2,
      height: ph - margin * 2,
      preserveAspectRatio: 'xMinYMin meet',
      fontCallback: pickFont,
      assumePt: false,
    });
  }
  doc.end();
  const buf = await done;
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** Counts the page objects of a PDF; used by tests and by callers that report page counts. */
export function pdfPageCount(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
