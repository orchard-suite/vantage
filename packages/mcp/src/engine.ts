/**
 * The drawing work behind the local tools, as an interface so the hub can
 * run it on its render threads. Results are plain data that cross a
 * thread: the layout itself stays behind, the drawn file and its notes
 * come along.
 */
import type { Diagnostic } from '@vantage/model';
import { explore, load, resourcesFor, validate, type ExploreRequest, type ExploreResult, type Source, type Validation } from '@vantage/server';
import { drawDocument, drawView, type DocumentArgs, type DrawOutcome, type ViewArgs } from './draw.ts';

export interface LocalEngine {
  /** One view of a file or of text, as one file. */
  drawView(req: Source & ViewArgs): Promise<DrawOutcome>;
  /** The whole document, or the views named, as one file. */
  drawDocument(req: Source & DocumentArgs): Promise<DrawOutcome>;
  explore(req: ExploreRequest): Promise<{ result?: ExploreResult; diagnostics: readonly Diagnostic[] }>;
  validate(src: Source): Promise<Validation>;
}

/** Loads a file or text with the icons and pictures on this machine, then draws it. */
async function loaded(src: Source, draw: (m: NonNullable<ReturnType<typeof load>['model']>, d: readonly Diagnostic[]) => Promise<DrawOutcome>): Promise<DrawOutcome> {
  const { model, diagnostics } = load(src);
  return model ? draw(model, diagnostics) : { diagnostics };
}

/** Runs the work in this process. */
export const inlineEngine: LocalEngine = {
  drawView: (req) => loaded(req, (m, d) => drawView(m, resourcesFor(m), req, d)),
  drawDocument: (req) => loaded(req, (m, d) => drawDocument(m, resourcesFor(m), req, d)),
  explore: async (req) => explore(req),
  validate: async (src) => validate(src),
};
