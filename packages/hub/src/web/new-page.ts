/**
 * The new diagram page at /new: pick a start (blank or an example), name
 * it, choose the workspace, and write YAML in the code editor while the
 * picture redraws beside it; or, when the hub has a model API, describe
 * the system in words and get a draft in the same editor. The page's
 * client is the editor bundle (/editor.js). The preview goes through
 * POST /api/v1/preview and saves nothing; Create posts the text to the
 * documents API.
 */
import type { AccessibleWorkspace } from '../authz.ts';
import type { AgentSetup } from '../agents.ts';
import type { HomeDocument } from './home-data.ts';
import { escapeHtml } from './html.ts';
import { appPage } from './frame.ts';
import { frameWorkspaces, type HomeUser } from './home.ts';
import { ico } from './icons.ts';
import { spaceName } from './library.ts';
import { starters, type Starter } from './starters.ts';
import { HUB_VERSION } from '../version.ts';
import { MAX_DESCRIPTION_CHARS, MAX_NOTES_CHARS } from '../api/generate.ts';
import type { Allowance } from '../revise/limits.ts';

export interface NewPageModel {
  readonly nonce: string;
  readonly csrf?: string;
  readonly user: HomeUser;
  /** Where the diagram will be saved; the reader may change it to any workspace they edit. */
  readonly workspace: AccessibleWorkspace;
  readonly workspaces: readonly AccessibleWorkspace[];
  readonly documents: readonly HomeDocument[];
  readonly starter: Starter;
  readonly agents: AgentSetup;
  /** Present when the hub has a model API: the models on offer and what the reader has left to spend. */
  readonly describe?: { readonly models: readonly string[]; readonly defaultModel: string; readonly allowance: Allowance } | undefined;
}

/** The Describe it panel; the editor bundle fills the models and the allowance from the page's JSON. */
function describePanel(): string {
  return `<section class="new-describe" id="new-describe" aria-label="Describe it" hidden>
<div class="f-row"><label class="f-label" for="new-desc">Describe the system</label><textarea class="field new-desc" id="new-desc" maxlength="${MAX_DESCRIPTION_CHARS}" placeholder="Shoppers use a web app that calls an orders API. The API writes to Postgres and puts events on a queue that a worker reads to send email."></textarea><span class="f-hint">Say what exists, what talks to what, and the questions the diagram should answer.</span></div>
<details class="new-paste"><summary>Paste notes</summary><div class="f-row"><label class="f-label" for="new-paste">Notes</label><textarea class="field" id="new-paste" maxlength="${MAX_NOTES_CHARS}" placeholder="An inventory, a README, meeting notes: facts the model may use."></textarea></div></details>
<div class="new-gen-row"><select class="field" id="new-model" aria-label="Model"></select><button class="btn primary" type="button" id="new-gen" disabled>Generate</button><p class="f-hint" id="new-gen-allow"></p></div>
<p class="f-hint" id="new-gen-state" aria-live="polite"></p>
</section>`;
}

export function newDiagramHtml(m: NewPageModel): string {
  const editable = m.workspaces.filter((w) => w.role === 'author');
  const options = editable.map((w) => `<option value="${escapeHtml(w.slug)}"${w.id === m.workspace.id ? ' selected' : ''}>${escapeHtml(spaceName(w, m.user.id))}</option>`).join('');
  const from = starters()
    .map((s) => `<a class="chip" href="/new?in=${encodeURIComponent(m.workspace.slug)}${s.id === 'blank' ? '' : `&amp;from=${encodeURIComponent(s.id)}`}"${s.id === m.starter.id ? ' aria-pressed="true" aria-current="page"' : ''}>${s.id === 'blank' ? `${ico('plus', 14)}Blank` : escapeHtml(s.title)}</a>`)
    .join('');
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${ico('right', 12)}<span aria-current="page">New diagram</span></nav>
<form class="new" id="new" data-editor="new" aria-labelledby="new-title">
<header class="new-head"><h1 id="new-title">New diagram</h1><p>Write what exists in YAML: boxes, what they talk to, and the views that answer a question. Vantage lays it out as you type.</p></header>
<div class="new-from" role="group" aria-label="Start from">${from}</div>
${m.describe ? `<div class="seg" id="new-mode" role="group" aria-label="How to start" hidden><button type="button" data-mode="yaml" aria-pressed="true">${ico('code', 14)}Write YAML</button><button type="button" data-mode="describe" aria-pressed="false">${ico('chat', 14)}Describe it</button></div>${describePanel()}` : ''}
<div id="new-draft" aria-live="polite"></div>
<div class="new-grid">
<section class="new-edit" aria-label="The file">
<div class="new-meta"><div class="f-row"><label class="f-label" for="new-name">Name</label><input class="field" id="new-name" placeholder="${escapeHtml(m.starter.title)}" autocomplete="off"><span class="f-hint">Leave it empty to use the title in the file.</span></div>
<div class="f-row"><label class="f-label" for="new-ws">Save to</label><select class="field" id="new-ws">${options}</select></div></div>
<div class="f-row" style="flex:1"><label class="f-label" for="new-yaml">YAML</label><textarea class="field new-yaml" id="new-yaml" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${escapeHtml(m.starter.yaml)}</textarea><div class="new-code" id="new-code" hidden></div></div>
</section>
<section class="new-prev" aria-label="Preview"><div class="bar2"><b>Preview</b><select class="field" id="new-view" aria-label="View" hidden></select><span class="score" id="new-score"></span><span class="state" id="new-state" aria-live="polite">Loading the editor</span></div>
<div class="new-canvas plus" id="new-canvas"><img id="new-img" alt="Preview of the diagram" hidden><p class="none-here" id="new-empty" hidden><b>Nothing to draw yet.</b> Add a box under <code>nodes</code> and a view under <code>views</code>.</p></div>
<div class="new-notes" id="new-notes" aria-live="polite"></div></section>
</div>
<div id="new-error" role="alert"></div>
<footer class="new-foot"><span class="f-hint">Agents can keep editing it too: the file lives in the workspace like any other diagram.</span><a class="btn" href="/">Cancel</a><button class="btn primary" id="new-go">Create diagram</button></footer>
</form>${m.describe ? `<script type="application/json" id="new-ai">${JSON.stringify(m.describe).replace(/</g, '\\u003c')}</script>` : ''}<script nonce="${escapeHtml(m.nonce)}" src="/editor.js?v=${HUB_VERSION}"></script>`;
  const { spaces, shared, starred } = frameWorkspaces(m.workspaces, m.documents, m.user.id);
  return appPage({ title: 'New diagram', nonce: m.nonce, ...(m.csrf ? { csrf: m.csrf } : {}), user: m.user, workspaces: spaces, sharedCount: shared, starredCount: starred, place: { kind: 'other' }, agents: m.agents, body });
}
