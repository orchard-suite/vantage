/**
 * A stress document: a large example with its views copied until the
 * document holds about `views` of them. The nodes and relations stay as
 * they are; each copy gets its own view id and title, so every copy is a
 * view of its own to lay out and draw.
 *
 *   bun scripts/bench/stress.ts [file.vantage.yaml] [--views 160] > stress.vantage.yaml
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const STRESS_BASE = join(import.meta.dir, '..', '..', 'examples', 'harbor', 'harbor.vantage.yaml');

/** `yaml` with its views copied to `views` in total; `yaml` must end with its `views:` block. */
export function stressDocument(yaml: string, views: number): string {
  const at = yaml.search(/^views:\n/m);
  if (at < 0) throw new Error('the document has no views block');
  const head = yaml.slice(0, at);
  const block = yaml.slice(at + 'views:\n'.length);
  const items = block.split(/(?=^ {2}- id: )/m).filter((s) => s.startsWith('  - id: '));
  if (/^\S/m.test(block)) throw new Error('the views block must be the last top-level key');
  const out = items.map((s) => s.trimEnd());
  for (let copy = 1; out.length < views; copy++) {
    for (const item of items) {
      if (out.length >= views) break;
      out.push(copyOf(item, copy).trimEnd());
    }
  }
  return `${head}views:\n${out.join('\n\n')}\n`;
}

function copyOf(item: string, copy: number): string {
  return item
    .replace(/^ {2}- id: (\S+)/, `  - id: $1-copy-${copy}`)
    .replace(/^( {4}title: )(.+)$/m, (_m, key: string, title: string) => {
      const quote = title[0] === '"' || title[0] === "'" ? title[0] : '';
      return quote ? `${key}${title.slice(0, -1)} ${copy}${quote}` : `${key}${title} ${copy}`;
    });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((a) => a.endsWith('.yaml')) ?? STRESS_BASE;
  const at = args.indexOf('--views');
  process.stdout.write(stressDocument(readFileSync(file, 'utf8'), at >= 0 ? Number(args[at + 1]) : 160));
}
