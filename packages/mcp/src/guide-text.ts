/**
 * The guide and the schema as text at the addresses `guide` and `schema`,
 * read by part: a guide topic is one of its headings, a schema part is one
 * definition or one top-level field. Nothing answers either one whole
 * unless it is asked for whole.
 */
import { authoringGuide, schema } from '@vantage/server';
import { headingOutline, headings, markdownRange, sliceLines } from './markdown.ts';

export function guideText(): string {
  return authoringGuide();
}

export function guideTopics(): string[] {
  return headings(guideText()).map((h) => h.slug);
}

export function guideOutline(): string {
  return ['guide: the language and the rules, by topic. Read one with vantage_read guide#<topic>.', ...headingOutline(guideText(), 3)].join('\n');
}

/** One topic of the guide, or undefined when no heading has that name. */
export function guidePart(part: string): string | undefined {
  const range = markdownRange(guideText(), part);
  return range ? sliceLines(guideText(), range) : undefined;
}

type Json = Record<string, unknown>;

function schemaParts(): Map<string, unknown> {
  const s = schema() as { properties?: Json; $defs?: Json; definitions?: Json };
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(s.$defs ?? s.definitions ?? {})) out.set(k, v);
  for (const [k, v] of Object.entries(s.properties ?? {})) if (!out.has(k)) out.set(k, v);
  return out;
}

export function schemaText(): string {
  return JSON.stringify(schema());
}

export function schemaOutline(): string {
  const lines = [...schemaParts()].map(([k, v]) => `#${k}  ${JSON.stringify(v).length.toLocaleString('en-US')} chars`);
  return ['schema: the JSON Schema of a document, by part. Read one with vantage_read schema#<part>.', ...lines].join('\n');
}

export function schemaPart(part: string): string | undefined {
  const hit = [...schemaParts()].find(([k]) => k.toLowerCase() === part.toLowerCase());
  return hit ? JSON.stringify(hit[1], null, 1) : undefined;
}
