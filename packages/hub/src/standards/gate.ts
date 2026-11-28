/**
 * The machine gate (VAN-3018): it runs on every build, and an edition it
 * refuses is never published. Each problem is one sentence that names the
 * line, pack, or page and what would set it right. Running a pack's
 * fixtures is the judge's half of the gate, when it installs the edition.
 */
import { LINE_MAX } from '../decisions/types.ts';
import type { EditionBody } from './model.ts';
import { scopeName } from './model.ts';
import type { StandardSetting } from './setting.ts';

export interface GateFacts {
  readonly setting: StandardSetting;
  /** The records that stand: accepted, with a position, in a team workspace. */
  readonly records: ReadonlySet<string>;
  /** The team workspaces, by slug; a personal workspace's lines and pages never leave it. */
  readonly team: ReadonlySet<string>;
}

/** The pack a rule id belongs to: the part before its first dot, as a judge names its rules (telemetry.build-info). */
export const packOfRule = (rule: string): string => rule.split('.')[0] ?? rule;

export function machineGate(body: EditionBody, facts: GateFacts): string[] {
  const { setting } = facts;
  const out: string[] = [];
  const packs = new Map<string, string[]>();
  for (const p of body.packs) packs.set(p.pack, [...(packs.get(p.pack) ?? []), scopeName(p.from)]);
  for (const [pack, from] of packs) if (from.length > 1) out.push(`pack ${pack} reaches from ${from.join(' and ')}; a pack reaches a scope once, so adopt it in one place`);
  for (const l of body.lines) {
    const x = l.position;
    if (!facts.records.has(l.record)) out.push(`${l.ref}: no accepted record with a position stands behind this line any more`);
    if (!facts.team.has(l.workspace)) out.push(`${l.ref}: its workspace ${l.workspace} is not a team workspace, and a personal record never reaches a standard`);
    if (!setting.bindings.includes(x.binding)) out.push(`${l.ref}: binding "${x.binding}" is not on the estate's list (${setting.bindings.join(', ')})`);
    const strangers = x.binds.filter((b) => !setting.binds.includes(b));
    if (strangers.length) out.push(`${l.ref}: binds ${strangers.join(', ')}, not on the estate's list (${setting.binds.join(', ')})`);
    if (x.line.length > LINE_MAX) out.push(`${l.ref}: its line is ${x.line.length} characters; a line is at most ${LINE_MAX}`);
    for (const rule of x.checked_by) if (!packs.has(packOfRule(rule))) out.push(`${l.ref}: checked by ${rule}, but no pack ${packOfRule(rule)} reaches this scope (standard#packs)`);
    for (const d of l.departs ?? []) {
      const from = body.lines.find((x) => x.record === d);
      if (from) out.push(`${l.ref}: departs from ${from.ref} with no exception in force (VAN-3020); grant one or change the record`);
    }
  }
  for (const p of body.pages) {
    const ws = p.page.split('/')[0] ?? '';
    if (!facts.team.has(ws)) out.push(`page ${p.page} is not in a team workspace, and a personal page never reaches a standard`);
  }
  if (setting.withhold.length) {
    const text = JSON.stringify(body).toLowerCase();
    for (const word of setting.withhold) if (text.includes(word.toLowerCase())) out.push(`the edition holds "${word}", a word that may not leave the estate (standard#withhold)`);
  }
  return out;
}
