import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFile } from './importing.ts';
import { validate } from './core.ts';

const fixture = join(import.meta.dir, '..', '..', 'import', 'fixtures', 'swimlanes.drawio');

describe('importFile', () => {
  test('writes the document beside a copy of the original and the result validates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-import-'));
    try {
      const r = importFile({ file: fixture, out: dir });
      expect(r.written?.document).toBe(join(dir, 'swimlanes.vantage.yaml'));
      expect(r.written?.original).toBe(join(dir, 'swimlanes.original.drawio'));
      expect(readFileSync(r.written!.original)).toEqual(readFileSync(fixture));
      const v = validate({ file: r.written!.document });
      expect(v.ok).toBe(true);
      expect(v.views.map((x) => x.id)).toEqual(['checkout-lanes']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('without out nothing is written', () => {
    const r = importFile({ file: fixture, pageIndex: 0 });
    expect(r.written).toBeUndefined();
    expect(r.report.pages).toHaveLength(1);
    expect(existsSync('swimlanes.vantage.yaml')).toBe(false);
  });
});
