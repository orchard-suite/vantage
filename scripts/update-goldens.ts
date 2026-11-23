/** Rewrites the golden layout signatures after a deliberate engine change. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadModelFromFile } from '@vantage/model';
import { layoutView, GOLDEN_SETS, goldenPath, signature } from '@vantage/layout';

const root = join(import.meta.dir, '..');
for (const set of GOLDEN_SETS) {
  const { model } = loadModelFromFile(join(root, 'examples', set));
  if (!model) throw new Error(`cannot load ${set}`);
  const out: Record<string, string> = {};
  for (const v of model.views) out[v.id] = signature(layoutView(model, v));
  const file = goldenPath(root, set);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${file}: ${Object.keys(out).length} views`);
}
