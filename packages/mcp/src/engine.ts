/**
 * The drawing work behind the local tools, as an interface so the hub can
 * run it on its render threads. Results are plain data that cross a
 * thread: the layout itself stays behind, its size and score come along.
 */
import type { Diagnostic } from '@vantage/model';
import { explore, exportDocument, render, validate, type ExploreRequest, type ExploreResult, type ExportRequest, type ExportResult, type RenderRequest, type Source, type Validation } from '@vantage/server';

export interface RenderOutcome {
  readonly result?: {
    readonly viewId: string;
    readonly svg: string;
    readonly png?: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly metrics: { readonly score: number; readonly notes: readonly string[] };
  };
  readonly diagnostics: readonly Diagnostic[];
}

export interface LocalEngine {
  render(req: RenderRequest): Promise<RenderOutcome>;
  explore(req: ExploreRequest): Promise<{ result?: ExploreResult; diagnostics: readonly Diagnostic[] }>;
  validate(src: Source): Promise<Validation>;
  exportDocument(req: ExportRequest): Promise<{ result?: ExportResult; diagnostics: readonly Diagnostic[] }>;
}

/** Runs the work in this process. */
export const inlineEngine: LocalEngine = {
  async render(req) {
    const r = render(req);
    if (!r.result) return { diagnostics: r.diagnostics };
    const { viewId, svg, png, layout } = r.result;
    return { result: { viewId, svg, ...(png ? { png } : {}), width: layout.width, height: layout.height, metrics: { score: layout.metrics.score, notes: layout.metrics.notes } }, diagnostics: r.diagnostics };
  },
  explore: async (req) => explore(req),
  validate: async (src) => validate(src),
  exportDocument: (req) => exportDocument(req),
};
