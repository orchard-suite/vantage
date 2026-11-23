/**
 * The drawing behind a publication run, as a render task: the head version
 * with its observed layer, each wanted format and view, reusing the stored
 * pictures the hub passes in. The hub adds the stamp and the delivery.
 */
import { CONTENT_TYPES, filenameFor, type Artifact, type Stamp } from '@vantage/publish';
import { renderDrawio, renderPdf, renderVsdx } from '@vantage/export';
import { layoutView, type Layout } from '@vantage/layout';
import { pictureViews } from '@vantage/model';
import { declaredSize, PictureTooLargeError, pngSize, renderPng, renderSvg, standaloneHtml, type Png, type ThemeName, type TitleBlock } from '@vantage/render';
import type { ObservedModel } from '@vantage/connectors';
import { bundleFor, loadOverlaid, type ImportMap } from '../documents/model.ts';
import { resourcesFrom, type ResourceData } from './resources.ts';

/** The scale an exported PNG is drawn at, when the pixel budget allows. */
const PNG_SCALE = 2;

export interface ProduceInput {
  readonly yaml: string;
  readonly imports: ImportMap;
  readonly observed: ObservedModel;
  readonly resources: ResourceData;
  readonly thresholdDays: number;
  readonly slug: string;
  readonly formats: readonly Artifact['kind'][];
  /** View ids the publication names; empty or absent is every view. */
  readonly views?: readonly string[] | undefined;
  readonly theme?: ThemeName | undefined;
  readonly titleBlock: boolean;
  readonly stamp: Stamp;
  /** Where a published HTML copy asks for a newer version. */
  readonly refreshUrl: string;
  /** Stored pictures by `<view>.<svg|png>`, reused when there is no title block; a stored PNG's SVG says how far the budget scaled it down. */
  readonly stored: Readonly<Record<string, Uint8Array>>;
}

export interface ProducedFile {
  readonly kind: Artifact['kind'];
  readonly viewId?: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface ProduceOutput {
  readonly files: readonly ProducedFile[];
  readonly warnings: readonly string[];
  readonly reused: number;
  readonly rendered: number;
  readonly error?: string;
}

export async function produce(input: ProduceInput): Promise<ProduceOutput> {
  const warnings: string[] = [];
  const { model, diagnostics } = loadOverlaid(input, input.observed, { now: new Date(), thresholdDays: input.thresholdDays });
  if (!model) return { files: [], warnings, reused: 0, rendered: 0, error: `document does not parse: ${diagnostics.map((d) => d.message).join('; ')}` };
  const theme = input.theme ?? (model.theme === 'dark' ? 'dark' : 'light');
  const views = pictureViews(input.views?.length ? model.views.filter((v) => input.views!.includes(v.id)) : model.views);
  for (const id of input.views ?? []) if (!views.some((v) => v.id === id)) warnings.push(`view ${id} is not in the document`);
  const { stamp } = input;
  const block: TitleBlock | undefined = input.titleBlock ? { title: model.title, ...(model.author ? { author: model.author } : {}), ...(model.updated ? { updated: model.updated } : {}), version: stamp.version, published: stamp.publishedAt.slice(0, 10), ...(stamp.liveUrl ? { link: stamp.liveUrl } : {}) } : undefined;
  const res = resourcesFrom(model, input.resources);
  const enc = new TextEncoder();
  const files: ProducedFile[] = [];
  let reused = 0;
  let rendered = 0;
  const layouts = new Map<string, Layout>();
  const layoutOf = (viewId: string): Layout => {
    let l = layouts.get(viewId);
    if (!l) {
      l = layoutView(model, views.find((v) => v.id === viewId)!);
      layouts.set(viewId, l);
    }
    return l;
  };
  const noteSmaller = (viewId: string, size: { readonly width: number; readonly height: number }, scale: number): void => {
    if (scale < PNG_SCALE) warnings.push(`view ${viewId} is large, so its PNG is drawn at ${scale.toFixed(2)}x instead of ${PNG_SCALE}x (${size.width} by ${size.height} pixels)`);
  };
  const make = (kind: Artifact['kind'], viewId: string | undefined, bytes: Uint8Array): ProducedFile => ({ kind, ...(viewId !== undefined ? { viewId } : {}), filename: filenameFor(input.slug, viewId, kind), contentType: CONTENT_TYPES[kind], bytes });
  for (const format of input.formats) {
    if (format === 'html') {
      const bundle = { ...bundleFor(model, { theme, diagnostics, ...res }), stamp };
      files.push(make('html', undefined, enc.encode(standaloneHtml(bundle, { refresh: { url: input.refreshUrl, version: stamp.version } }))));
      rendered++;
      continue;
    }
    if (format === 'pdf' || format === 'drawio' || format === 'vsdx') {
      if (!views.length) {
        warnings.push(`${format} skipped: the document has no views`);
        continue;
      }
      const all = views.map((v) => layoutOf(v.id));
      let bytes: Uint8Array;
      if (format === 'pdf') bytes = await renderPdf(all.map((layout) => ({ layout, ...(block ? { titleBlock: { ...block, subtitle: layout.title } } : {}) })), { theme, ...res, title: model.title, ...(model.author ? { author: model.author } : {}) });
      else if (format === 'drawio') bytes = enc.encode(renderDrawio(all, { theme, ...res }));
      else bytes = renderVsdx(all, { theme, title: model.title, ...(model.author ? { author: model.author } : {}) });
      files.push(make(format, undefined, bytes));
      rendered++;
      continue;
    }
    for (const view of views) {
      const stored = block ? undefined : input.stored[`${view.id}.${format}`];
      if (stored) {
        files.push(make(format, view.id, stored));
        const svg = input.stored[`${view.id}.svg`];
        const drawn = format === 'png' ? pngSize(stored) : undefined;
        const natural = svg ? declaredSize(new TextDecoder().decode(svg)) : undefined;
        if (drawn && natural) noteSmaller(view.id, drawn, drawn.width / natural.width);
        reused++;
        continue;
      }
      const svg = renderSvg(layoutOf(view.id), { theme, ...res, freshness: { thresholdDays: input.thresholdDays }, ...(block ? { titleBlock: { ...block, subtitle: view.title } } : {}) });
      if (format === 'svg') files.push(make(format, view.id, enc.encode(svg)));
      else {
        let png: Png;
        try {
          png = renderPng(svg, { scale: PNG_SCALE });
        } catch (err) {
          if (err instanceof PictureTooLargeError) return { files: [], warnings, reused, rendered, error: `view ${view.id}: ${err.message}` };
          throw err;
        }
        noteSmaller(view.id, png, png.scale);
        files.push(make(format, view.id, png.bytes));
      }
      rendered++;
    }
  }
  return { files, warnings, reused, rendered };
}
