import { describe, expect, test } from 'bun:test';
import { conflictCount, conflictMarks, errorCount, placeDiagnostics } from './marks.ts';

describe('editor marks', () => {
  test('conflict markers are errors at their lines, counted per place', () => {
    const text = 'a\n<<<<<<< yours\nmine\n=======\ntheirs\n>>>>>>> saved\nb\n';
    expect(conflictMarks(text).map((m) => [m.line, m.severity])).toEqual([[2, 'error'], [4, 'error'], [6, 'error']]);
    expect(conflictCount(text)).toBe(1);
    expect(conflictMarks('a: ======= not a marker\n')).toEqual([]);
  });

  test('diagnostics with a line inside the text are marked; the rest stay loose', () => {
    const { marks, loose } = placeDiagnostics(
      [
        { severity: 'error', message: 'bad key', path: 'nodes[0]', line: 2 },
        { severity: 'warning', message: 'past the end', line: 40 },
        { severity: 'info', message: 'no line' },
      ],
      10,
    );
    expect(marks).toEqual([{ line: 2, severity: 'error', message: 'nodes[0]: bad key' }]);
    expect(loose.map((d) => d.message)).toEqual(['past the end', 'no line']);
    expect(errorCount([{ severity: 'error' }, { severity: 'warning' }])).toBe(1);
  });
});
