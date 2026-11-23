/**
 * The drawing work behind the local tools, as an interface so the hub can
 * run it on its render threads. Results are plain data that cross a
 * thread: the layout itself stays behind, the drawn file and its notes
 * come along.
 */
import type { Diagnostic } from '@vantage/model';
import { load, resourcesFor, validate, type Source, type Validation } from '@vantage/server';
import { drawDocument, drawExplore, drawView, type DocumentArgs, type DrawOutcome, type ExploreArgs, type ViewArgs } from './draw.ts';

export interface LocalEngine {
  /** One view of a file or of text, as one file. */
  drawView(req: Source & ViewArgs): Promise<DrawOutcome>;
  /** The whole document, or the views named, as one file. */
  drawDocument(req: Source & DocumentArgs): Promise<DrawOutcome>;
  /** One relation view of a file or of text, laid out several ways on one sheet. */
  drawExplore(req: Source & ExploreArgs): Promise<DrawOutcome>;
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
  drawExplore: (req) => loaded(req, async (m, d) => drawExplore(m, resourcesFor(m), req, d)),
  validate: async (src) => validate(src),
};
