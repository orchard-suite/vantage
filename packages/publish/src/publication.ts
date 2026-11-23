/**
 * A publication: which document, which views, which formats, where, when.
 * `runPublication` renders through a caller-supplied producer (the hub's
 * artifact store, or the CLI's renderer) and hands the result to the target.
 */
import { z } from 'zod';
import type { Artifact, ArtifactKind, PublishResult, Stamp, TargetContext, TargetRegistry } from './target.ts';

export const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('on-save') }).strict(),
  z.object({ kind: z.literal('schedule'), cron: z.string().min(1).describe('Five-field cron expression, hub time zone') }).strict(),
  z.object({ kind: z.literal('manual') }).strict(),
]);

export const PublicationSchema = z
  .object({
    id: z.string().min(1),
    document: z.string().min(1).describe('Document id or path'),
    views: z.array(z.string()).optional().describe('View ids; omit for every view'),
    formats: z.array(z.enum(['html', 'png', 'svg', 'pdf', 'drawio', 'vsdx'])).min(1),
    target: z.string().min(1).describe('Target id'),
    config: z.record(z.string(), z.unknown()).describe('Target configuration; secrets by reference'),
    trigger: TriggerSchema.default({ kind: 'manual' }),
    audience: z.enum(['org', 'public', 'external']).default('org').describe('Who the destination serves; recorded for the audit log'),
    theme: z.enum(['light', 'dark', 'print', 'colorblind']).optional(),
    titleBlock: z.boolean().default(true),
  })
  .strict();

export type Publication = z.output<typeof PublicationSchema>;

export interface ProduceRequest {
  readonly publication: Publication;
  readonly stamp: Stamp;
}

/** Produces the artifacts for a publication: the hub reads its store, the CLI renders. */
export type Producer = (req: ProduceRequest) => Promise<readonly Artifact[]>;

export const CONTENT_TYPES: Record<ArtifactKind, string> = {
  html: 'text/html; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  drawio: 'application/xml',
  vsdx: 'application/vnd.ms-visio.drawing.main+xml',
  bundle: 'application/json',
};

export function filenameFor(docSlug: string, viewId: string | undefined, kind: ArtifactKind): string {
  return viewId ? `${docSlug}.${viewId}.${kind}` : `${docSlug}.${kind}`;
}

export async function runPublication(
  pub: Publication,
  stamp: Stamp,
  produce: Producer,
  registry: TargetRegistry,
  ctx: Omit<TargetContext, 'config'>,
): Promise<PublishResult> {
  const target = registry.get(pub.target);
  if (!target) throw new Error(`unknown target ${pub.target}; known: ${registry.list().map((t) => t.id).join(', ')}`);
  const config = target.configSchema.parse(pub.config);
  ctx.log.info('publication start', { id: pub.id, document: pub.document, target: pub.target, formats: pub.formats, trigger: pub.trigger.kind, audience: pub.audience });
  const artifacts = await produce({ publication: pub, stamp });
  ctx.log.info('artifacts produced', { id: pub.id, count: artifacts.length, bytes: artifacts.reduce((a, x) => a + x.bytes.byteLength, 0) });
  const result = await target.publish({ ...ctx, config }, artifacts);
  ctx.log.info('publication end', { id: pub.id, written: result.written.length, skipped: result.skipped.length });
  return result;
}
