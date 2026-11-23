/** The authoring guide agents receive. The markdown in docs/ is the source. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GUIDE = join(import.meta.dir, '..', '..', '..', 'docs', 'agent-guide.md');

let cached: string | undefined;
export function authoringGuide(): string {
  cached ??= readFileSync(GUIDE, 'utf8');
  return cached;
}
