/** What the editor bundle (editor.js) puts on the page for the viewer and the New page to use. */
import type { createCodeEditor } from './code.ts';

export interface EditorKit {
  readonly create: typeof createCodeEditor;
}

declare global {
  interface Window {
    VantageEditor?: EditorKit;
  }
}
