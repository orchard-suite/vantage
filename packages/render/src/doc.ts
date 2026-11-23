/**
 * A doc view's Markdown as the page a reader sees, and what the page points
 * at. A page never copies the model: it names a box (`[[orders-api]]` or
 * `[text](node:orders-api)`), links or embeds a view (`[text](view:requests)`,
 * `![caption](view:requests)`), links a heading of any doc view
 * (`[text](view:rules#R-0019)`), and cites a decision record
 * (`[[decision:SHOP-2001]]` or `[text](decision:SHOP-2001)`), which a hub
 * turns into a link to the record. The viewer fills each of those in from the
 * model on the page. A picture is a web address or a file attached to the
 * document (`![caption](assets/screen.png)`), drawn from what `files` answers
 * for its path; a path that leaves the document's folder draws nothing.
 *
 * Raw HTML in the Markdown is shown as text, never run. Runs in a browser too.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { isDocumentPath } from '@vantage/model';

export interface DocHeading {
  /** The heading's anchor: its `{#id}`, else a slug of its text. */
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export interface DocLink {
  readonly view: string;
  /** A box of a picture, or a heading of a doc view. */
  readonly target?: string;
  /** How the page wrote it: a heading (`#`) or a box (`/`). */
  readonly kind?: 'anchor' | 'node';
}

export interface DocPage {
  readonly html: string;
  readonly headings: readonly DocHeading[];
  /** Model nodes the page names, in order of first mention. */
  readonly nodes: readonly string[];
  /** Views the page embeds as figures. */
  readonly figures: readonly string[];
  /** Views and headings the page links. */
  readonly links: readonly DocLink[];
  /** Decision records the page cites, as written, in order of first mention. */
  readonly decisions: readonly string[];
  /** Item keys the page names (`[[item:VAN-12]]`); a hub fills in their state for each reader. */
  readonly items: readonly string[];
  /** Files attached to the document the page embeds, as paths inside its folder, in order of first mention. */
  readonly files: readonly string[];
  /** Picture paths the page writes that leave the document's folder or are not paths, as written. */
  readonly refused: readonly string[];
  /** The page cut at its headings: what each part names and says, for the checks that read a page's coverage. */
  readonly sections: readonly DocSection[];
}

/** One heading and the prose under it, up to the next heading of any level; the part before the first heading has the id `''`. */
export interface DocSection {
  readonly id: string;
  readonly heading: string;
  /** Boxes the section names, in order of first mention. */
  readonly nodes: readonly string[];
  /** Views the section embeds or links. */
  readonly views: readonly string[];
  /** Its prose as plain text: no code, no link targets. */
  readonly text: string;
  readonly words: number;
}

/** What a page's attached pictures are drawn from: a path inside the document's folder to an href, or undefined when there is no such picture. */
export type DocFiles = (path: string) => string | undefined;

interface Env {
  readonly viewId: string;
  readonly headings: DocHeading[];
  readonly nodes: string[];
  readonly figures: string[];
  readonly links: DocLink[];
  readonly decisions: string[];
  readonly items: string[];
  readonly files: string[];
  readonly refused: string[];
  readonly draw: DocFiles | undefined;
  readonly taken: Set<string>;
}

const ANCHOR = /\s*\{#([A-Za-z0-9][A-Za-z0-9_.:-]*)\}\s*$/;
const REF = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/;

export function anchorSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** `view:rules#R-0019`, `view:requests/orders-api`, or `view:requests`. */
function parseViewRef(ref: string): DocLink {
  const hash = ref.indexOf('#');
  const slash = ref.indexOf('/');
  if (hash >= 0) return { view: ref.slice(0, hash), target: ref.slice(hash + 1), kind: 'anchor' };
  if (slash >= 0) return { view: ref.slice(0, slash), target: ref.slice(slash + 1), kind: 'node' };
  return { view: ref };
}

/** The viewer's route for a link: `#view` or `#view/target`. */
function routeOf(l: DocLink): string {
  return `#${encodeURIComponent(l.view)}${l.target ? `/${encodeURIComponent(l.target)}` : ''}`;
}

/** A picture path as a file of the document: `./` dropped, percent escapes read; undefined when it leaves the folder or is not a path. */
export function docFilePath(src: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(src);
  } catch {
    return undefined;
  }
  while (path.startsWith('./')) path = path.slice(2);
  return isDocumentPath(path) ? path : undefined;
}

