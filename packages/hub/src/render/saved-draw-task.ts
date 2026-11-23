/**
 * A saved version drawn as one file, as a render task: loaded with its
 * imports, drawn with its pictures and its workspace's icons, through the
 * same drawing a file on a laptop goes through.
 */
import { drawDocument, drawView, type DocumentArgs, type DrawOutcome, type ViewArgs } from '@vantage/mcp';
import { loadStored, type ImportMap } from '../documents/model.ts';
import { resourcesFrom, type ResourceData } from './resources.ts';

export interface SavedDrawInput {
  readonly yaml: string;
  readonly imports: ImportMap;
  readonly resources: ResourceData;
  /** One view, or the whole document. */
  readonly draw: { readonly view: ViewArgs } | { readonly document: DocumentArgs };
}

export async function savedDraw(input: SavedDrawInput): Promise<DrawOutcome> {
  const { model, diagnostics } = loadStored(input.yaml, input.imports);
  if (!model) return { diagnostics };
  const res = resourcesFrom(model, input.resources);
  return 'view' in input.draw ? drawView(model, res, input.draw.view, diagnostics) : drawDocument(model, res, input.draw.document, diagnostics);
}
