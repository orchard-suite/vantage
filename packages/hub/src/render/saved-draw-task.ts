/**
 * A saved version drawn as one file, as a render task: loaded with its
 * imports, drawn with its pictures and its workspace's icons, through the
 * same drawing a file on a laptop goes through.
 */
import { drawDocument, drawExplore, drawView, type DocumentArgs, type DrawOutcome, type ExploreArgs, type ViewArgs } from '@vantage/mcp';
import { loadStored, type ImportMap } from '../documents/model.ts';
import { resourcesFrom, type ResourceData } from './resources.ts';

export interface SavedDrawInput {
  readonly yaml: string;
  readonly imports: ImportMap;
  readonly resources: ResourceData;
  /** One view, the whole document, or one view laid out several ways. */
  readonly draw: { readonly view: ViewArgs } | { readonly document: DocumentArgs } | { readonly explore: ExploreArgs };
}

export async function savedDraw(input: SavedDrawInput): Promise<DrawOutcome> {
  const { model, diagnostics } = loadStored(input.yaml, input.imports);
  if (!model) return { diagnostics };
  const res = resourcesFrom(model, input.resources);
  if ('view' in input.draw) return drawView(model, res, input.draw.view, diagnostics);
  if ('explore' in input.draw) return drawExplore(model, res, input.draw.explore, diagnostics);
  return drawDocument(model, res, input.draw.document, diagnostics);
}
