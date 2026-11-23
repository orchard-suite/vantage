/**
 * Producing artifacts for a publication from a document on disk: the CLI
 * path. The hub has its own producer that reads rendered artifacts from
 * its store; both hand the same shapes to the same targets.
 */
import { CONTENT_TYPES, filenameFor, type Artifact, type Producer, type Stamp } from '@vantage/publish';
import { buildBundle, standaloneHtml, renderSvg, renderPng } from '@vantage/render';
import { layoutView } from '@vantage/layout';
import { pictureViews } from '@vantage/model';
import { resourcesFor, exportDocument, load, documentTitleBlock, type Theme } from './core.ts';

export interface FileProducerOptions {
  readonly file: string;
  readonly slug: string;
  readonly theme?: Theme | undefined;
  /** Hub URL that serves `{ version, bundle }` for this document; makes the HTML self-refreshing. */
  readonly refreshUrl?: string | undefined;
  readonly titleBlock?: boolean | undefined;
}

export function fileProducer(opts: FileProducerOptions): Producer {
  return async ({ publication, stamp }) => {
    const { model, diagnostics } = load({ file: opts.file });
    if (!model) throw new Error(diagnostics.map((d) => d.message).join('; '));
    const theme = opts.theme ?? (model.theme === 'auto' ? 'light' : model.theme);
    const views = pictureViews(publication.views?.length ? model.views.filter((v) => publication.views!.includes(v.id)) : model.views);
    const block = opts.titleBlock === false ? undefined : documentTitleBlock(model, true);
    const stamped = block ? { ...block, version: stamp.version, published: stamp.publishedAt.slice(0, 10), ...(stamp.liveUrl ? { link: stamp.liveUrl } : {}) } : undefined;
    const out: Artifact[] = [];
    const res = resourcesFor(model);
    for (const format of publication.formats) {
      if (format === 'html') {
        const bundle = { ...buildBundle(model, { theme, ...res, diagnostics }), stamp };
        const html = standaloneHtml(bundle, opts.refreshUrl ? { refresh: { url: opts.refreshUrl, version: stamp.version } } : {});
        out.push(artifact('html', undefined, opts.slug, new TextEncoder().encode(html) as Uint8Array<ArrayBuffer>, stamp));
        continue;
      }
      if (format === 'pdf' || format === 'drawio' || format === 'vsdx') {
        const r = await exportDocument({ file: opts.file, format, views: views.map((v) => v.id), theme, ...(stamped ? { titleBlock: stamped } : {}) });
        if (!r.result) throw new Error(r.diagnostics.map((d) => d.message).join('; '));
        out.push(artifact(format, undefined, opts.slug, r.result.bytes, stamp));
        continue;
      }
      for (const view of views) {
        const layout = layoutView(model, view);
        const svg = renderSvg(layout, { theme, ...res, ...(stamped ? { titleBlock: { ...stamped, subtitle: stamped.subtitle ?? view.title } } : {}) });
        const bytes = format === 'png' ? renderPng(svg, { scale: 2 }).bytes : (new TextEncoder().encode(svg) as Uint8Array<ArrayBuffer>);
        out.push(artifact(format, view.id, opts.slug, bytes, stamp));
      }
    }
    return out;
  };
}

function artifact(kind: Artifact['kind'], viewId: string | undefined, slug: string, bytes: Uint8Array<ArrayBuffer>, stamp: Stamp): Artifact {
  return { kind, ...(viewId !== undefined ? { viewId } : {}), filename: filenameFor(slug, viewId, kind), contentType: CONTENT_TYPES[kind], bytes, stamp };
}
