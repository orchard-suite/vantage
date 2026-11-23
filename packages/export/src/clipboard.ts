/**
 * Clipboard-ready pictures: an SVG that carries its fonts so it pastes the
 * same everywhere, and a PNG with an optional transparent background.
 */
import { fontCss, renderPng, renderSvg, type Resources, type TitleBlock } from '@vantage/render';
import type { Layout } from '@vantage/layout';
import type { ExportTheme } from './common.ts';

export interface ClipboardOptions extends Resources {
  readonly theme?: ExportTheme;
  readonly titleBlock?: TitleBlock;
  /** Leave the canvas unpainted. */
  readonly transparent?: boolean;
  /** PNG pixel scale; default 2. */
  readonly scale?: number;
}

export function clipboardSvg(layout: Layout, opts: ClipboardOptions = {}): string {
  return renderSvg(layout, {
    fontCss: fontCss(),
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.icons ? { icons: opts.icons } : {}),
    ...(opts.assets ? { assets: opts.assets } : {}),
    ...(opts.titleBlock ? { titleBlock: opts.titleBlock } : {}),
    ...(opts.transparent ? { background: false } : {}),
  });
}

export function clipboardPng(layout: Layout, opts: ClipboardOptions = {}): Uint8Array<ArrayBuffer> {
  const svg = renderSvg(layout, {
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.icons ? { icons: opts.icons } : {}),
    ...(opts.assets ? { assets: opts.assets } : {}),
    ...(opts.titleBlock ? { titleBlock: opts.titleBlock } : {}),
    ...(opts.transparent ? { background: false } : {}),
  });
  return renderPng(svg, { scale: opts.scale ?? 2 }).bytes;
}
