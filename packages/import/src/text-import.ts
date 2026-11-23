/**
 * A Mermaid, PlantUML, or Markdown file to a document input. Markdown
 * files hold fenced blocks of either language; each block is one view,
 * titled from the nearest heading above it. A file of one language is one
 * diagram (PlantUML may hold several `@startuml` sections).
 */
import type { DocumentInput } from '@vantage/model';
import type { PageReport } from './build.ts';
import { diagramBlocks, type BlockLanguage } from './markdown-blocks.ts';
import { parseMermaid } from './mermaid.ts';
import { parsePlantuml } from './plantuml.ts';
import { buildTextDiagrams, type TextDiagram } from './text-diagram.ts';

export type TextFormat = 'mermaid' | 'plantuml' | 'markdown';

export interface TextImport {
  readonly input: DocumentInput;
  readonly pages: PageReport[];
  readonly warnings: string[];
  readonly hints: string[];
  readonly merged: string[];
  readonly counts: { shapes: number; edges: number; nodes: number; containers: number; relations: number; dropped: number };
}

interface Source {
  readonly language: BlockLanguage;
  readonly body: string;
  readonly heading: string | undefined;
  /** Where warnings say they came from; empty for a file of one diagram. */
  readonly where: string;
}

export function importTextDiagrams(text: string, filename: string, format: TextFormat, title: string): TextImport {
  const sources: Source[] =
    format === 'markdown'
      ? diagramBlocks(text).map((b) => ({ language: b.language, body: b.body, heading: b.heading, where: `${b.language} block at line ${b.line}: ` }))
      : [{ language: format, body: text, heading: undefined, where: '' }];
  if (!sources.length) throw new Error(`${filename} has no mermaid or plantuml blocks`);
  const diagrams: TextDiagram[] = [];
  const warnings: string[] = [];
  let dropped = 0;
  for (const s of sources) {
    const parsed = s.language === 'mermaid' ? [parseMermaid(s.body)] : parsePlantuml(s.body);
    if (!parsed.length) warnings.push(`${s.where}no diagram found`);
    parsed.forEach((p, i) => {
      const where = parsed.length > 1 ? `${s.where}diagram ${i + 1}: ` : s.where;
      warnings.push(...p.notes.lines(where));
      if (!p.diagram) {
        dropped++;
        return;
      }
      const heading = s.heading !== undefined && parsed.length > 1 ? `${s.heading} ${i + 1}` : s.heading;
      p.diagram.title = heading ?? p.diagram.title;
      if (!hasContent(p.diagram)) {
        warnings.push(`${where}the diagram has nothing in it; skipped`);
        dropped++;
        return;
      }
      diagrams.push(p.diagram);
    });
  }
  // Untitled diagrams take the file's name, numbered when there are several.
  const untitled = diagrams.filter((d) => d.title === undefined);
  untitled.forEach((d, i) => (d.title = untitled.length > 1 ? `${title} ${i + 1}` : title));
  const built = buildTextDiagrams(diagrams);
  const input: DocumentInput = { vantage: 1, title, description: `Imported from ${filename} (${format}).`, nodes: built.nodes, views: built.views };
  return { input, pages: built.pages, warnings, hints: built.hints, merged: built.merged, counts: { ...built.counts, dropped } };
}

function hasContent(d: TextDiagram): boolean {
  return d.kind === 'relation' ? d.nodes.length > 0 : d.steps.length > 0;
}
