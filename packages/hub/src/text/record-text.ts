/**
 * A decision record's text form: a short header of its fields, then its
 * sections as Markdown. It is what an agent reads, patches, and writes,
 * and what a working copy keeps as a file. Reading a record and writing
 * the same text back changes nothing: a write is compared with the text as
 * it stands, and only the fields that differ are sent on.
 */
import { parse as parseYaml, stringify } from 'yaml';
import { badRequest } from '../http.ts';
import { STANCES, type Alternative, type Decision, type DecisionCreate, type DecisionPatch, type DecisionStatus, type GovernsInput, type Stance } from '../decisions/types.ts';

const SECTIONS = ['Context', 'Decision', 'Consequences', 'Alternatives considered'] as const;

/** What a record's text says, as the fields a write may set. */
export interface RecordFields {
  readonly title: string;
  readonly status: DecisionStatus;
  readonly category: number;
  readonly decidedOn: string | undefined;
  readonly updatedOn: string | undefined;
  readonly deciders: readonly string[];
  readonly alignment: { stance: Stance; rule?: string; note?: string } | null;
  readonly related: readonly string[];
  readonly governs: readonly GovernsInput[];
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly alternatives: readonly Alternative[];
}

const governsText = (g: { workspace?: string; document: string; box?: string | undefined; view?: string | undefined }): string => `${g.workspace ? `${g.workspace}/` : ''}${g.document} ${g.box !== undefined ? `box ${g.box}` : `view ${g.view}`}`;

export function recordText(d: Decision): string {
  const header: Record<string, unknown> = {
    record: d.ref,
    id: d.machineRef,
    title: d.title,
    status: d.status,
    category: d.category,
    ...(d.decidedOn ? { decided: d.decidedOn } : {}),
    updated: d.updatedOn,
    deciders: [...d.deciders],
    ...(d.alignment ? { alignment: { stance: d.alignment.stance, ...(d.alignment.rule ? { rule: d.alignment.rule } : {}), ...(d.alignment.note ? { note: d.alignment.note } : {}) } } : {}),
    ...(d.related.length ? { related: d.related.map((r) => r.ref) } : {}),
    ...(d.governs.length ? { governs: d.governs.map(governsText) } : {}),
    ...(d.supersedes ? { supersedes: d.supersedes.ref } : {}),
    ...(d.supersededBy ? { superseded_by: d.supersededBy.ref } : {}),
  };
  const body = [
    '## Context',
    '',
    d.context.trim(),
    '',
    '## Decision',
    '',
    d.decision.trim(),
    '',
    '## Consequences',
    '',
    d.consequences.trim(),
    ...(d.alternatives.length ? ['', '## Alternatives considered', '', ...d.alternatives.flatMap((a, i) => [...(i ? [''] : []), `### ${a.option}`, '', a.rejected.trim()])] : []),
  ];
  return `---\n${stringify(header, { lineWidth: 0 })}---\n\n${body.join('\n')}\n`;
}

/** A blank record an agent fills in, for a registry's outline. */
export const RECORD_TEMPLATE = `---
title: What was decided, as a short sentence
status: accepted
category: 3
decided: 2026-01-31
deciders: [The person or role who decided]
related: []
governs: []
---

## Context

## Decision

## Consequences

## Alternatives considered

### An option not taken

Why it was not chosen.
`;

function governsOf(value: unknown): GovernsInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('governs is a list, one line per box or view: workspace/document box <id>');
  return value.map((g) => {
    if (typeof g === 'object' && g !== null) return g as GovernsInput;
    const m = /^(\S+)\s+(box|view)\s+(\S+)$/.exec(String(g).trim());
    if (!m) throw badRequest(`governs: "${String(g)}" is not "workspace/document box <id>" or "workspace/document view <id>"`);
    return m[2] === 'box' ? { document: m[1]!, box: m[3]! } : { document: m[1]!, view: m[3]! };
  });
}

