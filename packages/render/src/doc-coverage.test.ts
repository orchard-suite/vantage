import { describe, expect, test } from 'bun:test';
import { loadModelFromText, type Model } from '@vantage/model';
import { renderDoc } from './doc.ts';
import { docCoverage } from './doc-coverage.ts';

const YAML = `title: Shop
nodes:
  - name: Orders API
    facts: [ "SKU: P1v3", "Address: 10.20.0.0/16" ]
  - name: Orders DB
  - name: Cache
views:
  - id: requests
    title: Requests
  - id: guide
    kind: doc
    title: Guide
    text: x
`;

const model = (): Model => loadModelFromText(YAML).model!;
const LONG = 'This part of the guide explains how the whole system behaves when a shopper presses buy and the order travels through every service until the money moves and a receipt goes out.';

describe('page coverage', () => {
  test('cuts a page at its headings and records what each section names', () => {
    const page = renderDoc('guide', `Lead in.\n\n## Arrive {#arrive}\n\nThe [[orders-api]] takes it. See ![x](view:requests).\n\n## Store\n\n[the db](node:orders-db) keeps it.\n`);
    expect(page.sections.map((s) => [s.id, s.heading, s.nodes, s.views])).toEqual([
      ['', '', [], []],
      ['arrive', 'Arrive', ['orders-api'], ['requests']],
      ['store', 'Store', ['orders-db'], []],
    ]);
  });

  test('a section that types a box fact is a note; the contract makes it an error', () => {
    const pages = new Map([['guide', renderDoc('guide', `## Size\n\nThe [[orders-api]] runs on P1v3 in 10.20.0.0/16.\n`)]]);
    const notes = docCoverage(model(), pages);
    const copied = notes.find((d) => d.code === 'doc-copied-fact')!;
    expect(copied.severity).toBe('info');
    expect(copied.message).toContain('guide#size types SKU: P1v3 (box orders-api)');
    expect(copied.message).toContain('Address: 10.20.0.0/16');
    const strict = loadModelFromText(YAML.replace('title: Shop', 'title: Shop\ndocs: { checks: [no-copied-facts] }')).model!;
    expect(docCoverage(strict, pages).find((d) => d.code === 'doc-copied-fact')!.severity).toBe('error');
  });

  test('a word inside a longer word is not a copied fact', () => {
    const pages = new Map([['guide', renderDoc('guide', `## Size\n\nThe [[orders-api]] runs on P1v3x.\n`)]]);
    expect(docCoverage(model(), pages).some((d) => d.code === 'doc-copied-fact')).toBe(false);
  });

  test('prose that names no box and shows no view is a note; a short lead-in is not', () => {
    const pages = new Map([['guide', renderDoc('guide', `Short lead.\n\n## Why {#why}\n\n${LONG}\n\n## How\n\n${LONG} The [[cache]] helps.\n`)]]);
    const unnamed = docCoverage(model(), pages).find((d) => d.code === 'doc-section-unnamed')!;
    expect(unnamed.message).toBe('sections of prose name no box and show no view: guide#why');
  });

  test('boxes no page names are listed once for the document', () => {
    const pages = new Map([['guide', renderDoc('guide', `The [[orders-api]] and [[cache]].\n`)]]);
    const unmentioned = docCoverage(model(), pages).find((d) => d.code === 'doc-box-unmentioned')!;
    expect(unmentioned.message).toBe('no page names 1 box: orders-db');
  });

  test('a document with no pages has nothing to say', () => {
    expect(docCoverage(model(), new Map())).toEqual([]);
  });

  test('the evidence check asks for a tie on every box and every section of prose; a tie to a container covers its boxes', () => {
    const yaml = YAML.replace('title: Shop', 'title: Shop\ndocs: { checks: [evidence] }') + 'evidence:\n  - { to: orders-api, files: [src/orders/], commit: abc1234 }\n  - { to: guide#why, files: [README.md], commit: abc1234 }\n';
    const m = loadModelFromText(yaml).model!;
    const pages = new Map([['guide', renderDoc('guide', `## Why {#why}\n\n${LONG}\n\n## How\n\n${LONG}\n`)]]);
    const missing = docCoverage(m, pages).find((d) => d.code === 'evidence-missing')!;
    expect(missing.severity).toBe('error');
    expect(missing.message).toContain('orders-db, cache, guide#how');
    expect(missing.message).not.toContain('orders-api');
  });

  test('a tie to a heading the page lacks is an error', () => {
    const m = loadModelFromText(`${YAML}evidence:\n  - { to: guide#nowhere, files: [a.ts], commit: abc1234 }\n`).model!;
    const pages = new Map([['guide', renderDoc('guide', '## Here\n\nThe [[cache]].\n')]]);
    expect(docCoverage(m, pages).find((d) => d.code === 'evidence-unknown-target')!.message).toContain('guide#nowhere');
  });
});