function note<T>(list: T[], item: T, same: (a: T) => boolean): void {
  if (!list.some(same)) list.push(item);
}

function build(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  // Only written addresses become links: a file name such as README.md is not a site.
  md.linkify.set({ fuzzyLink: false });
  const esc = md.utils.escapeHtml;
  const allowed = md.validateLink.bind(md);
  md.validateLink = (url) => /^(node|view|decision|item):/i.test(url) || allowed(url);
  // An item a page names: the hub's viewer fills in its live state for a reader who may see it, and leaves the key plain for one who may not.
  const item = (env: Env, key: string, text: string | undefined): string => {
    note(env.items, key, (k) => k === key);
    return `<a class="v-work-ref" data-item="${esc(key)}">${text === undefined ? '' : esc(text || key)}`;
  };
  const decision = (env: Env, ref: string, text: string | undefined): string => {
    note(env.decisions, ref, (d) => d === ref);
    return `<a class="v-decision" data-decision="${esc(ref)}">${text === undefined ? '' : esc(text || ref)}`;
  };

  // `[[node]]` and `[[node|words]]`: a box named in the prose.
  md.inline.ruler.before('link', 'noderef', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
    const m = REF.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const t = state.push('noderef', 'a', 0);
      t.meta = { node: m[1]!.trim(), text: m[2]?.trim() ?? '' };
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules['noderef'] = (tokens, i, _o, env: Env) => {
    const { node, text } = tokens[i]!.meta as { node: string; text: string };
    if (/^decision:/i.test(node)) return `${decision(env, node.slice(9).trim(), text)}</a>`;
    if (/^item:/i.test(node)) return `${item(env, node.slice(5).trim(), text)}</a>`;
    note(env.nodes, node, (n) => n === node);
    return `<a class="v-ref" data-node="${esc(node)}">${esc(text)}</a>`;
  };

  // Headings take their anchor from `{#id}`, else from their words.
  md.core.ruler.push('doc_headings', (state) => {
    const env = state.env as Env;
    state.tokens.forEach((open, i) => {
      if (open.type !== 'heading_open') return;
      const inline = state.tokens[i + 1];
      const kids = inline?.children ?? [];
      const last = kids[kids.length - 1];
      let id: string | undefined;
      if (last?.type === 'text') {
        const m = ANCHOR.exec(last.content);
        if (m) {
          id = m[1]!;
          last.content = last.content.slice(0, m.index);
        }
      }
      const text = kids.filter((k) => k.type === 'text' || k.type === 'code_inline').map((k) => k.content).join('').trim();
      let anchor = id ?? anchorSlug(text);
      for (let n = 2; env.taken.has(anchor); n++) anchor = `${id ?? anchorSlug(text)}-${n}`;
      env.taken.add(anchor);
      open.attrSet('data-anchor', anchor);
      env.headings.push({ id: anchor, text, level: Number(open.tag.slice(1)) });
    });
  });

  const linkOpen = md.renderer.rules['link_open'] ?? ((tokens, i, o, _e, self) => self.renderToken(tokens, i, o));
  md.renderer.rules['link_open'] = (tokens, i, o, env: Env, self) => {
    const t = tokens[i]!;
    const href = t.attrGet('href') ?? '';
    if (/^decision:/i.test(href)) return decision(env, decodeURIComponent(href.slice(9)).trim(), undefined);
    if (/^item:/i.test(href)) return item(env, decodeURIComponent(href.slice(5)).trim(), undefined);
    if (/^node:/i.test(href)) {
      const node = decodeURIComponent(href.slice(5));
      note(env.nodes, node, (n) => n === node);
      return `<a class="v-ref" data-node="${esc(node)}">`;
    }
    if (/^view:/i.test(href) || href.startsWith('#')) {
      const l = href.startsWith('#') ? ({ view: env.viewId, target: decodeURIComponent(href.slice(1)), kind: 'anchor' } as const) : parseViewRef(decodeURIComponent(href.slice(5)));
      note(env.links, l, (a) => a.view === l.view && a.target === l.target);
      return `<a class="v-go" data-view="${esc(l.view)}"${l.target ? ` data-target="${esc(l.target)}"` : ''} href="${esc(routeOf(l))}">`;
    }
    t.attrSet('target', '_blank');
    t.attrSet('rel', 'noopener noreferrer');
    return linkOpen(tokens, i, o, env, self);
  };

  // `![caption](view:id)` embeds a view; any other picture is a web address or a file attached to the document.
  md.renderer.rules['image'] = (tokens, i, _o, env: Env, self) => {
    const t = tokens[i]!;
    const src = t.attrGet('src') ?? '';
    const alt = self.renderInlineAsText(t.children ?? [], md.options, env);
    if (/^view:/i.test(src)) {
      const l = parseViewRef(decodeURIComponent(src.slice(5)));
      note(env.figures, l.view, (v) => v === l.view);
      return `<span class="v-fig" data-view="${esc(l.view)}"${l.target ? ` data-target="${esc(l.target)}"` : ''} data-caption="${esc(alt)}"></span>`;
    }
    if (/^https?:/i.test(src)) return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    const missing = `<span class="v-fig-missing">${esc(alt || src)}</span>`;
    const path = /^[a-z][a-z0-9+.-]*:/i.test(src) ? undefined : docFilePath(src);
    if (path === undefined) {
      note(env.refused, src, (r) => r === src);
      return missing;
    }
    note(env.files, path, (f) => f === path);
    const href = env.draw?.(path);
    return href === undefined ? missing : `<img class="v-file" src="${esc(href)}" alt="${esc(alt)}" data-file="${esc(path)}" loading="lazy">`;
  };

  md.renderer.rules['table_open'] = () => '<div class="v-table"><table>';
  md.renderer.rules['table_close'] = () => '</table></div>';
  return md;
}

let shared: MarkdownIt | undefined;

/**
 * Renders one doc view's Markdown. `viewId` is the view's own id, so
 * `#heading` links stay on the page. Without `files` an attached picture
 * draws as missing; the page still lists it.
 */
export function renderDoc(viewId: string, markdown: string, files?: DocFiles): DocPage {
  shared ??= build();
  const env: Env = { viewId, headings: [], nodes: [], figures: [], links: [], decisions: [], items: [], files: [], refused: [], draw: files, taken: new Set() };
  const tokens: Token[] = shared.parse(markdown, env);
  const html = shared.renderer.render(tokens, shared.options, env);
  return { html, headings: env.headings, nodes: env.nodes, figures: env.figures, links: env.links, decisions: env.decisions, items: env.items, files: env.files, refused: env.refused, sections: sectionsOf(tokens) };
}

/** Cuts the parsed page at its headings, after the heading rule gave each its anchor. */
function sectionsOf(tokens: readonly Token[]): DocSection[] {
  interface Open { id: string; heading: string; nodes: string[]; views: string[]; text: string[] }
  const out: Open[] = [{ id: '', heading: '', nodes: [], views: [], text: [] }];
  let inHeading = false;
  for (const t of tokens) {
    if (t.type === 'heading_open') {
      out.push({ id: t.attrGet('data-anchor') ?? '', heading: '', nodes: [], views: [], text: [] });
      inHeading = true;
      continue;
    }
    if (t.type === 'heading_close') {
      inHeading = false;
      continue;
    }
    if (t.type !== 'inline') continue;
    const cur = out[out.length - 1]!;
    for (const k of t.children ?? []) {
      if (inHeading) {
        if (k.type === 'text' || k.type === 'code_inline') cur.heading += k.content;
        continue;
      }
      if (k.type === 'text') cur.text.push(k.content);
      else if (k.type === 'noderef') {
        const { node, text } = k.meta as { node: string; text: string };
        if (!/^(decision|item):/i.test(node)) note(cur.nodes, node, (n) => n === node);
        if (text) cur.text.push(text);
      } else if (k.type === 'link_open' || k.type === 'image') {
        const href = k.attrGet(k.type === 'image' ? 'src' : 'href') ?? '';
        if (/^node:/i.test(href)) note(cur.nodes, decodeURIComponent(href.slice(5)), (n) => n === decodeURIComponent(href.slice(5)));
        else if (/^view:/i.test(href)) {
          const l = parseViewRef(decodeURIComponent(href.slice(5)));
          note(cur.views, l.view, (v) => v === l.view);
          if (l.kind === 'node' && l.target) note(cur.nodes, l.target, (n) => n === l.target);
        }
      }
    }
  }
  return out
    .filter((s) => s.id !== '' || s.text.length || s.nodes.length || s.views.length)
    .map((s) => {
      const text = s.text.join(' ').replace(/\s+/g, ' ').trim();
      return { id: s.id, heading: s.heading.trim(), nodes: s.nodes, views: s.views, text, words: text ? text.split(' ').length : 0 };
    });
}
