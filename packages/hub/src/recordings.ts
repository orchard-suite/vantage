/**
 * Voice walkthroughs: an author's audio over one view's walkthrough or
 * numbered paths, with the moment each step was shown. The audio is one
 * object in the blob store under recordings/<org>/<id>; the row holds the
 * view, the version it was made on, the length, the type, and the step
 * timeline. A recording is never changed after it is saved; it is deleted
 * on its own or with its document.
 */
import { z } from 'zod';
import type { AppContext } from './context.ts';
import type { Db } from './db/db.ts';
import { maybe } from './db/db.ts';
import { randomId } from './crypto.ts';
import { audit, type Surface } from './audit.ts';
import { badRequest, HttpError, notFound } from './http.ts';

/** The audio types a browser records in: opus in WebM or Ogg (Chrome, Firefox), AAC in MP4 (Safari). */
export const RECORDING_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
export type RecordingType = (typeof RECORDING_TYPES)[number];

/** Room in a request body past the audio for the multipart framing and the metadata. */
const FORM_OVERHEAD = 256 * 1024;

/** One step shown during a recording: when, which path (0 for a walkthrough), which step (-1 is a path's overview), and the boxes it lit. */
export const TimelineEntrySchema = z.object({
  at: z.number().int().min(0),
  path: z.number().int().min(0).max(99),
  step: z.number().int().min(-1).max(999),
  boxes: z.array(z.string().min(1).max(200)).max(50).default([]),
});
export type TimelineEntry = z.output<typeof TimelineEntrySchema>;

export const RecordingMetaSchema = z.object({
  view: z.string().min(1).max(200),
  version: z.string().min(1).max(200),
  durationMs: z.number().int().min(1),
  /** The type the browser recorded in (MediaRecorder's mimeType); a form part's own type is not trusted, since servers guess it from the file name. */
  type: z.string().min(1).max(100),
  timeline: z.array(TimelineEntrySchema).min(1).max(5000),
});
export type RecordingMeta = z.output<typeof RecordingMetaSchema>;

export interface RecordingRow {
  readonly id: string;
  readonly org_id: string;
  readonly document_id: string;
  readonly view_id: string;
  readonly version_id: string;
  readonly author_user_id: string | null;
  readonly duration_ms: number;
  readonly mime_type: RecordingType;
  readonly size_bytes: number;
  readonly blob_key: string;
  readonly timeline: readonly TimelineEntry[];
  readonly created_at: Date;
}

export interface RecordingLimits {
  readonly maxSeconds: number;
  readonly maxBytes: number;
}

export function recordingLimits(config: AppContext['config']): RecordingLimits {
  return { maxSeconds: config.RECORDING_MAX_SECONDS, maxBytes: config.RECORDING_MAX_MB * 1024 * 1024 };
}

/** The largest request body an upload may send. */
export function uploadBodyLimit(limits: RecordingLimits): number {
  return limits.maxBytes + FORM_OVERHEAD;
}

export function recordingKey(orgId: string, id: string): string {
  return `recordings/${orgId}/${id}`;
}

/** The base audio type of a content type the browser named (`audio/webm;codecs=opus` is `audio/webm`), or undefined when it is not one we keep. */
export function recordingType(contentType: string): RecordingType | undefined {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return RECORDING_TYPES.find((t) => t === base);
}

export interface Recorder {
  readonly orgId: string;
  readonly userId: string;
  readonly who: string;
  readonly surface: Surface;
}

export interface NewRecording {
  readonly documentId: string;
  readonly meta: RecordingMeta;
  readonly audio: Uint8Array;
}

/**
 * Checks the audio against the limits and the version against the
 * document, stores the audio, then the row. A row that fails to land takes
 * its audio back out.
 */
export async function createRecording(ctx: AppContext, by: Recorder, input: NewRecording): Promise<RecordingRow> {
  const limits = recordingLimits(ctx.config);
  const type = recordingType(input.meta.type);
  const refuse = (outcome: string, err: HttpError): never => {
    ctx.metrics.recordings.add(1, { outcome });
    ctx.log.warn('recording.refused', { documentId: input.documentId, outcome, bytes: input.audio.byteLength, durationMs: input.meta.durationMs });
    throw err;
  };
  if (!type) return refuse('bad_type', badRequest(`audio must be one of ${RECORDING_TYPES.join(', ')}`));
  if (!input.audio.byteLength) return refuse('empty', badRequest('the recording has no audio'));
  if (input.audio.byteLength > limits.maxBytes) return refuse('too_large', new HttpError(413, `a recording may be at most ${ctx.config.RECORDING_MAX_MB} MB`));
  if (input.meta.durationMs > limits.maxSeconds * 1000) return refuse('too_long', badRequest(`a recording may be at most ${Math.floor(limits.maxSeconds / 60)} minutes`));
  const version = await maybe<{ id: string }>(ctx.db, 'select id from versions where id = $1 and document_id = $2', [input.meta.version, input.documentId]);
  if (!version) return refuse('bad_version', badRequest('the version is not one of this document'));
  const timeline = [...input.meta.timeline].map((e) => ({ ...e, at: Math.min(e.at, input.meta.durationMs) })).sort((a, b) => a.at - b.at);
  const id = randomId();
  const key = recordingKey(by.orgId, id);
  await ctx.blob.put(key, input.audio, type);
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.query(
        'insert into recordings (id, org_id, document_id, view_id, version_id, author_user_id, duration_ms, mime_type, size_bytes, blob_key, timeline) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [id, by.orgId, input.documentId, input.meta.view, version.id, by.userId, input.meta.durationMs, type, input.audio.byteLength, key, JSON.stringify(timeline)],
      );
      await audit(tx, ctx.log, { orgId: by.orgId, who: by.who, what: 'recording.create', surface: by.surface, target: `document:${input.documentId}`, details: { recordingId: id, viewId: input.meta.view, versionId: version.id, durationMs: input.meta.durationMs, bytes: input.audio.byteLength } });
    });
  } catch (err) {
    await ctx.blob.delete(key);
    throw err;
  }
  ctx.metrics.recordings.add(1, { outcome: 'created' });
  ctx.metrics.recordingBytes.add(input.audio.byteLength, { action: 'stored' });
  ctx.log.info('recording.created', { documentId: input.documentId, recordingId: id, viewId: input.meta.view, versionId: version.id, durationMs: input.meta.durationMs, bytes: input.audio.byteLength, type, steps: timeline.length });
  return (await recordingById(ctx.db, input.documentId, id))!;
}

