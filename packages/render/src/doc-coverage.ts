/**
 * How well a document's pages cover its model, read from the pages alone:
 * a section that types a fact a box already carries, a section of prose
 * that names no box and shows no view, and boxes no page names. These are
 * notes by default; a document's docs contract makes the ones it lists
 * errors that every save refuses.
 */
import type { Diagnostic, DocsCheck, Model } from '@vantage/model';
import type { DocPage, DocSection } from './doc.ts';

/** The coverage checks a docs contract can make errors: the contract's name for each, and the code it answers. */
export const COVERAGE_CHECKS = {
  'no-copied-facts': 'doc-copied-fact',
  'sections-name-boxes': 'doc-section-unnamed',
  'name-every-box': 'doc-box-unmentioned',
} as const satisfies Partial<Record<DocsCheck, string>>;
export type CoverageCheck = keyof typeof COVERAGE_CHECKS;

/** A section with fewer words than this is a lead-in or a list of links, not prose that should name a box. */
const PROSE_WORDS = 25;
/** At most this many boxes or sections are spelled out in one finding; the rest are counted. */
const LISTED = 12;

/**
 * A fact value worth looking for in prose: long enough to be specific and
 * shaped like an identifier, a size, or an address (a digit, or one of
 * `/ . : _ @`), so "Standard" or "Owner" never match.
 */
function distinctive(value: string): boolean {
  const v = value.trim();
  return v.length >= 4 && v.length <= 120 && /[0-9/.:_@]/.test(v) && !/^[0-9]{1,3}$/.test(v);
}

function contains(text: string, value: string): boolean {
  const i = text.indexOf(value);
  if (i < 0) return false;
  const before = text[i - 1];
  const after = text[i + value.length];
  const word = /[A-Za-z0-9]/;
  return !(before && word.test(before)) && !(after && word.test(after));
}

function listed(items: readonly string[]): string {
  return items.slice(0, LISTED).join(', ') + (items.length > LISTED ? ` and ${items.length - LISTED} more` : '');
}

function where(page: string, s: DocSection): string {
  return s.id ? `${page}#${s.id}` : page;
}

/** Coverage findings for every doc page of the model; the checks the document's contract lists are errors, the rest notes. */
export function docCoverage(model: Model, pages: ReadonlyMap<string, DocPage>): Diagnostic[] {
  const strict = new Set<DocsCheck>(model.docs?.checks ?? []);
  const ties = evidenceFindings(model, pages, strict.has('evidence'));
  if (!pages.size) return ties;
  const severity = (check: CoverageCheck): Diagnostic['severity'] => (strict.has(check) ? 'error' : 'info');
  const facts = [...model.nodes.values()].flatMap((n) => n.facts.filter((f) => distinctive(f.value)).map((f) => ({ node: n.id, label: f.label, value: f.value.trim() })));
  const copied: string[] = [];
  const unnamed: string[] = [];
  const named = new Set<string>();
  for (const [id, page] of pages) {
    for (const n of page.nodes) named.add(n);
    for (const s of page.sections) {
      for (const f of facts) if (contains(s.text, f.value)) copied.push(`${where(id, s)} types ${f.label ? `${f.label}: ` : ''}${f.value} (box ${f.node})`);
      if (s.words >= PROSE_WORDS && !s.nodes.length && !s.views.length && model.nodes.size) unnamed.push(where(id, s));
    }
  }
  const out: Diagnostic[] = [];
  if (copied.length) {
    out.push({ severity: severity('no-copied-facts'), code: COVERAGE_CHECKS['no-copied-facts'], message: `pages type facts their boxes carry: ${listed(copied)}`, hint: 'Name the box with [[id]] instead; the reader sees its facts on the picture, and they stay true when the box changes' });
  }
  if (unnamed.length) {
    out.push({ severity: severity('sections-name-boxes'), code: COVERAGE_CHECKS['sections-name-boxes'], message: `sections of prose name no box and show no view: ${listed(unnamed)}`, hint: 'Name the boxes each section is about with [[id]], or embed the view that answers it' });
  }
  const leaves = [...model.nodes.values()].filter((n) => !n.childIds.length && !named.has(n.id)).map((n) => n.id);
  if (leaves.length) {
    out.push({ severity: severity('name-every-box'), code: COVERAGE_CHECKS['name-every-box'], message: `no page names ${leaves.length} box${leaves.length === 1 ? '' : 'es'}: ${listed(leaves)}`, hint: 'Name each box in the page that explains it, with [[id]], or drop a box nothing explains' });
  }
  return [...ties, ...out];
}

/**
 * Ties that point at a page section that does not exist, and, when the
 * contract asks for evidence, boxes and sections of prose no tie covers.
 * A tie to a box covers the boxes inside it; a tie to a page covers its
 * sections.
 */
function evidenceFindings(model: Model, pages: ReadonlyMap<string, DocPage>, required: boolean): Diagnostic[] {
  const out: Diagnostic[] = [];
  const unknown = model.evidence
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => {
      const hash = e.to.indexOf('#');
      return hash >= 0 && pages.has(e.to.slice(0, hash)) && !pages.get(e.to.slice(0, hash))!.headings.some((h) => h.id === e.to.slice(hash + 1));
    });
  for (const { e, i } of unknown) out.push({ severity: 'error', code: 'evidence-unknown-target', message: `evidence ${i} points at ${e.to}, and that page has no such heading`, path: `evidence[${i}].to`, hint: 'Name a heading anchor the page has, as page#anchor' });
  if (!required) return out;
  const tied = new Set(model.evidence.map((e) => e.to));
  const covered = (id: string): boolean => {
    for (let cur: string | undefined = id; cur !== undefined; cur = model.nodes.get(cur)?.parentId) if (tied.has(cur)) return true;
    return false;
  };
  const boxes = [...model.nodes.values()].filter((n) => !n.childIds.length && !covered(n.id)).map((n) => n.id);
  const sections = [...pages].flatMap(([id, page]) => (tied.has(id) ? [] : page.sections.filter((s) => s.id && s.words >= PROSE_WORDS && !tied.has(`${id}#${s.id}`)).map((s) => `${id}#${s.id}`)));
  const missing = [...boxes, ...sections];
  if (missing.length) out.push({ severity: 'error', code: 'evidence-missing', message: `the contract asks for evidence, and nothing ties ${missing.length === 1 ? 'this' : `these ${missing.length}`} to the files ${missing.length === 1 ? 'it' : 'they'} came from: ${listed(missing)}`, hint: 'Add an evidence entry for each: to (box, view, or page#anchor), files, and the commit you read them at' });
  return out;
}
