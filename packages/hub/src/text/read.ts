/**
 * Read: the text of one or many addresses or parts, inside one size limit.
 * Past the limit the answer stops at a line and names the call that reads
 * on. A thing whose version the caller already holds answers one line.
 */
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { BUDGET, guideOutline, schemaOutline } from '@vantage/mcp';
import { parseAddress, partOf, type Address } from './address.ts';
import { taught, topicOf } from './teach.ts';
import { partOfThing } from './parts.ts';
import { readThing } from './things.ts';
import { itemPart, placeAddress } from './items.ts';

export interface ReadAnswer {
  readonly text: string;
  readonly isError: boolean;
}

export async function read(ctx: AppContext, p: Principal, addresses: readonly string[], held: Readonly<Record<string, string>> = {}, limit: number = BUDGET.readChars): Promise<ReadAnswer> {
  const out: string[] = [];
  let room = limit;
  let failed = 0;
  const later: string[] = [];
  for (const raw of addresses) {
    if (room <= 0) {
      later.push(raw);
      continue;
    }
    let placed: Address | undefined;
    try {
      const a = await placeAddress(ctx, p, parseAddress(raw));
      placed = a;
      const part = partOf(a);
      const special = a.kind === 'item' && part !== undefined ? await itemPart(ctx, p, a.key, part) : undefined;
      if (special !== undefined) {
        const body = special.length > room ? `${special.slice(0, room)}\n--- stopped at the size limit ---` : special;
        out.push(`=== ${raw} ===\n${body}`);
        room -= body.length;
        continue;
      }
      if ((a.kind === 'guide' || a.kind === 'schema') && part === undefined) {
        const o = a.kind === 'guide' ? guideOutline() : schemaOutline();
        out.push(`=== ${a.kind}: read it by part ===\n${o}`);
        room -= o.length;
        continue;
      }
      const thing = await readThing(ctx, p, a);
      const mine = held[raw] ?? held[thing.address];
      if (mine !== undefined && mine === thing.version) {
        out.push(`=== ${raw}  version ${thing.version}  unchanged ===`);
        continue;
      }
      const piece = partOfThing(thing, part);
      const lines = piece.text.split('\n');
      let taken = 0;
      let used = 0;
      while (taken < lines.length && used + lines[taken]!.length + 1 <= room) used += lines[taken++]!.length + 1;
      // One line longer than the room still answers, cut, so a read always moves forward.
      const body = taken === 0 ? lines[0]!.slice(0, Math.max(200, room)) : lines.slice(0, taken).join('\n');
      if (taken === 0) taken = 1;
      const from = piece.range?.from ?? 1;
      const span = piece.range ? `  lines ${from}-${from + taken - 1} of ${piece.total}` : '';
      out.push(`=== ${thing.address}${part ? `#${part}` : ''}  version ${thing.version}${span} ===\n${body}`);
      room -= body.length;
      if (taken < lines.length) {
        const next = piece.range ? `${thing.address}#L${from + taken}-${piece.range.to}` : raw;
        out.push(`--- stopped at the size limit, ${lines.length - taken} lines left. more: vantage_read {"addresses":["${next}"]} ---`);
        room = 0;
      }
    } catch (err) {
      failed += 1;
      out.push(`=== ${raw}: ${taught(err, topicOf(placed))} ===`);
    }
  }
  if (later.length) out.push(`--- not read, the answer was full. more: vantage_read {"addresses":${JSON.stringify(later)}} ---`);
  return { text: out.join('\n\n'), isError: failed === addresses.length };
}
