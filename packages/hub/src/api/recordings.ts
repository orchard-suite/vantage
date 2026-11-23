/**
 * Voice walkthroughs by document id: list, upload, stream the audio with
 * range requests, delete. Readers of the viewer (and guests) list and
 * stream through the bundle's own addresses, which answer the same way;
 * see `readerRecordings` and `readerAudio`.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import type { OpenApiRegistry } from './openapi.ts';
import { scopedDocumentById, who } from './common.ts';
import { userLabels } from '../mentions.ts';
import { audioResponse, createRecording, deleteRecording, listRecordings, publicRecording, recordingById, recordingLimits, RecordingMetaSchema, RECORDING_TYPES, uploadBodyLimit, type RecordingRow } from '../recordings.ts';
import { badRequest, HttpError, notFound } from '../http.ts';
import type { ResolvedDocument } from '../web/resolve.ts';

const DOC = '/documents/:id';

/** The list a reader sees: the recordings of the document (of the one view a guest link allows), newest first, with the limits an author records under. */
async function listing(ctx: AppContext, documentId: string, head: string | null, opts: { view?: string | undefined }): Promise<Record<string, unknown>> {
  const rows = await listRecordings(ctx.dbRead, documentId, opts);
  const labels = await userLabels(ctx.db, rows.map((r) => r.author_user_id));
  return { recordings: rows.map((r) => publicRecording(r, r.author_user_id ? labels.get(r.author_user_id) ?? null : null, head)), limits: recordingLimits(ctx.config), types: RECORDING_TYPES };
}

async function found(ctx: AppContext, documentId: string, id: string | undefined, onlyView?: string): Promise<RecordingRow> {
  const row = id ? await recordingById(ctx.dbRead, documentId, id) : undefined;
  if (!row || (onlyView !== undefined && row.view_id !== onlyView)) throw notFound('recording');
  return row;
}

/** The recordings a reader of the viewer may play: a guest link limited to one view lists only that view's. */
export async function readerRecordings(ctx: AppContext, c: Context<HubEnv>, resolved: ResolvedDocument): Promise<Response> {
  const view = resolved.onlyView ?? c.req.query('view');
  return c.json(await listing(ctx, resolved.document.id, resolved.document.head_version_id, { view }), 200, { 'cache-control': 'private, no-cache' });
}

export async function readerAudio(ctx: AppContext, c: Context<HubEnv>, resolved: ResolvedDocument): Promise<Response> {
  const row = await found(ctx, resolved.document.id, c.req.query('id'), resolved.onlyView);
  return audioResponse(ctx, row, c.req.header('range'));
}

export function recordingRoutes(ctx: AppContext, reg: OpenApiRegistry): Hono<HubEnv> {
  const app = new Hono<HubEnv>();
  const limits = recordingLimits(ctx.config);

  reg.add({ method: 'get', path: `${DOC}/recordings`, summary: 'Voice walkthroughs of a document, newest first, each with its view, the version it was made on, its length, type, and step timeline; ?view= filters', tag: 'recordings', params: ['id'], query: ['view'], auth: 'viewer' });
  app.get(`${DOC}/recordings`, async (c) => {
    const { document } = await scopedDocumentById(ctx, c, 'viewer');
    return c.json(await listing(ctx, document.id, document.head_version_id, { view: c.req.query('view') }));
  });

  reg.add({
    method: 'post',
    path: `${DOC}/recordings`,
    summary: `Save a voice walkthrough as multipart/form-data: an audio part and a meta part of JSON naming its type (${RECORDING_TYPES.join(', ')}, codec parameters allowed); refused past RECORDING_MAX_SECONDS or RECORDING_MAX_MB`,
    tag: 'recordings',
    params: ['id'],
    body: { audio: 'the audio file', meta: 'JSON: {"view": view id, "version": the version on the stage, "durationMs": length, "type": the audio type, "timeline": [{"at": ms, "path": path index (0 for a walkthrough), "step": step index (-1 for the overview), "boxes": box ids the step lit}]}' },
    auth: 'author',
    responses: { '201': 'created', '400': 'bad audio type, length, version, or meta', '413': 'too large' },
  });
  app.post(
    `${DOC}/recordings`,
    bodyLimit({
      maxSize: uploadBodyLimit(limits),
      onError: () => {
        ctx.metrics.recordings.add(1, { outcome: 'too_large' });
        throw new HttpError(413, `a recording may be at most ${ctx.config.RECORDING_MAX_MB} MB`);
      },
    }),
    async (c) => {
      const { p, document } = await scopedDocumentById(ctx, c, 'author');
      const form = await c.req.parseBody().catch(() => undefined);
      const audio = form?.['audio'];
      const rawMeta = form?.['meta'];
      if (!(audio instanceof File) || typeof rawMeta !== 'string') throw badRequest('send multipart/form-data with an audio file and a meta JSON part');
      let json: unknown;
      try {
        json = JSON.parse(rawMeta);
      } catch {
        throw badRequest('meta is not JSON');
      }
      const meta = RecordingMetaSchema.safeParse(json);
      if (!meta.success) throw badRequest('invalid meta', { issues: meta.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      const row = await createRecording(ctx, { orgId: p.orgId, userId: p.userId, who: who(p), surface: p.surface }, { documentId: document.id, meta: meta.data, audio: new Uint8Array(await audio.arrayBuffer()) });
      const labels = await userLabels(ctx.db, [row.author_user_id]);
      return c.json(publicRecording(row, row.author_user_id ? labels.get(row.author_user_id) ?? null : null, document.head_version_id), 201);
    },
  );

  reg.add({ method: 'get', path: `${DOC}/recordings/:recording/audio`, summary: 'The audio of a voice walkthrough; honours a single Range header with 206', tag: 'recordings', params: ['id', 'recording'], auth: 'viewer', responses: { '200': 'the whole file', '206': 'the range asked for', '416': 'range past the end' } });
  app.get(`${DOC}/recordings/:recording/audio`, async (c) => {
    const { document } = await scopedDocumentById(ctx, c, 'viewer');
    return audioResponse(ctx, await found(ctx, document.id, c.req.param('recording')), c.req.header('range'));
  });

  reg.add({ method: 'delete', path: `${DOC}/recordings/:recording`, summary: 'Delete a voice walkthrough and its audio', tag: 'recordings', params: ['id', 'recording'], auth: 'author', responses: { '204': 'deleted' } });
  app.delete(`${DOC}/recordings/:recording`, async (c) => {
    const { p, document } = await scopedDocumentById(ctx, c, 'author');
    await deleteRecording(ctx, { orgId: p.orgId, userId: p.userId, who: who(p), surface: p.surface }, document.id, c.req.param('recording'));
    return c.body(null, 204);
  });

  return app;
}

