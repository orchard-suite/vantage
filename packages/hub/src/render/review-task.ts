/** The nightly review of one document, as a render task: diagnostics, the mean layout score, and the drift count against what is observed now. */
import { layoutView } from '@vantage/layout';
import { drift, type ObservedModel } from '@vantage/connectors';
import { loadOverlaid, type ImportMap } from '../documents/model.ts';

export interface ReviewInput {
  readonly yaml: string;
  readonly imports: ImportMap;
  readonly observed: ObservedModel;
}

export interface ReviewOutput {
  readonly errors: number;
  readonly score: number;
  readonly drift: number;
  readonly failedViews: readonly { readonly viewId: string; readonly error: string }[];
}

export function reviewDocument(input: ReviewInput): ReviewOutput {
  const { model, diagnostics, declared } = loadOverlaid(input, input.observed);
  const errors = diagnostics.filter((x) => x.severity === 'error').length;
  const failedViews: { viewId: string; error: string }[] = [];
  const scores = (model?.views ?? []).map((v) => {
    try {
      return layoutView(model!, v).metrics.score;
    } catch (err) {
      failedViews.push({ viewId: v.id, error: (err as Error).message });
      return 0;
    }
  });
  const score = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  const report = declared ? drift(declared, input.observed) : undefined;
  const total = report ? report.counts.declaredNotObserved + report.counts.observedNotDeclared + report.counts.factMismatch : 0;
  return { errors, score, drift: total, failedViews };
}
