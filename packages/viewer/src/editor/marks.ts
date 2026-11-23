/**
 * What the editor marks in the text, worked out without a browser: the
 * checker's diagnostics placed on their lines, and the conflict markers a
 * merge leaves where both sides changed the same lines.
 */

export type MarkSeverity = 'error' | 'warning' | 'info';

/** One problem at one line of the text, 1-based. */
export interface EditorMark {
  readonly line: number;
  readonly severity: MarkSeverity;
  readonly message: string;
}

/** A diagnostic as the preview answers it. */
export interface DraftDiagnostic {
  readonly severity: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
}

const CONFLICT = /^(<{7} yours|={7}|>{7} saved)$/;

/** The lines a merge marked as conflicts, each one an error the author must clear before a save. */
export function conflictMarks(text: string): EditorMark[] {
  const out: EditorMark[] = [];
  text.split('\n').forEach((l, i) => {
    if (CONFLICT.test(l)) out.push({ line: i + 1, severity: 'error', message: l.startsWith('<') ? 'Your lines start here. Keep the lines you want and delete the markers.' : l.startsWith('=') ? 'The saved lines start here.' : 'The saved lines end here.' });
  });
  return out;
}

/** How many places a merge marked as changed on both sides. */
export function conflictCount(text: string): number {
  return text.split('\n').filter((l) => l === '<<<<<<< yours').length;
}

function severityOf(s: string): MarkSeverity {
  return s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'info';
}

/** Splits diagnostics into marks on lines of the text, and the rest, which have no line of their own. */
export function placeDiagnostics(list: readonly DraftDiagnostic[], lines: number): { marks: EditorMark[]; loose: DraftDiagnostic[] } {
  const marks: EditorMark[] = [];
  const loose: DraftDiagnostic[] = [];
  for (const d of list) {
    if (d.line !== undefined && d.line >= 1 && d.line <= lines) marks.push({ line: d.line, severity: severityOf(d.severity), message: d.path ? `${d.path}: ${d.message}` : d.message });
    else loose.push(d);
  }
  return { marks, loose };
}

/** How many errors a list holds. */
export function errorCount(list: readonly { readonly severity: string }[]): number {
  return list.filter((d) => d.severity === 'error').length;
}