const strings = (value: unknown, what: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${what} is a list`);
  return value.map((v) => String(v).trim()).filter(Boolean);
};

const day = (value: unknown): string | undefined => (value === undefined || value === null || value === '' ? undefined : value instanceof Date ? value.toISOString().slice(0, 10) : String(value));

/** Reads a record's text form. Throws 400 with what is wrong when it is not one. */
export function parseRecordText(text: string): RecordFields {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''));
  if (!m) throw badRequest('a record starts with a header between two --- lines: title, status, category, decided, deciders (guide#decision-records-in-a-hub)');
  let header: Record<string, unknown>;
  try {
    header = (parseYaml(m[1]!) ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw badRequest(`the record's header does not parse: ${(err as Error).message}`);
  }
  if (typeof header !== 'object' || Array.isArray(header)) throw badRequest("the record's header is a map of fields");
  const sections: Record<string, string[]> = {};
  let current: string | undefined;
  for (const line of m[2]!.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    const name = h ? SECTIONS.find((s) => s.toLowerCase() === h[1]!.toLowerCase()) : undefined;
    if (name) {
      current = name;
      sections[name] = [];
    } else if (current) sections[current]!.push(line);
    else if (line.trim()) throw badRequest(`text before the first section: "${line.trim().slice(0, 60)}". A record's sections are ## Context, ## Decision, ## Consequences, ## Alternatives considered`);
  }
  const section = (name: (typeof SECTIONS)[number]): string => (sections[name] ?? []).join('\n').trim();
  const alternatives: Alternative[] = [];
  for (const line of sections['Alternatives considered'] ?? []) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) alternatives.push({ option: h[1]!, rejected: '' });
    else if (alternatives.length) alternatives[alternatives.length - 1] = { option: alternatives[alternatives.length - 1]!.option, rejected: `${alternatives[alternatives.length - 1]!.rejected}\n${line}` };
    else if (line.trim() && line.trim() !== '_None recorded._') throw badRequest('under ## Alternatives considered, each option is a ### heading with why it was rejected below it');
  }
  const a = header['alignment'] as { stance?: unknown; rule?: unknown; note?: unknown } | undefined | null;
  if (a && !STANCES.includes(a.stance as Stance)) throw badRequest(`alignment.stance is one of ${STANCES.join(', ')}`);
  const status = String(header['status'] ?? 'accepted').toLowerCase() as DecisionStatus;
  return {
    title: String(header['title'] ?? '').trim(),
    status,
    category: Number(header['category']),
    decidedOn: day(header['decided']),
    updatedOn: day(header['updated']),
    deciders: strings(header['deciders'], 'deciders'),
    alignment: a ? { stance: a.stance as Stance, ...(a.rule ? { rule: String(a.rule) } : {}), ...(a.note ? { note: String(a.note) } : {}) } : null,
    related: strings(header['related'], 'related'),
    governs: governsOf(header['governs']),
    context: section('Context'),
    decision: section('Decision'),
    consequences: section('Consequences'),
    alternatives: alternatives.map((x) => ({ option: x.option, rejected: x.rejected.trim() })),
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The fields in which `next` differs from `current`, as a patch; empty when none do. */
export function changedFields(current: RecordFields, next: RecordFields): DecisionPatch {
  if (next.category !== current.category) throw badRequest('a record changes its category by moving: vantage_tool vantage_decision_move');
  if (next.status !== current.status && next.status === 'superseded') throw badRequest('a record is superseded by writing the record that replaces it: vantage_tool vantage_decision_supersede');
  const patch: Record<string, unknown> = {};
  if (next.title !== current.title) patch['title'] = next.title;
  if (next.status !== current.status) patch['status'] = next.status;
  if (next.decidedOn !== current.decidedOn && next.decidedOn !== undefined) patch['decidedOn'] = next.decidedOn;
  if (next.updatedOn !== current.updatedOn && next.updatedOn !== undefined) patch['updatedOn'] = next.updatedOn;
  if (!same(next.deciders, current.deciders)) patch['deciders'] = next.deciders;
  if (!same(next.alignment, current.alignment)) patch['alignment'] = next.alignment;
  if (!same(next.related, current.related)) patch['related'] = next.related;
  if (!same(next.governs, current.governs)) patch['governs'] = next.governs;
  for (const k of ['context', 'decision', 'consequences'] as const) if (next[k] !== current[k]) patch[k] = next[k];
  if (!same(next.alternatives, current.alternatives)) patch['alternatives'] = next.alternatives;
  return patch as DecisionPatch;
}

/** A new record's fields, from its text. */
export function createInput(f: RecordFields): DecisionCreate {
  if (!Number.isInteger(f.category)) throw badRequest("a new record's header names its category, a digit: category: 3");
  if (f.status !== 'proposed' && f.status !== 'accepted') throw badRequest('a new record is proposed or accepted');
  if (!f.decidedOn) throw badRequest("a new record's header names the day it was decided: decided: YYYY-MM-DD");
  return {
    category: f.category,
    title: f.title,
    status: f.status,
    decidedOn: f.decidedOn,
    ...(f.updatedOn ? { updatedOn: f.updatedOn } : {}),
    deciders: [...f.deciders],
    context: f.context,
    decision: f.decision,
    consequences: f.consequences,
    alternatives: [...f.alternatives],
    related: [...f.related],
    ...(f.alignment ? { alignment: f.alignment } : {}),
    governs: [...f.governs],
  };
}
