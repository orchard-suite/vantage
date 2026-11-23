/**
 * Checking a pushed body, as a render task: parse the JSON, tell a Backstage
 * catalog document from the push shape, convert or validate it, and return
 * the batch ready to store. A large batch takes real time to check, so it
 * runs here and never holds the web's event loop.
 */
import { z } from 'zod';
import { BatchSchema, convertBackstage, type Batch } from '@vantage/connectors';

/** The push shape with `source` and `observed` optional: the token names the source and the hub stamps the time. */
const PushBatchSchema = BatchSchema.extend({ source: z.string().min(1).optional(), observed: z.string().datetime({ offset: true }).optional() });

export interface PushInput {
  readonly text: string;
  readonly slug: string;
  /** ISO time the hub received it; the batch's time when it names none. */
  readonly receivedAt: string;
  /** Who pushed, recorded with the stored batch. */
  readonly who: string;
}

/** What is stored for the ingest job. */
export interface StoredPush {
  readonly batch: Batch;
  readonly warnings: readonly string[];
  readonly startedAt: string;
  readonly who: string;
}

/**
 * The checked batch comes back as the text to store, not as objects: a
 * large batch costs the receiving thread as much to copy and encode as it
 * cost here to check.
 */
export type PushOutput =
  | { readonly ok: true; readonly shape: 'batch' | 'backstage'; readonly stored: string; readonly entities: number; readonly relations: number; readonly partial: boolean; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly issues: readonly string[] };

function looksBackstage(raw: unknown): boolean {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'object' && first !== null && 'apiVersion' in first;
}

export function checkPush(input: PushInput): PushOutput {
  const checked = check(input);
  if (!checked.ok) return checked;
  const { batch, warnings, shape } = checked;
  const stored: StoredPush = { batch, warnings, startedAt: input.receivedAt, who: input.who };
  return { ok: true, shape, stored: JSON.stringify(stored), entities: batch.entities.length, relations: batch.relations.length, partial: batch.partial ?? false, warnings };
}

function check(input: PushInput): { ok: true; shape: 'batch' | 'backstage'; batch: Batch; warnings: readonly string[] } | { ok: false; error: string; issues: readonly string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(input.text);
  } catch {
    return { ok: false, error: 'body must be JSON', issues: [] };
  }
  if (looksBackstage(raw)) {
    try {
      const converted = convertBackstage(raw, input.slug, input.receivedAt);
      return { ok: true, shape: 'backstage', batch: converted.batch, warnings: converted.warnings };
    } catch (err) {
      return { ok: false, error: 'invalid Backstage document', issues: [(err as Error).message.slice(0, 2000)] };
    }
  }
  const parsed = PushBatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid batch', issues: parsed.error.issues.slice(0, 100).map((i) => `${i.path.join('.') || 'batch'}: ${i.message}`) };
  const warnings = parsed.data.source !== undefined && parsed.data.source !== input.slug ? [`batch names source ${parsed.data.source}; stored under ${input.slug}`] : [];
  return { ok: true, shape: 'batch', batch: { ...parsed.data, source: input.slug, observed: parsed.data.observed ?? input.receivedAt }, warnings };
}
