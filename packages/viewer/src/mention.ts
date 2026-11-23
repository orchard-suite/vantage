/**
 * Mentions in the comment box. Typing `@` offers the people who can read
 * the document; picking one writes `@Name` in the box and remembers whose
 * name it is, and the comment goes to the hub with `<@id>` in its place.
 * A comment's text shows each `<@id>` as the person's name.
 */
import { h } from './dom.ts';
import type { HubPerson } from './hub.ts';

const TOKEN = /<@([^<>\s]{1,200})>/g;
/** How far back from the caret an `@` still starts a mention. */
const MAX_QUERY = 40;
const MAX_OFFERED = 6;

/** The `@` being typed at the caret and the words after it, or undefined when the caret is not in one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || caret - at > MAX_QUERY) return undefined;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return undefined;
  const query = before.slice(at + 1);
  if (/[\n<>@]/.test(query)) return undefined;
  return { start: at, query };
}

/** People whose name starts a word with the query, those starting the whole name first. */
export function matchPeople(people: readonly HubPerson[], query: string): HubPerson[] {
  const q = query.trim().toLowerCase();
  const hit = (p: HubPerson): number => {
    const name = p.label.toLowerCase();
    if (name.startsWith(q)) return 0;
    return name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : -1;
  };
  return people
    .map((p) => ({ p, rank: hit(p) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.p.label.localeCompare(b.p.label))
    .slice(0, MAX_OFFERED)
    .map((x) => x.p);
}

/** The text with every `@Name` the writer picked as `<@id>`; longer names first, so a name inside another never wins. */
export function encodeMentions(text: string, picked: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [label, id] of [...picked].sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${label}`).join(`<@${id}>`);
  return out;
}

/** A comment's text as nodes, each `<@id>` a highlighted name. */
export function mentionNodes(text: string, labels: Readonly<Record<string, string>>): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(h('span', 'v-mention', `@${labels[m[1]!] ?? 'someone'}`));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

let seq = 0;

/**
 * Wires a textarea for mentions: a list of matching people under it while
 * an `@` is typed, arrows and Enter or Tab to pick, Escape to close. Picks
 * go into `picked`, name to id, which the caller keeps across redraws.
 */
export function attachMentions(text: HTMLTextAreaElement, people: () => Promise<readonly HubPerson[]>, picked: Map<string, string>): HTMLElement {
  const wrap = h('div', 'v-mention-wrap');
  const list = h('ul', 'v-mention-list');
  const listId = `v-mention-list-${++seq}`;
  list.id = listId;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'People to mention');
  list.hidden = true;
  text.setAttribute('aria-autocomplete', 'list');
  text.setAttribute('aria-controls', listId);
  text.setAttribute('aria-expanded', 'false');
  wrap.append(text, list);
  let offered: HubPerson[] = [];
  let active = 0;
  let known: readonly HubPerson[] | undefined;

  const close = (): void => {
    offered = [];
    list.hidden = true;
    list.replaceChildren();
    text.setAttribute('aria-expanded', 'false');
    text.removeAttribute('aria-activedescendant');
  };
  const pick = (p: HubPerson): void => {
    const at = mentionQuery(text.value, text.selectionStart);
    if (!at) return close();
    const insert = `@${p.label} `;
    text.value = text.value.slice(0, at.start) + insert + text.value.slice(text.selectionStart);
    const caret = at.start + insert.length;
    text.setSelectionRange(caret, caret);
    picked.set(p.label, p.id);
    close();
    text.dispatchEvent(new Event('input'));
    text.focus();
  };
  const draw = (): void => {
    list.replaceChildren();
    offered.forEach((p, i) => {
      const item = h('li', `v-mention-item${i === active ? ' active' : ''}`, p.label);
      item.id = `${listId}-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === active));
      // Pointer down, not click, so the textarea keeps its caret.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(p);
      });
      list.appendChild(item);
    });
    list.hidden = !offered.length;
    text.setAttribute('aria-expanded', String(offered.length > 0));
    if (offered.length) text.setAttribute('aria-activedescendant', `${listId}-${active}`);
    else text.removeAttribute('aria-activedescendant');
  };
  const update = async (): Promise<void> => {
    const at = mentionQuery(text.value, text.selectionStart);
    if (!at) return close();
    known ??= await people().catch(() => []);
    offered = matchPeople(known, at.query);
    active = 0;
    draw();
  };

  text.addEventListener('input', (e) => {
    if (e.isTrusted) void update();
  });
  text.addEventListener('keydown', (e) => {
    if (!offered.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : offered.length - 1)) % offered.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(offered[active]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  text.addEventListener('blur', close);
  return wrap;
}
