import { loadModelFromFile, formatDiagnostic } from '@vantage/model';
import { layoutView } from '@vantage/layout';
import { renderSvg, renderPng, FileIconSource } from '@vantage/render';
import { writeFileSync, mkdirSync } from 'node:fs';

const [file, outDir = 'out'] = process.argv.slice(2);
if (!file) throw new Error('usage: render-example <file> [outDir]');
const { model, diagnostics } = loadModelFromFile(file);
for (const d of diagnostics) console.log(formatDiagnostic(d));
if (!model) process.exit(1);
mkdirSync(outDir, { recursive: true });
const icons = new FileIconSource();
for (const view of model.views) {
  const t0 = performance.now();
  const layout = layoutView(model, view);
  const svg = renderSvg(layout, { icons });
  const ms = (performance.now() - t0).toFixed(0);
  writeFileSync(`${outDir}/${view.id}.svg`, svg);
  writeFileSync(`${outDir}/${view.id}.png`, renderPng(svg).bytes);
  console.log(`${view.id.padEnd(14)} ${layout.width}x${layout.height} score=${layout.metrics.score} crossings=${layout.metrics.crossings} boxCross=${layout.metrics.edgeBoxCrossings} labelOverlap=${layout.metrics.labelOverlaps} ${ms}ms`);
  for (const n of layout.metrics.notes) console.log(`   note: ${n}`);
}
