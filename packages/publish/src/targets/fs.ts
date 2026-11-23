/** Writes artifacts into a directory. The simplest target, and the one tests use. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { timed, type Target } from '../target.ts';

const Config = z.object({ path: z.string().min(1).describe('Directory to write into; created when missing') }).strict();

export const fsTarget: Target<z.output<typeof Config>> = {
  id: 'fs',
  description: 'A directory on the hub host or a mounted share',
  configSchema: Config,
  async publish(ctx, artifacts) {
    const dir = resolve(ctx.config.path);
    ctx.log.info('publish start', { target: 'fs', dir, artifacts: artifacts.length });
    mkdirSync(dir, { recursive: true });
    return timed('fs', async () => {
      const written = artifacts.map((a) => {
        const file = join(dir, a.filename);
        writeFileSync(file, a.bytes);
        ctx.log.debug('wrote', { file, bytes: a.bytes.byteLength });
        return { artifact: a.filename, location: file, bytes: a.bytes.byteLength };
      });
      ctx.log.info('publish end', { target: 'fs', written: written.length });
      return { written, skipped: [] };
    }, ctx.now);
  },
};
