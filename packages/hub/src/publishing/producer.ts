/**
 * The hub's producer for @vantage/publish: artifacts for the document's
 * head version. Stored SVG and PNG are reused when the publication wants
 * no title block; otherwise, and for anything not stored (PDF, draw.io,
 * VSDX, a view rendered since), the version is drawn on the render pool.
 * Every artifact carries the stamp; the HTML also carries the refresh URL
 * so a copy asks the hub for a newer version when it opens.
 */
import type { Artifact, Producer, Stamp } from '@vantage/publish';
import type { AppContext } from '../context.ts';
import type { DocumentRow, VersionRow } from '../documents/repo.ts';
import { resourceInputs } from '../documents/assets.ts';
import { bundleUrl, freshnessDays, observedForDocument } from '../worker/artifacts.ts';
import { storedArtifact } from '../documents/derived.ts';

export interface ProducerInput {
  readonly document: DocumentRow;
  readonly version: VersionRow;
  readonly stamp: Stamp;
  readonly onWarning: (message: string) => void;
}

export function hubProducer(ctx: AppContext, input: ProducerInput): Producer {
  return async ({ publication }) => {
    const { document, version, stamp } = input;
    const log = ctx.log.child({ publicationId: publication.id, documentId: document.id, versionId: version.id });
    const observed = await observedForDocument(ctx, document, version);
    const resources = await resourceInputs(ctx, { orgId: version.org_id, workspaceId: document.workspace_id, attachments: version.attachments });
    const thresholdDays = await freshnessDays(ctx, document.workspace_id);
    const stored: Record<string, Uint8Array> = {};
    if (!publication.titleBlock) {
      for (const format of publication.formats) {
        if (format !== 'svg' && format !== 'png') continue;
        for (const viewId of publication.views ?? []) {
          // A PNG's SVG comes along, so the export can say when the PNG was drawn smaller.
          for (const kind of format === 'png' ? (['svg', 'png'] as const) : ([format] as const)) {
            if (stored[`${viewId}.${kind}`]) continue;
            const a = await storedArtifact(ctx, version, viewId, kind);
            if (a) stored[`${viewId}.${kind}`] = a.bytes;
          }
        }
      }
    }
    log.info('produce.start', { formats: publication.formats, views: publication.views ?? [], titleBlock: Boolean(publication.titleBlock), theme: publication.theme ?? null, stored: Object.keys(stored).length });
    const out = await ctx.render.run('produce', {
      yaml: version.yaml,
      imports: version.imports,
      observed: observed.model,
      resources,
      thresholdDays,
      slug: document.slug,
      formats: publication.formats,
      views: publication.views,
      theme: publication.theme,
      titleBlock: Boolean(publication.titleBlock),
      stamp,
      refreshUrl: bundleUrl(ctx, document.id),
      stored,
    });
    for (const w of out.warnings) input.onWarning(w);
    if (out.error) throw new Error(out.error);
    const artifacts: Artifact[] = out.files.map((f) => ({ kind: f.kind, ...(f.viewId !== undefined ? { viewId: f.viewId } : {}), filename: f.filename, contentType: f.contentType, bytes: new Uint8Array(f.bytes), stamp }));
    log.info('produce.end', { artifacts: artifacts.length, reused: out.reused, rendered: out.rendered, bytes: artifacts.reduce((a, x) => a + x.bytes.byteLength, 0) });
    return artifacts;
  };
}
