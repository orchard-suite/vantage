/**
 * The diagram blocks in a Markdown file: fenced code blocks tagged
 * `mermaid`, `plantuml`, or `puml`, each with the nearest heading above it
 * for a title.
 */

export type BlockLanguage = 'mermaid' | 'plantuml';

export interface DiagramBlock {
  readonly language: BlockLanguage;
  readonly body: string;
  /** The nearest heading above the block, without its hashes. */
  readonly heading: string | undefined;
  /** One-based line of the opening fence. */
  readonly line: number;
}

const LANGUAGES: Readonly<Record<string, BlockLanguage>> = { mermaid: 'mermaid', plantuml: 'plantuml', puml: 'plantuml' };

export function diagramBlocks(markdown: string): DiagramBlock[] {
  const lines = markdown.split(/\r?\n/);
  const out: DiagramBlock[] = [];
  let heading: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      heading = h[1]!.replace(/[`*_]/g, '').trim();
      continue;
    }
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (!fence) continue;
    const marker = fence[2]!;
    const close = new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j]!)) j++;
    const language = LANGUAGES[fence[3]!.toLowerCase()];
    if (language) out.push({ language, body: lines.slice(i + 1, j).join('\n'), heading, line: i + 1 });
    i = j;
  }
  return out;
}

export function hasDiagramBlocks(markdown: string): boolean {
  return /^\s*(`{3,}|~{3,})\s*(mermaid|plantuml|puml)\b/im.test(markdown);
}
