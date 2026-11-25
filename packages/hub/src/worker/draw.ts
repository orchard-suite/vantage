/**
 * Drawing one version across the render threads: plan it, draw its ranges
 * side by side, then check each range that started from a guess (the
 * anchors the last render left on the view before it) against the anchors
 * that view really has now. A range whose guess was wrong is drawn again
 * from the real anchors, so the result is the one a single pass in order
 * draws (document-task.ts).
 */
import type { AppContext } from '../context.ts';
import { sameAnchors, splitRanges, type AnchorList, type DocumentInput, type PlanInput, type PlanOutput, type RangeInput, type RangeView } from '../render/document-task.ts';

export type DrawResult =
  | Exclude<PlanOutput, { kind: 'planned' }>
  | {
      readonly kind: 'rendered';
      readonly digest: string;
      readonly errors: number;
      readonly drift: PlanOutput['drift'];
      readonly shell: string;
      readonly views: readonly RangeView[];
      /** Ranges drawn side by side, and ranges drawn again because their guess was wrong. */
      readonly ranges: number;
      readonly redrawn: number;
    };

/** Where the plan and the ranges run: the render pool, or in place in tests. */
export interface DrawRunner {
  readonly threads: number;
  plan(input: PlanInput): Promise<PlanOutput>;
  range(input: RangeInput): Promise<RangeView[]>;
}

/** A background draw (a source refresh) lets every draw a person waits for go first. */
export function poolRunner(ctx: AppContext, opts: { readonly background?: boolean } = {}): DrawRunner {
  const run = { background: opts.background === true };
  return { threads: Math.max(1, ctx.render.stats().threads), plan: (i) => ctx.render.run('plan', i, run), range: (i) => ctx.render.run('range', i, run) };
}

export async function drawDocument(run: DrawRunner, input: DocumentInput, opts: { readonly previousDigest?: string | undefined } = {}): Promise<DrawResult> {
  const plan = await run.plan({ ...input, previousDigest: opts.previousDigest });
  if (plan.kind !== 'planned') return plan;
  const ranges = splitRanges(plan.views, input.cached, run.threads);
  const guess = (from: number): AnchorList | undefined => {
    const prev = plan.views[from]?.prev;
    return prev !== undefined ? input.cached?.[prev]?.anchors : undefined;
  };
  const results = await Promise.all(ranges.map((r) => run.range({ ...input, from: r.from, to: r.to, incoming: guess(r.from) })));
  let redrawn = 0;
  for (let k = 1; k < ranges.length; k++) {
    const { from, to } = ranges[k]!;
    const prev = plan.views[from]!.prev;
    if (prev === undefined) continue;
    const actual = results.flat().find((v) => v.id === prev)?.anchors;
    if (sameAnchors(actual, guess(from))) continue;
    results[k] = await run.range({ ...input, from, to, incoming: actual });
    redrawn++;
  }
  return { kind: 'rendered', digest: plan.digest, errors: plan.errors, drift: plan.drift, shell: plan.shell, views: results.flat(), ranges: ranges.length, redrawn };
}
