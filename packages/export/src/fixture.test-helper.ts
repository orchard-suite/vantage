/** Laid out views of the example documents, shared by the export tests. */
import { join } from 'node:path';
import { loadModelFromFile } from '@vantage/model';
import { layoutView, type Layout } from '@vantage/layout';
import { FileIconSource } from '@vantage/render';

const EXAMPLES = join(import.meta.dir, '..', '..', '..', 'examples');

export const icons = new FileIconSource();

export function layoutsOf(example: 'shop' | 'harbor', ids: readonly string[]): Layout[] {
  const { model } = loadModelFromFile(join(EXAMPLES, example, `${example}.vantage.yaml`));
  if (!model) throw new Error(`${example} example failed to load`);
  return ids.map((id) => {
    const view = model.views.find((v) => v.id === id);
    if (!view) throw new Error(`no view ${id}`);
    return layoutView(model, view);
  });
}
