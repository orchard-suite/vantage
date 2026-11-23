/** The lines a part names in a thing's text: a heading in Markdown, a path in YAML, a definition in the schema, or a line range in any. */
import { countLines, lineRange, markdownRange, schemaPart, type Range } from '@vantage/mcp';
import { pathLines } from '../documents/edit.ts';
import { badRequest } from '../http.ts';
import type { TextThing } from './things.ts';

export interface PartText {
  readonly text: string;
  /** The lines of the thing the text is, counting from 1; absent for a part that is not a run of lines. */
  readonly range?: Range;
  readonly total: number;
}

/** The part of a thing, or the whole of it when no part is named. Throws 400 naming how to list the parts when there is no such part. */
export function partOfThing(thing: TextThing, part: string | undefined): PartText {
  const total = countLines(thing.text);
  if (part === undefined) return { text: thing.text, range: { from: 1, to: total }, total };
  if (thing.kind === 'json') {
    const text = schemaPart(part);
    if (text === undefined) throw badRequest(`schema has no part ${part}; vantage_outline schema lists them`);
    return { text, total };
  }
  const range = thing.kind === 'yaml' ? (lineRange(part, total) ?? pathLines(thing.text, part)) : markdownRange(thing.text, part);
  if (!range) throw badRequest(`${thing.address} has no part ${part}; vantage_outline ${thing.address} lists its parts`);
  return { text: thing.text.split('\n').slice(range.from - 1, range.to).join('\n'), range, total };
}
