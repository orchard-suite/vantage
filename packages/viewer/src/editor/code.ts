/**
 * The YAML editor: CodeMirror with YAML highlighting, line numbers, undo,
 * and the checker's problems drawn at their lines. It lives in its own
 * bundle (editor.js), so readers who never edit never load it. Colors come
 * from the shared tokens as CSS variables, so it follows the page's theme.
 */
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import type { EditorMark } from './marks.ts';

export interface CodeEditorOptions {
  readonly parent: HTMLElement;
  readonly text: string;
  /** The accessible name of the text area. */
  readonly label: string;
  readonly onChange: (text: string) => void;
  /** Cmd or Ctrl and S. */
  readonly onSave?: () => void;
}

export interface CodeEditor {
  text(): string;
  /** Replaces the whole text as one undoable change; the change listener hears it like typing. */
  setText(text: string): void;
  /** Draws these problems at their lines, replacing the ones drawn before. */
  mark(marks: readonly EditorMark[]): void;
  /** Puts the cursor at the start of a line and scrolls it into view. */
  goTo(line: number): void;
  focus(): void;
  destroy(): void;
}

const highlight = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: 'var(--code-key)', fontWeight: '500' },
  { tag: tags.string, color: 'var(--code-string)' },
  { tag: tags.special(tags.string), color: 'var(--code-string)' },
  { tag: tags.content, color: 'var(--ink)' },
  { tag: tags.lineComment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: tags.labelName, color: 'var(--code-atom)' },
  { tag: [tags.typeName, tags.keyword, tags.meta], color: 'var(--code-meta)' },
  { tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace], color: 'var(--code-punct)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', background: 'var(--sunken)', color: 'var(--ink)', fontSize: 'var(--fs-m)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': { background: 'var(--sunken)', color: 'var(--faint)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--hover) 70%, transparent)' },
  '.cm-activeLineGutter': { background: 'var(--hover)', color: 'var(--ink2)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'var(--accent-soft)' },
  '.cm-matchingBracket': { background: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--bad-ink)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn-ink)', textUnderlineOffset: '3px' },
  '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted var(--muted)', textUnderlineOffset: '3px' },
  '.cm-tooltip': { background: 'var(--raise)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', boxShadow: 'var(--shadow2)' },
  '.cm-diagnostic': { padding: '6px 10px', fontFamily: 'var(--font)', fontSize: 'var(--fs-s)', borderLeftWidth: '3px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--bad-ink)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn-ink)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--muted)' },
  '.cm-gutter-lint': { width: '14px' },
});

export function createCodeEditor(o: CodeEditorOptions): CodeEditor {
  const view = new EditorView({
    parent: o.parent,
    state: EditorState.create({
      doc: o.text,
      extensions: [
        lineNumbers(),
        lintGutter(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        indentOnInput(),
        bracketMatching(),
        yaml(),
        syntaxHighlighting(highlight),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': o.label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (o.onSave?.(), true) }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) o.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    text: () => view.state.doc.toString(),
    setText(text) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    mark(marks) {
      const doc = view.state.doc;
      const list: Diagnostic[] = marks.map((m) => {
        const line = doc.line(Math.min(Math.max(1, m.line), doc.lines));
        // A blank line gets a one character range at its end so the gutter still shows it.
        return { from: line.from, to: line.to > line.from ? line.to : Math.min(line.from + 1, doc.length), severity: m.severity, message: m.message };
      });
      view.dispatch(setDiagnostics(view.state, list));
    },
    goTo(n) {
      const doc = view.state.doc;
      const line = doc.line(Math.min(Math.max(1, n), doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      view.focus();
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