export async function listRecordings(db: Db, documentId: string, opts: { view?: string | undefined } = {}): Promise<RecordingRow[]> {
  return opts.view
    ? db.query<RecordingRow>('select * from recordings where document_id = $1 and view_id = $2 order by created_at desc', [documentId, opts.view])
    : db.query<RecordingRow>('select * from recordings where document_id = $1 order by created_at desc', [documentId]);
}

export async function recordingById(db: Db, documentId: string, id: string): Promise<RecordingRow | undefined> {
  return maybe<RecordingRow>(db, 'select * from recordings where document_id = $1 and id = $2', [documentId, id]);
}

export async function deleteRecording(ctx: AppContext, by: Recorder, documentId: string, id: string): Promise<void> {
  const row = await ctx.db.transaction(async (tx) => {
    const gone = await tx.query<{ blob_key: string; size_bytes: number; view_id: string }>('delete from recordings where document_id = $1 and id = $2 returning blob_key, size_bytes, view_id', [documentId, id]);
    if (!gone[0]) throw notFound('recording');
    await audit(tx, ctx.log, { orgId: by.orgId, who: by.who, what: 'recording.delete', surface: by.surface, target: `document:${documentId}`, details: { recordingId: id, viewId: gone[0].view_id } });
    return gone[0];
  });
  await ctx.blob.delete(row.blob_key);
  ctx.metrics.recordings.add(1, { outcome: 'deleted' });
  ctx.metrics.recordingBytes.add(row.size_bytes, { action: 'released' });
  ctx.log.info('recording.deleted', { documentId, recordingId: id, by: by.userId });
}

/** The blob keys of a document's recordings, read before the document goes so its audio can follow. */
export async function recordingKeys(db: Db, documentId: string): Promise<string[]> {
  return (await db.query<{ blob_key: string }>('select blob_key from recordings where document_id = $1', [documentId])).map((r) => r.blob_key);
}

/** Audio in the blob store no recording names: its document or workspace went, or its row never landed. */
export async function dropOrphanRecordings(ctx: AppContext, orgId: string): Promise<number> {
  const keys = await ctx.blob.list(`recordings/${orgId}/`);
  if (!keys.length) return 0;
  const named = new Set((await ctx.db.query<{ blob_key: string }>('select blob_key from recordings where blob_key = any($1)', [keys])).map((r) => r.blob_key));
  let removed = 0;
  for (const key of keys) {
    if (named.has(key)) continue;
    await ctx.blob.delete(key);
    removed++;
  }
  if (removed) ctx.log.info('gc.recordings.removed', { orgId, removed });
  return removed;
}

export function publicRecording(r: RecordingRow, authorLabel: string | null, head: string | null): Record<string, unknown> {
  return {
    id: r.id,
    documentId: r.document_id,
    view: r.view_id,
    version: r.version_id,
    /** True when the document has moved on since: the viewer says so and skips steps whose boxes are gone. */
    olderVersion: head !== null && r.version_id !== head,
    author: r.author_user_id,
    authorLabel,
    durationMs: r.duration_ms,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    timeline: r.timeline,
    createdAt: r.created_at,
  };
}

export type ByteRange = { readonly start: number; readonly end: number };

/**
 * One byte range from a Range header against a body of `size` bytes:
 * undefined for no header or one we do not serve (several ranges, other
 * units), so the whole body goes out; 'unsatisfiable' for a range past the end.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | undefined {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) return undefined;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** The audio of a recording as a response, whole or the one range asked for; the bytes never change, so it caches for good. */
export async function audioResponse(ctx: AppContext, row: RecordingRow, rangeHeader: string | undefined): Promise<Response> {
  const bytes = await ctx.blob.get(row.blob_key);
  if (!bytes) throw new HttpError(500, 'recording audio missing', { recordingId: row.id });
  const base = { 'content-type': row.mime_type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable', etag: `"${row.id}"` };
  const range = parseRange(rangeHeader, bytes.byteLength);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${bytes.byteLength}` } });
  if (!range) return new Response(bytes.slice(), { status: 200, headers: { ...base, 'content-length': String(bytes.byteLength) } });
  const part = bytes.slice(range.start, range.end + 1);
  return new Response(part, { status: 206, headers: { ...base, 'content-length': String(part.byteLength), 'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}` } });
}
