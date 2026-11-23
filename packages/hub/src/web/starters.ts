/**
 * What a new diagram can start from: a blank file with three boxes, or one
 * of the made-up examples in the repository (the image ships `examples/`).
 * Each example's card picture is drawn once, on first ask, and kept.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, render } from '@vantage/server';

export interface Starter {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** The family the card art wears when there is no picture. */
  readonly family: string;
  readonly yaml: string;
  readonly views: number;
}

const BLANK = `title: My System
author: Your Name

nodes:
  - name: Customers
    type: users
  - id: cloud
    name: Cloud
    type: cloud
    children:
      - name: Web App
        type: web
      - name: API
        type: api
      - name: Database
        type: database

relations:
  - from: customers
    to: web-app
    label: uses
    tags: [requests]
  - from: web-app
    to: api
    label: calls
    tags: [requests]
  - from: api
    to: database
    label: reads and writes
    kind: data
    tags: [data]

views:
  - id: context
    title: Context
    question: Who uses the system and what does it keep?
    include: { tags: [requests, data] }
`;

/** The example sets a new document can start from. */
const EXAMPLES: readonly { id: string; file: string; blurb: string; family: string }[] = [
  { id: 'shop', file: 'shop/shop.vantage.yaml', blurb: 'A small store on Azure. One of every kind of view.', family: 'amber' },
  { id: 'harbor', file: 'harbor/harbor.vantage.yaml', blurb: 'A retailer moving from a datacenter to Azure, told as a story.', family: 'teal' },
];

const ROOT = fileURLToPath(new URL('../../../../examples/', import.meta.url));

function describe(id: string, yaml: string, blurb: string, family: string): Starter {
  const { model } = load({ text: yaml });
  return { id, title: model?.title ?? id, blurb, family, yaml, views: (model?.views ?? []).filter((v) => !v.hidden).length };
}

let cache: readonly Starter[] | undefined;

/** The blank file first, then the examples this install has. */
export function starters(): readonly Starter[] {
  if (cache) return cache;
  const list = [describe('blank', BLANK, 'Three boxes and an arrow to change into yours.', 'blue')];
  for (const e of EXAMPLES) {
    const path = `${ROOT}${e.file}`;
    if (existsSync(path)) list.push(describe(e.id, readFileSync(path, 'utf8'), e.blurb, e.family));
  }
  cache = list;
  return list;
}

export function starter(id: string | undefined): Starter {
  const all = starters();
  return all.find((s) => s.id === id) ?? all[0]!;
}

const pictures = new Map<string, string | null>();

/** The first view of a starter as SVG, or null when it does not draw. */
export function starterPicture(id: string): string | null | undefined {
  const s = starters().find((x) => x.id === id);
  if (!s) return undefined;
  if (!pictures.has(id)) pictures.set(id, render({ text: s.yaml, format: 'svg', theme: 'light' }).result?.svg ?? null);
  return pictures.get(id);
}
