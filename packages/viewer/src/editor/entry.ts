/**
 * The editor bundle (editor.js): CodeMirror and the YAML editor, kept out
 * of the viewer so readers never load it. The viewer loads it when an
 * author opens Edit YAML; the New page loads it with the page and wires
 * itself here.
 */
import { createCodeEditor } from './code.ts';
import { bootNewPage } from './new-page.ts';
import './kit.ts';

window.VantageEditor = { create: createCodeEditor };
if (document.getElementById('new')?.dataset['editor'] === 'new') bootNewPage();
