/**
 * SVG to PNG through resvg, with the Inter faces loaded so text matches the
 * layout's measurements. A picture never takes more than PNG_PIXEL_BUDGET
 * pixels: a larger one is drawn at a smaller scale, and one that would need
 * a scale under PNG_MIN_SCALE is refused, so a big view cannot take the
 * process's memory with it.
 */
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';
import { fontFiles } from './fonts.ts';

/** Pixels one PNG may hold. resvg needs about eight bytes a pixel at its peak, so this is about 256 MB. */
export const PNG_PIXEL_BUDGET = 32_000_000;
/** Below this scale the text is too small to read, and the picture is refused instead. */
export const PNG_MIN_SCALE = 0.5;

export interface PngOptions {
  readonly scale?: number;
  /** Fit to this many pixels wide instead of scaling. */
  readonly width?: number;
  readonly background?: string;
}

export interface Png {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  /** The scale it was drawn at. */
  readonly scale: number;
  /** The scale the caller asked for; larger than `scale` when the budget made it smaller. */
  readonly wanted: number;
}

/** The picture is too large to draw as a PNG at a readable scale. */
export class PictureTooLargeError extends Error {
  constructor(readonly width: number, readonly height: number) {
    super(`the picture is ${Math.round(width)} by ${Math.round(height)}, too large for a PNG: even at ${PNG_MIN_SCALE}x it is over ${PNG_PIXEL_BUDGET / 1e6} million pixels. Export it as SVG or PDF, or split the view.`);
    this.name = PictureTooLargeError.NAME;
  }

  static readonly NAME = 'PictureTooLargeError';
}

interface Size {
  readonly width: number;
  readonly height: number;
}

export function renderPng(svg: string, opts: PngOptions = {}): Png {
  const declared = declaredSize(svg);
  const asked: Fit = opts.width !== undefined ? { mode: 'width', value: opts.width } : { mode: 'zoom', value: opts.scale ?? 2 };
  let resvg = parse(svg, declared ? { mode: 'zoom', value: budgeted(declared, opts) } : asked, opts);
  const size = { width: resvg.width, height: resvg.height };
  const wanted = wantedScale(size, opts);
  const scale = budgeted(size, opts);
  if (!declared && scale !== wanted) resvg = parse(svg, { mode: 'zoom', value: scale }, opts);
  const image = resvg.render();
  const png = image.asPng();
  return { bytes: new Uint8Array(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer), width: image.width, height: image.height, scale, wanted };
}

type Fit = NonNullable<ResvgRenderOptions['fitTo']>;

function parse(svg: string, fitTo: Fit, opts: PngOptions): Resvg {
  return new Resvg(svg, {
    fitTo,
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Inter' },
    ...(opts.background ? { background: opts.background } : {}),
  });
}

function wantedScale(size: Size, opts: PngOptions): number {
  return opts.width !== undefined ? opts.width / size.width : (opts.scale ?? 2);
}

/** The wanted scale, made smaller when the picture would pass the pixel budget. */
function budgeted(size: Size, opts: PngOptions): number {
  const { width: w, height: h } = size;
  const wanted = wantedScale(size, opts);
  if (Math.ceil(w * wanted) * Math.ceil(h * wanted) <= PNG_PIXEL_BUDGET) return wanted;
  // The largest scale whose rounded-up size fits: (w s + 1)(h s + 1) <= budget.
  const fits = (Math.sqrt((w + h) ** 2 + 4 * w * h * (PNG_PIXEL_BUDGET - 1)) - (w + h)) / (2 * w * h);
  if (fits < Math.min(wanted, PNG_MIN_SCALE)) throw new PictureTooLargeError(w, h);
  return fits;
}

/** A PNG's pixel size, from its header. */
export function pngSize(bytes: Uint8Array): Size | undefined {
  const isPng = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The size the root element declares (width and height, else the viewBox), read without parsing the picture. */
export function declaredSize(svg: string): Size | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!root) return undefined;
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1];
  const length = (v: string | undefined): number | undefined => {
    const m = v ? /^\s*([\d.]+)\s*(px)?\s*$/.exec(v) : null;
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const width = length(attr('width'));
  const height = length(attr('height'));
  if (width && height) return { width, height };
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0 && !width && !height) return { width: box[2]!, height: box[3]! };
  return undefined;
}
