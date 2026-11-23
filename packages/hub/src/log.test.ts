import { describe, expect, test } from 'bun:test';
import { createLogger } from './log.ts';

describe('log', () => {
  test('a line leads with timestamp, level, and msg, and no field replaces them', () => {
    const lines: string[] = [];
    const log = createLogger('info', { write: (l) => lines.push(l) }, { service: 'hub' });
    log.info('job.end', { msg: 'mine', level: 'debug', kind: 'render' });
    log.debug('hidden');
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(line).slice(0, 3)).toEqual(['timestamp', 'level', 'msg']);
    expect(line).toMatchObject({ level: 'info', msg: 'job.end', service: 'hub', kind: 'render' });
    expect(line['trace_id']).toBeUndefined();
  });
});
