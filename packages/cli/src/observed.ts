/**
 * `render --observed`: lays batches from files (the push shape, one batch
 * or a list) over a document the way the hub does, so a picture with
 * observed facts, freshness, and open items can be drawn from a laptop.
 */
import { readFileSync } from 'node:fs';
import type { DocumentTransform } from '@vantage/model';
import { BatchSchema, emptyObserved, expandObserved, mergeObserved, overlayObserved, type ObservedModel } from '@vantage/connectors';

/** The observed model the batch files build, merged in the order given. */
export function observedFromFiles(files: readonly string[]): ObservedModel {
  let model = emptyObserved();
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    for (const b of Array.isArray(raw) ? raw : [raw]) model = mergeObserved(model, BatchSchema.parse(b)).model;
  }
  return model;
}

/** The transform that draws a document over those batches; open items last reported more than `freshDays` before `now` are stale. */
export function observedTransform(files: readonly string[], freshDays: number, now = new Date()): DocumentTransform {
  const model = observedFromFiles(files);
  return (doc) => overlayObserved(expandObserved(doc, model), model, { now, thresholdDays: freshDays });
}
