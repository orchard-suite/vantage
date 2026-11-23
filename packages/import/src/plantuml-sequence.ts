/**
 * PlantUML sequence diagrams to a sequence: participant declarations (with
 * aliases), messages, notes, refs, return, create and destroy, and the alt,
 * else, opt, loop, par, break, critical, and group blocks. A dashed arrow
 * is a reply, `->>` is async. Dividers, delays, and activations are dropped.
 */
import { declName, readArrow } from './plantuml-syntax.ts';
import { edgeLabel, ParseNotes, SequenceBuilder, unquote, type SequenceDiagram } from './text-diagram.ts';

const DECLARE = /^(create\s+)?(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/;
const TYPES: Readonly<Record<string, string>> = { actor: 'actor', database: 'database', queue: 'queue' };
const NOTE = /^[rh]?note\s+(left|right|over)(?:\s+of)?\s*([^:]*?)\s*(?::\s*(.*))?$/i;
const REF = /^ref\s+over\s+([^:]+?)\s*(?::\s*(.*))?$/i;
const BLOCK = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/;

export function parsePlantumlSequence(lines: readonly string[], notes: ParseNotes): SequenceDiagram {
  const seq = new SequenceBuilder(notes);
  const aliases = new Map<string, string>();
  /** Calls in the order made, and the ones activated (by `activate` or `++`), for `return` to answer. */
  const calls: { from: string; to: string }[] = [];
  const active: { from: string; to: string }[] = [];
  let title: string | undefined;
  let renamed = 0;
  /** A participant as a message writes it: an alias, a declared name, or a new participant. */
  const ref = (raw: string): string => {
    const name = unquote(raw.trim());
    return aliases.get(name) ?? name;
  };
  let multi: { over: string[]; prefix: string; end: RegExp; text: string[] } | undefined;
  let last: string | undefined;

  for (const line of lines) {
    if (multi) {
      if (multi.end.test(line)) {
        seq.note(multi.over, `${multi.prefix}${multi.text.join(' ')}`.trim());
        multi = undefined;
      } else multi.text.push(line);
      continue;
    }
    const t = /^title\s+(.+)$/.exec(line);
    if (t) {
      title = t[1]!.trim();
      continue;
    }
    const decl = DECLARE.exec(line);
    if (decl && !readArrow(line)) {
      const { key, label } = declName(decl[3]!);
      if (label !== key) aliases.set(label, key);
      seq.participant(key, label, TYPES[decl[2]!]);
      if (decl[1]) seq.create(key);
      continue;
    }
    const create = /^create\s+(\S+)$/.exec(line);
    if (create) {
      seq.create(ref(create[1]!));
      continue;
    }
    const destroy = /^destroy\s+(\S+)$/.exec(line);
    if (destroy) {
      seq.destroy(ref(destroy[1]!));
      continue;
    }
    const note = NOTE.exec(line);
    if (note) {
      const over = note[2]!.split(',').map((s) => s.trim()).filter(Boolean).map(ref);
      const target = over.length ? over : last !== undefined ? [last] : [];
      if (!target.length) {
        notes.warn(`${line}: a note with no participant; skipped`);
        continue;
      }
      if (note[3] !== undefined) seq.note(target, edgeLabel(note[3]) ?? '');
      else multi = { over: target, prefix: '', end: /^end\s?[rh]?note$/i, text: [] };
      continue;
    }
    const r = REF.exec(line);
    if (r) {
      const over = r[1]!.split(',').map((s) => ref(s));
      if (r[2] !== undefined) seq.note(over, `ref: ${edgeLabel(r[2]) ?? ''}`);
      else multi = { over, prefix: 'ref: ', end: /^end\s?ref$/i, text: [] };
      continue;
    }
    const block = BLOCK.exec(line);
    if (block && !readArrow(line)) {
      const op = block[1]!, cond = block[2]!.trim();
      if (op === 'break' || op === 'critical' || op === 'group') {
        renamed++;
        seq.open(op === 'critical' ? 'alt' : 'opt', `${op}${cond ? `: ${cond}` : ''}`);
      } else seq.open(op as 'alt' | 'opt' | 'loop' | 'par', cond);
      continue;
    }
    const branch = /^else\b\s*(.*)$/.exec(line);
    if (branch) {
      seq.branch(branch[1]!.trim(), 'else');
      continue;
    }
    if (/^box\b/.test(line)) {
      notes.ignore('box blocks');
      seq.openTransparent();
      continue;
    }
    if (/^end(\s+box)?$/.test(line)) {
      if (!seq.close()) notes.warn('end with no open block; skipped');
      continue;
    }
    const ret = /^return\b\s*(.*)$/.exec(line);
    if (ret) {
      const call = active.pop() ?? calls.pop();
      if (call) seq.message(call.to, call.from, edgeLabel(ret[1]), 'reply');
      else notes.warn(`${line}: return with no call to return from; skipped`);
      continue;
    }
    if (/^==.*==$/.test(line) || /^\.\.\.|^\|\|\|/.test(line)) {
      notes.ignore('dividers and delays');
      continue;
    }
    const activation = /^(activate|deactivate)\s+(\S+)/.exec(line);
    if (activation) {
      const who = ref(activation[2]!);
      if (activation[1] === 'activate') {
        const call = [...calls].reverse().find((c) => c.to === who);
        if (call) active.push(call);
      } else {
        const i = active.map((c) => c.to).lastIndexOf(who);
        if (i >= 0) active.splice(i, 1);
      }
      continue;
    }
    const ignored = /^(autonumber|newpage|hide|show|skinparam|mainframe)\b/.exec(line);
    if (ignored) {
      notes.ignore(`${ignored[1]} lines`);
      continue;
    }
    const arrow = readArrow(line);
    if (arrow) {
      if (/hidden/.test(arrow.body)) continue;
      const a = ref(arrow.from), b = ref(arrow.to);
      const back = arrow.start.startsWith('<') && !arrow.end.startsWith('>');
      const from = back ? b : a, to = back ? a : b;
      if (arrow.marks === '**') seq.create(to);
      const dashed = /--|\.|dashed|dotted/.test(arrow.body);
      const kind = dashed ? 'reply' : arrow.end === '>>' || arrow.start === '<<' ? 'async' : 'sync';
      seq.message(from, to, arrow.label, kind);
      if (arrow.marks === '!!') seq.destroy(to);
      if (arrow.marks === '++') active.push({ from, to });
      if (arrow.marks === '--') active.pop();
      if (kind === 'sync' && from !== to) calls.push({ from, to });
      last = to;
      continue;
    }
    notes.unparsed(line);
  }
  if (multi) notes.warn('a note never closed with end note; kept');
  if (renamed) notes.warn(`${renamed} break, critical, or group block${renamed === 1 ? '' : 's'} drawn as opt or alt with the keyword in the condition`);
  const { participants, steps } = seq.finish();
  return { kind: 'sequence', title, participants, steps };
}
