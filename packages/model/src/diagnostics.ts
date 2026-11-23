/** A problem found while parsing, resolving, laying out, or linting a document. */
export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  readonly severity: Severity;
  /** Stable machine code such as `unknown-node` or `view-without-relations`. */
  readonly code: string;
  readonly message: string;
  /** Path inside the YAML document, for example `views[2].relations[0].to`. */
  readonly path?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  /** What to do about it, written for an agent that will edit the file. */
  readonly hint?: string;
}

export class DiagnosticBag {
  readonly items: Diagnostic[] = [];
  constructor(private readonly file?: string) {}

  add(d: Omit<Diagnostic, 'file'>): void {
    this.items.push(this.file === undefined ? d : { ...d, file: this.file });
  }
  error(code: string, message: string, extra: Partial<Diagnostic> = {}): void {
    this.add({ severity: 'error', code, message, ...extra });
  }
  warn(code: string, message: string, extra: Partial<Diagnostic> = {}): void {
    this.add({ severity: 'warning', code, message, ...extra });
  }
  info(code: string, message: string, extra: Partial<Diagnostic> = {}): void {
    this.add({ severity: 'info', code, message, ...extra });
  }
  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }
}

/**
 * The guide topic that explains the rule behind each code: a heading of
 * docs/agent-guide.md, by its name in the address guide#<topic>. An agent
 * learns a rule when it breaks it, so every code has one; a test fails on
 * a code with none or a topic the guide does not have.
 */
export const DIAGNOSTIC_TOPICS: Readonly<Record<string, string>> = {
  'yaml-syntax': 'the-three-parts-of-a-file',
  'empty-document': 'the-three-parts-of-a-file',
  'no-source': 'the-three-parts-of-a-file',
  'import-missing': 'the-three-parts-of-a-file',
  'import-cycle': 'the-three-parts-of-a-file',
  'language-version': 'themes-and-versions',
  'unknown-type': 'nodes',
  'unknown-profile': 'nodes',
  'unknown-node': 'nodes',
  'duplicate-id': 'nodes',
  'bad-icon-id': 'infrastructure-vendor-icons',
  'unknown-icon': 'infrastructure-vendor-icons',
  'duplicate-icon': 'your-own-icons-and-pictures',
  'missing-asset': 'your-own-icons-and-pictures',
  'file-missing': 'your-own-icons-and-pictures',
  'unknown-relation': 'relations',
  'unknown-view': 'relation-view',
  'duplicate-view': 'relation-view',
  'no-views': 'relation-view',
  'view-without-relations': 'relation-view',
  'extends-cycle': 'relation-view',
  'empty-path': 'paths-numbered-journeys',
  'unknown-step': 'paths-numbered-journeys',
  'sequence-step': 'sequence-view',
  'unknown-lane': 'flow-view-flowchart-optional-swimlanes',
  'timeline-date': 'timeline',
  'unknown-item': 'timeline',
  'doc-file-missing': 'doc-a-page-of-prose',
  'doc-file-outside': 'doc-a-page-of-prose',
  'doc-source': 'doc-a-page-of-prose',
  'doc-unknown-target': 'doc-a-page-of-prose',
  'doc-copied-fact': 'doc-a-page-of-prose',
  'doc-section-unnamed': 'doc-a-page-of-prose',
  'doc-box-unmentioned': 'doc-a-page-of-prose',
  'docs-page-missing': 'docs-that-stay-true',
  'artifact-path': 'docs-that-stay-true',
  'artifact-missing': 'docs-that-stay-true',
  'evidence-unknown-target': 'docs-that-stay-true',
  'evidence-path': 'docs-that-stay-true',
  'evidence-missing': 'docs-that-stay-true',
  'duplicate-state': 'lifecycle-how-a-kind-of-item-moves',
  'unknown-state': 'lifecycle-how-a-kind-of-item-moves',
  'duplicate-move': 'lifecycle-how-a-kind-of-item-moves',
  'kind-lifecycle': 'lifecycle-how-a-kind-of-item-moves',
  'bad-decision-ref': 'decision-records-in-a-hub',
  'unknown-decision': 'decision-records-in-a-hub',
  'decision-moved': 'decision-records-in-a-hub',
  'layout-failed': 'how-the-layout-works-so-you-can-steer-it',
};

/** Where to read the rule a code is about: `guide#<topic>`. */
export function topicOf(code: string): string | undefined {
  const topic = DIAGNOSTIC_TOPICS[code];
  return topic ? `guide#${topic}` : undefined;
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.file, d.line !== undefined ? `${d.line}:${d.column ?? 1}` : undefined].filter(Boolean).join(':');
  const head = `${d.severity} ${d.code}${where ? ` at ${where}` : ''}${d.path ? ` (${d.path})` : ''}`;
  const topic = d.severity === 'error' ? topicOf(d.code) : undefined;
  const line = `${head}: ${d.message}${topic ? ` (${topic})` : ''}`;
  return d.hint ? `${line}\n  hint: ${d.hint}` : line;
}
