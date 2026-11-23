/** Renders a layout to SVG, reading pictures from disk when the caller gives no asset source. */
import type { Layout } from '@vantage/layout';
import { FileAssetSource } from './assets.ts';
import { drawSvg, type RenderOptions } from './svg.ts';

export function renderSvg(layout: Layout, opts: RenderOptions = {}): string {
  return drawSvg(layout, { ...opts, assets: opts.assets ?? new FileAssetSource() });
}
