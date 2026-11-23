/**
 * Loads the YAML editor's own bundle the first time an author opens it,
 * from beside the viewer script, so readers never download it.
 */
import type { EditorKit } from './editor/kit.ts';

/** Read while this script first runs: the viewer's own address, beside which the editor bundle sits. */
const viewerSrc = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '';

let loading: Promise<EditorKit> | undefined;

export function loadEditor(): Promise<EditorKit> {
  if (window.VantageEditor) return Promise.resolve(window.VantageEditor);
  loading ??= new Promise<EditorKit>((resolve, reject) => {
    const url = new URL(viewerSrc || '/viewer.js', location.href);
    url.pathname = url.pathname.replace(/viewer\.js$/, 'editor.js');
    const s = document.createElement('script');
    s.src = url.toString();
    s.onload = () => (window.VantageEditor ? resolve(window.VantageEditor) : reject(new Error('the editor did not load')));
    s.onerror = () => {
      loading = undefined;
      reject(new Error('the editor did not load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
