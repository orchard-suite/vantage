/**
 * Mermaid sequenceDiagram to a sequence: participants and actors (with
 * aliases), messages, notes, and the loop, alt, opt, par, critical, and
 * break blocks. Solid arrows are calls, dotted arrows are replies, `-)` is
 * async. Activations and autonumber are drawn by Vantage itself and dropped.
 */
import { edgeLabel, ParseNotes, SequenceBuilder, unquote, type SequenceDiagram } from './text-diagram.ts';

const PARTICIPANT = /^(create\s+)?(participant|actor)\s+(.+?)(?:@\{(.*)\})?(?:\s+as\s+(.+))?$/;
const MESSAGE = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*(?::\s?(.*))?$/;
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i;
const BLOCK = /^(loop|opt|alt|par|critical|break)\b\s*(.*)$/;
const BRANCH = /^(else|and|option)\b\s*(.*)$/;
const TYPES: Readonly<Record<string, string>> = { actor: 'actor', database: 'database', queue: 'queue' };

export function parseMermaidSequence(lines: readonly string[], notes: ParseNotes): SequenceDiagram {
  const seq = new SequenceBuilder(notes);
  let title: string | undefined;
  let blocks = 0;
  for (const line of lines) {
    const p = PARTICIPANT.exec(line);
    if (p) {
      const key = p[3]!.trim();
      const declared = p[4] !== undefined ? /"type"\s*:\s*"(\w+)"/.exec(p[4])?.[1] : undefined;
      const type = p[2] === 'actor' ? 'actor' : declared !== undefined ? TYPES[declared] : undefined;
      seq.participant(key, p[5] !== undefined ? unquote(p[5]) : undefined, type);
      if (p[1]) seq.create(key);
      continue;
    }
    const destroy = /^destroy\s+(.+)$/.exec(line);
    if (destroy) {
      seq.destroy(destroy[1]!.trim());
      continue;
    }
    const t = /^title\s*:?\s*(.+)$/.exec(line);
    if (t) {
      title = t[1]!.trim();
      continue;
    }
    const note = NOTE.exec(line);
    if (note) {
      seq.note(note[2]!.split(',').map((s) => s.trim()).filter(Boolean), edgeLabel(note[3]) ?? '');
      continue;
    }
    const block = BLOCK.exec(line);
    if (block) {
      const op = block[1]!, cond = block[2]!.trim();
      if (op === 'critical') {
        blocks++;
        seq.open('alt', `critical${cond ? `: ${cond}` : ''}`);
      } else if (op === 'break') {
        blocks++;
        seq.open('opt', `break${cond ? `: ${cond}` : ''}`);
      } else seq.open(op as 'loop' | 'opt' | 'alt' | 'par', cond);
      continue;
    }
    const branch = BRANCH.exec(line);
    if (branch) {
      seq.branch(branch[2]!.trim(), branch[1]!);
      continue;
    }
    if (/^(box|rect)\b/.test(line)) {
      notes.ignore(`${line.split(/\s/)[0]} blocks`);
      seq.openTransparent();
      continue;
    }
    if (line === 'end') {
      if (!seq.close()) notes.warn('end with no open block; skipped');
      continue;
    }
    const ignored = /^(autonumber|activate|deactivate|links?|properties|details|accTitle|accDescr)\b/.exec(line);
    if (ignored) {
      notes.ignore(`${ignored[1]} lines`);
      continue;
    }
    const m = MESSAGE.exec(line);
    if (m) {
      const arrow = m[2]!;
      if (m[3]) notes.ignore('activation marks');
      if (arrow.startsWith('<<')) notes.warn(`${line}: a two-way arrow is drawn one way`);
      const kind = arrow.endsWith(')') ? 'async' : arrow.startsWith('--') || arrow.startsWith('<<--') ? 'reply' : 'sync';
      seq.message(m[1]!.trim(), m[4]!.trim(), edgeLabel(m[5]), kind);
      continue;
    }
    notes.unparsed(line);
  }
  if (blocks) notes.warn(`${blocks} critical or break block${blocks === 1 ? '' : 's'} drawn as alt or opt with the keyword in the condition`);
  const { participants, steps } = seq.finish();
  return { kind: 'sequence', title, participants, steps };
}
