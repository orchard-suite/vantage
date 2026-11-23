/**
 * The New page's client, in the editor bundle: the YAML in the code
 * editor, the picture redrawn beside it a moment after typing stops with
 * the checker's problems at their lines, Create, and (when the hub has a
 * model API) Describe it, whose draft lands in the same editor unsaved.
 */
import { createCodeEditor, type CodeEditor } from './code.ts';
import { errorCount, placeDiagnostics, type DraftDiagnostic } from './marks.ts';
import { Describe, type DescribeSetup } from './describe.ts';
import { headers } from './http.ts';

const DRAW_DELAY_MS = 650;
/** Problems listed under the preview at most; every one is marked at its line. */
const LISTED = 5;

interface Preview {
  readonly svg: string | null;
  readonly view: string | null;
  readonly views: readonly { readonly id: string; readonly title: string }[];
  readonly diagnostics: readonly DraftDiagnostic[];
  readonly metrics: { readonly score: number; readonly notes: readonly string[] } | null;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the new page has no #${id}`);
  return el as T;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function bootNewPage(): void {
  const form = byId<HTMLFormElement>('new');
  const fallback = byId<HTMLTextAreaElement>('new-yaml');
  const host = byId<HTMLDivElement>('new-code');
  const name = byId<HTMLInputElement>('new-name');
  const ws = byId<HTMLSelectElement>('new-ws');
  const pick = byId<HTMLSelectElement>('new-view');
  const img = byId<HTMLImageElement>('new-img');
  const canvas = byId<HTMLDivElement>('new-canvas');
  const empty = byId<HTMLParagraphElement>('new-empty');
  const notes = byId<HTMLDivElement>('new-notes');
  const state = byId<HTMLSpanElement>('new-state');
  const score = byId<HTMLSpanElement>('new-score');
  const go = byId<HTMLButtonElement>('new-go');
  const err = byId<HTMLDivElement>('new-error');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let errors = 0;

  const label = (): string => (errors ? 'Create anyway' : 'Create diagram');
  const soon = (): void => {
    clearTimeout(timer);
    state.textContent = 'Waiting for you to pause';
    timer = setTimeout(draw, DRAW_DELAY_MS);
  };
  const editor: CodeEditor = createCodeEditor({ parent: host, text: fallback.value, label: 'YAML', onChange: soon, onSave: () => form.requestSubmit() });
  fallback.hidden = true;
  host.hidden = false;

  const list = (d: readonly DraftDiagnostic[], layout: readonly string[]): void => {
    notes.replaceChildren();
    for (const x of d.slice(0, LISTED)) {
      const b = el(x.line !== undefined ? 'button' : 'div', `banner ${x.severity === 'error' ? 'bad' : 'warn'}`);
      if (x.line !== undefined) {
        const line = x.line;
        b.setAttribute('type', 'button');
        b.addEventListener('click', () => editor.goTo(line));
        b.append(el('span', 'ln', `Line ${line}`));
      }
      b.append(el('span', undefined, (x.path ? `${x.path}: ` : '') + x.message));
      notes.append(b);
    }
    for (const n of layout) notes.append(el('div', 'note', n));
  };

  function draw(): void {
    const n = ++seq;
    const text = editor.text();
    canvas.classList.add('busy');
    state.textContent = 'Drawing';
    const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    fetch('/api/v1/preview', { method: 'POST', headers: headers(), credentials: 'same-origin', body: JSON.stringify({ yaml: text, view: pick.value || undefined, theme }) })
      .then(async (r) => {
        const j = (await r.json()) as Preview & { error?: string };
        if (!r.ok) throw new Error(j.error ?? `the preview answered ${r.status}`);
        return j;
      })
      .then((j) => {
        if (n !== seq) return;
        canvas.classList.remove('busy');
        const keep = pick.value;
        pick.replaceChildren(
          ...j.views.map((v) => {
            const o = el('option', undefined, v.title) as HTMLOptionElement;
            o.value = v.id;
            o.selected = v.id === (j.view ?? keep);
            return o;
          }),
        );
        pick.hidden = j.views.length < 2;
        if (j.svg) img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(j.svg)}`;
        img.hidden = !j.svg;
        empty.hidden = Boolean(j.svg);
        editor.mark(placeDiagnostics(j.diagnostics, text.split('\n').length).marks);
        list(j.diagnostics, j.metrics?.notes ?? []);
        score.textContent = j.metrics ? `Score ${j.metrics.score}` : '';
        score.dataset['tone'] = !j.metrics ? '' : j.metrics.score >= 80 ? 'ok' : j.metrics.score >= 60 ? 'warn' : 'bad';
        errors = errorCount(j.diagnostics);
        state.textContent = errors ? (errors === 1 ? '1 problem' : `${errors} problems`) : j.diagnostics.length ? 'Drawn, with notes' : 'Up to date';
        go.textContent = label();
      })
      .catch((x: unknown) => {
        if (n !== seq) return;
        canvas.classList.remove('busy');
        state.textContent = `Could not draw: ${(x as Error).message}`;
      });
  }

  pick.addEventListener('change', draw);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go.disabled = true;
    go.textContent = 'Creating';
    err.replaceChildren();
    const body: Record<string, string> = { yaml: editor.text() };
    if (name.value.trim()) body['name'] = name.value.trim();
    fetch(`/api/v1/workspaces/${encodeURIComponent(ws.value)}/documents`, { method: 'POST', headers: headers(), credentials: 'same-origin', body: JSON.stringify(body) })
      .then(async (r) => {
        const j = (await r.json()) as { error?: string; document?: { slug: string } };
        if (!r.ok || !j.document) throw new Error(j.error ?? 'That did not work.');
        location.href = `/w/${encodeURIComponent(ws.value)}/${encodeURIComponent(j.document.slug)}`;
      })
      .catch((x: unknown) => {
        const a = el('div', 'banner bad');
        a.append(el('span', undefined, (x as Error).message));
        err.append(a);
        go.disabled = false;
        go.textContent = label();
      });
  });

  const setup = document.getElementById('new-ai')?.textContent;
  if (setup) new Describe(JSON.parse(setup) as DescribeSetup, { workspace: () => ws.value, draft: (yaml) => editor.setText(yaml), focusEditor: () => editor.focus() });
  draw();
}
