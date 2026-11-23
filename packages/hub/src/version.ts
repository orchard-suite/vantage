import { readFileSync } from 'node:fs';

/** The release this process runs, from the root package.json the image ships. */
export const HUB_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();
