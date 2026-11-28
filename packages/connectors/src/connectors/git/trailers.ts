/**
 * The items a commit names (VAN-3026): one `Work: <KEY>` trailer per item,
 * in the message's last paragraph, the way git reads trailers. A message of
 * one paragraph has no trailers. The token is read in any case, as git
 * reads it; a value that is not an item's key is kept apart, never guessed.
 */
import { WORK_KEY } from '../../batch.ts';

export interface WorkTrailers {
  /** The item keys, once each, in the order the message names them. */
  readonly keys: string[];
  /** Values of `Work:` trailers that are not an item's key. */
  readonly bad: string[];
}

export function workTrailers(message: string): WorkTrailers {
  const paragraphs = message.replace(/\r\n/g, '\n').trim().split(/\n[ \t]*\n/);
  if (paragraphs.length < 2) return { keys: [], bad: [] };
  const keys: string[] = [];
  const bad: string[] = [];
  for (const line of paragraphs[paragraphs.length - 1]!.split('\n')) {
    const m = /^work[ \t]*:[ \t]*(.*?)[ \t]*$/i.exec(line);
    if (!m) continue;
    const v = m[1]!;
    if (!WORK_KEY.test(v)) bad.push(v);
    else if (!keys.includes(v)) keys.push(v);
  }
  return { keys, bad };
}
