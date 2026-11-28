/**
 * An item's text form (VAN-5002, VAN-3005): a short header of its
 * fields, then its Markdown body when the hub keeps it. Reading an item and
 * writing the same text back changes nothing. A write changes the title,
 * the labels, the parent, the owner, the scope, and the body; the state,
 * the holders, the delegation, and the links are actions, so a write that changes them is refused with the
 * action that does.
 */
import { parse as parseYaml, stringify } from 'yaml';
import { badRequest } from '../http.ts';
import type { Card } from '../tracking/read.ts';
import type { LabelValue } from '../tracking/state.ts';
import { spanText } from '../tracking/dates.ts';
import { rollupText } from '../tracking/milestone.ts';

export interface ItemFields {
  readonly title: string | undefined;
  readonly labels: Readonly<Record<string, LabelValue>>;
  readonly parent: string | undefined;
  /** Who answers for it, and the scope it serves; `none` and an absent field leave it with none. */
  readonly owner: string | undefined;
  readonly scope: string | undefined;
  readonly body: string;
  /** The fields a write may not change, as the text gave them, to compare with the item. */
  readonly fixed: Readonly<Record<string, unknown>>;
}

/** The fields that are actions or the hub's own, and the call that changes each. */
const FIXED: Readonly<Record<string, string>> = {
  item: 'an item keeps its key',
  kind: 'an item keeps its kind',
  state: 'a state changes by a move: vantage_item {"actions":[{"item":"<key>","move":"<state>"}]}',
  asker: 'the person who asked is who made the item',
  holders: 'holders change by hold and release: vantage_item {"actions":[{"item":"<key>","hold":"me"}]}',
  delegated: 'the owner delegates it: vantage_item {"actions":[{"item":"<key>","delegate":true}]}',
  ref: "the owner's key is set when the owner puts the item",
  revision: 'a revision comes with the owner\'s put or with a move that pins one',
  counts: 'notes, files, links, and events are counted by the hub',
  moves: 'the moves open to you come from the lifecycle',
  span: "a parent's span is worked out from its parts' start and end; set them on the parts",
  milestone: 'a milestone rolls up what links toward it; link one with vantage_item {"actions":[{"item":"VAN-12","link":{"rel":"toward","target":"<key>"}}]}',
  proof: 'proof is read from the parts and the proof links; link one with vantage_item {"actions":[{"item":"<key>","link":{"rel":"proof","target":"VAN-12"}}]}',
};

export function itemText(c: Card, body: string): string {
  const header: Record<string, unknown> = {
    item: c.key,
    kind: `${c.kind} ${c.kindName}`,
    title: c.title,
    state: `${c.state} (${c.stateText}, ${c.class.replace('-', ' ')}, since ${c.since})`,
    asker: c.asker ?? 'nobody',
    owner: c.owner ?? 'none',
    ...(c.scope ? { scope: c.scope } : {}),
    ...(c.delegated ? { delegated: c.delegated } : {}),
    holders: [...c.holders],
    ...(c.claim ? { claim: c.claim } : {}),
    ...(Object.keys(c.labels).length ? { labels: { ...c.labels } } : {}),
    ...(c.parent ? { parent: c.parent } : {}),
    ...(c.ref ? { ref: c.ref } : {}),
    ...(c.revision ? { revision: c.revision } : {}),
    counts: `notes ${c.counts.notes}, files ${c.counts.files}, links ${c.counts.links}, events ${c.counts.events}`,
    ...(c.proof ? { proof: c.proof } : {}),
    ...(c.span ? { span: spanText(c.span) } : {}),
    ...(c.milestone ? { milestone: rollupText(c.milestone) } : {}),
    moves: c.moves.length ? [...c.moves] : 'none open to you',
  };
  const text = `---\n${stringify(header, { lineWidth: 0 })}---\n`;
  return c.hasBody ? `${text}\n${body.trim()}\n` : text;
}

/** A blank item an agent fills in, for a kind's outline. */
export function itemTemplate(labels: readonly { readonly name: string; readonly type: string; readonly choices?: readonly string[] | undefined }[], hasBody: boolean): string {
  const lines = ['---', 'title: What the work is, as a short sentence'];
  if (labels.length) {
    lines.push('labels:');
    for (const l of labels) lines.push(`  ${l.name}: ${l.type === 'choice' ? l.choices![0] : l.type === 'date' ? '2026-01-31' : l.type === 'text' ? 'a short value' : 1}`);
  }
  lines.push('---');
  if (hasBody) lines.push('', 'What done looks like, and anything the next person must know.');
  return lines.join('\n');
}

export function parseItemText(text: string): ItemFields {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw badRequest('an item starts with its fields between --- lines, then its body; vantage_read the item for its form');
  let head: Record<string, unknown>;
  try {
    head = (parseYaml(m[1]!) ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw badRequest(`the item's fields do not parse: ${(err as Error).message}`);
  }
  if (typeof head !== 'object' || Array.isArray(head)) throw badRequest("the item's fields are a YAML map");
  // The live run is shown for as long as its claim holds, and a write never sets it, so a copy read while it held still writes.
  const known = new Set(['title', 'labels', 'parent', 'owner', 'scope', 'claim', ...Object.keys(FIXED)]);
  const stray = Object.keys(head).filter((k) => !known.has(k));
  if (stray.length) throw badRequest(`an item has no field ${stray.join(', ')}; its fields: title, labels, parent, owner, scope`);
  const labels = head['labels'] ?? {};
  if (typeof labels !== 'object' || Array.isArray(labels) || labels === null) throw badRequest('labels is a map of name to value');
  for (const [k, v] of Object.entries(labels)) if (typeof v !== 'string' && typeof v !== 'number') throw badRequest(`label ${k} is a flat value; a nested value or a list is never a label`);
  const fixed = Object.fromEntries(Object.entries(head).filter(([k]) => k in FIXED));
  return {
    title: typeof head['title'] === 'string' ? head['title'] : head['title'] === undefined ? undefined : String(head['title']),
    labels: labels as Record<string, LabelValue>,
    parent: typeof head['parent'] === 'string' ? head['parent'] : undefined,
    owner: typeof head['owner'] === 'string' ? head['owner'] : undefined,
    scope: typeof head['scope'] === 'string' ? head['scope'] : undefined,
    body: m[2]!.replace(/^\n/, '').replace(/\n$/, ''),
    fixed,
  };
}

/** Refuses a write that changes a field only an action or the hub sets, naming the action. */
export function refuseFixed(before: ItemFields, after: ItemFields, key: string): void {
  for (const [field, why] of Object.entries(FIXED)) {
    if (!(field in after.fixed)) continue;
    if (JSON.stringify(after.fixed[field]) !== JSON.stringify(before.fixed[field])) throw badRequest(`${field} is not written in ${key}'s text: ${why.replace('<key>', key)}`);
  }
}
